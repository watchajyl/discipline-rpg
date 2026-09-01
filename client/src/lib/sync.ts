// ============================================================
// 同步引擎（SPEC-V2 1.1 / 1.3 / 1.4 / 1.6）
//
// 流程：push（按 outbox 顺序）→ pull（按游标增量）→ 合并 → projectState 重算 → 落盘
// 关键保证：
//   · UI 永远读本地，同步全在后台跑，失败也不阻塞任何操作
//   · outbox 按 (table, pk) 去重，只追加表用 insert-if-absent，重复补传不会重复计分
//   · 断网时 push/pull 直接跳过，恢复联网后自动补传
// ============================================================
import { supabase } from "./supabase";
import type { CloudTable } from "./cloud-map";
import {
  activeUserIds,
  buildPushRow,
  cloudTables,
  conflictKey,
  cursorColumn,
  getCursor,
  isAppendOnly,
  lastSyncAt as readLastSyncAt,
  markPushFailed,
  markPushed,
  mergeCloudRows,
  outboxCount,
  outboxEntries,
  persistNow,
  recordMergedHashes,
  reprojectUser,
  setCursor,
  setLastSyncAt,
} from "./localdb";

export type SyncState = "local" | "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncAt: number;
  message: string;
  online: boolean;
}

let status: SyncStatus = {
  state: "local",
  pending: 0,
  lastSyncAt: 0,
  message: "",
  online: typeof navigator === "undefined" ? true : navigator.onLine,
};

const listeners = new Set<(s: SyncStatus) => void>();
let invalidate: (() => void) | null = null;
let running: Promise<SyncResult | null> | null = null;
let timer: number | null = null;
let started = false;

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSync(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => void listeners.delete(fn);
}

export function setSyncInvalidator(fn: (() => void) | null) {
  invalidate = fn;
}

function emit(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(status);
}

export function statusLabel(s: SyncStatus): string {
  if (s.state === "local") return "本地模式";
  if (s.state === "syncing") return "同步中…";
  if (s.state === "offline") return s.pending > 0 ? `离线 · ${s.pending} 项待上传` : "离线";
  if (s.state === "error") return s.pending > 0 ? `同步失败 · ${s.pending} 项待上传` : "同步失败";
  return "已同步";
}

/** 刷新待上传数与整体状态（不发网络请求） */
export async function refreshSyncStatus() {
  const ids = await activeUserIds();
  if (!ids) {
    emit({ state: "local", pending: 0, lastSyncAt: 0, message: "" });
    return;
  }
  const pending = outboxCount(ids.cloudId);
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  let state: SyncState = status.state;
  if (!online) state = "offline";
  else if (state === "local") state = pending > 0 ? "error" : "idle";
  else if (state === "offline") state = pending > 0 ? "error" : "idle";
  emit({ pending, online, state, lastSyncAt: readLastSyncAt(ids.cloudId) });
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  pending: number;
  errors: string[];
}

const PUSH_ORDER: CloudTable[] = [
  "profiles",
  "tasks",
  "rewards",
  "settlement_logs",
  "redemptions",
  "achievements_unlocked",
  "skill_nodes_unlocked",
  "upkeep_days",
];

const BATCH = 200;
const PAGE = 500;

function errText(e: any): string {
  return String(e?.message ?? e?.error_description ?? e ?? "未知错误");
}

/** 立即同步；并发调用会复用同一次运行 */
export function syncNow(): Promise<SyncResult | null> {
  if (running) return running;
  running = runSync().finally(() => {
    running = null;
  });
  return running;
}

async function runSync(): Promise<SyncResult | null> {
  const ids = await activeUserIds();
  if (!ids) {
    emit({ state: "local", pending: 0 });
    return null;
  }
  const { localId, cloudId } = ids;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    emit({ state: "offline", pending: outboxCount(cloudId), online: false });
    return null;
  }
  emit({ state: "syncing", online: true, pending: outboxCount(cloudId), message: "" });

  const sb = supabase();
  const { data: sess } = await sb.auth.getSession();
  if (!sess.session || sess.session.user.id !== cloudId) {
    // session 掉了：保持离线队列，等用户重新登录
    emit({ state: "error", message: "登录状态已过期，请重新登录", pending: outboxCount(cloudId) });
    return { pushed: 0, pulled: 0, pending: outboxCount(cloudId), errors: ["session 失效"] };
  }

  const errors: string[] = [];
  let pushed = 0;
  let pulled = 0;

  // ---------- 1. push ----------
  const entries = outboxEntries(cloudId);
  for (const table of PUSH_ORDER) {
    const mine = entries.filter((e) => e.table === table);
    if (mine.length === 0) continue;
    for (let i = 0; i < mine.length; i += BATCH) {
      const chunk = mine.slice(i, i + BATCH);
      const rows: any[] = [];
      const ok: { table: CloudTable; pk: string }[] = [];
      for (const e of chunk) {
        const row = buildPushRow(table, e.pk, localId, cloudId);
        if (row) {
          rows.push(row);
          ok.push({ table, pk: e.pk });
        } else {
          // 本地行已不存在（例如硬删的计时器行）：直接出队，避免卡住队列
          ok.push({ table, pk: e.pk });
        }
      }
      if (rows.length > 0) {
        const { error } = await sb
          .from(table)
          .upsert(rows, { onConflict: conflictKey(table), ignoreDuplicates: isAppendOnly(table) });
        if (error) {
          markPushFailed(cloudId, table, errText(error));
          errors.push(`${table}: ${errText(error)}`);
          continue;
        }
      }
      markPushed(localId, cloudId, ok);
      pushed += rows.length;
    }
  }

  // ---------- 2. pull ----------
  for (const table of cloudTables()) {
    const col = cursorColumn(table);
    let cursor = getCursor(cloudId, table);
    for (let guard = 0; guard < 40; guard++) {
      const { data, error } = await sb
        .from(table)
        .select("*")
        .eq("user_id", cloudId)
        .gt(col, cursor)
        .order(col, { ascending: true })
        .limit(PAGE);
      if (error) {
        errors.push(`${table}: ${errText(error)}`);
        break;
      }
      const rows = data ?? [];
      if (rows.length === 0) break;
      pulled += mergeCloudRows(localId, table, rows);
      const last = rows[rows.length - 1] as any;
      const next = last?.[col];
      if (!next || next === cursor) break;
      cursor = next;
      setCursor(cloudId, table, next);
      if (rows.length < PAGE) break;
    }
  }

  // ---------- 3. 重算 + 落盘 ----------
  if (pulled > 0) reprojectUser(localId);
  recordMergedHashes(localId, cloudId);
  const now = Date.now();
  if (errors.length === 0) setLastSyncAt(cloudId, now);
  await persistNow();

  const pending = outboxCount(cloudId);
  emit({
    state: errors.length > 0 ? "error" : "idle",
    pending,
    lastSyncAt: readLastSyncAt(cloudId),
    message: errors[0] ?? "",
  });
  if (pulled > 0 && invalidate) invalidate();
  return { pushed, pulled, pending, errors };
}

/** 后台自动同步：登录后启动，联网/回到前台/定时触发 */
export function startSyncLoop() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => {
    emit({ online: true });
    void syncNow();
  });
  window.addEventListener("offline", () => {
    emit({ online: false, state: "offline" });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void syncNow();
  });
  timer = window.setInterval(() => {
    if (!document.hidden) void syncNow();
  }, 60_000);
  void syncNow();
}

export function stopSyncLoop() {
  if (timer != null) window.clearInterval(timer);
  timer = null;
  started = false;
}

export function markLocalMode() {
  emit({ state: "local", pending: 0, message: "" });
}

if (typeof window !== "undefined") {
  (window as any).__sync = { syncNow, getSyncStatus, refreshSyncStatus };
}
