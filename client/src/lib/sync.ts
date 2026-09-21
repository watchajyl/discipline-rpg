// ============================================================
// 同步引擎（SPEC-V2 1.1 / 1.3 / 1.4 / 1.6）
//
// 流程：push（按 outbox 顺序）→ pull（按游标增量）→ 合并 → projectState 重算 → 落盘
// 关键保证：
//   · UI 永远读本地，同步全在后台跑，失败也不阻塞任何操作
//   · outbox 按 (table, pk) 去重，只追加表用 insert-if-absent，重复补传不会重复计分
//   · 断网时 push/pull 直接跳过，恢复联网后自动补传
// ============================================================
import type { CloudTable } from "./cloud-map";
import { serverGetSnapshot, serverPutSnapshot, ServerError } from "./server-api";
import {
  activeUserIds,
  buildCloudSnapshot,
  cloudTables,
  lastSyncAt as readLastSyncAt,
  markAllPushed,
  mergeCloudRows,
  outboxCount,
  persistNow,
  recordMergedHashes,
  reprojectUser,
  serverConnection,
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

  const errors: string[] = [];
  let pushed = 0;
  let pulled = 0;

  const { baseUrl, token } = await serverConnection(localId);
  if (!baseUrl || !token) {
    emit({ state: "error", message: "尚未配置在线服务器", pending: outboxCount(cloudId) });
    return { pushed: 0, pulled: 0, pending: outboxCount(cloudId), errors: ["未配置在线服务器"] };
  }

  // 拉取远程快照并合并；上传时用 sha 做乐观并发，冲突则重试。
  let succeeded = false;
  for (let attempt = 0; attempt < 3 && !succeeded; attempt++) {
    try {
      const remote = await serverGetSnapshot(baseUrl, token);
      const remoteTables = remote?.data?.tables ?? {};
      for (const table of cloudTables()) {
        pulled += mergeCloudRows(localId, table, remoteTables[table] ?? []);
      }
      const snapshot = {
        version: 1,
        updatedAt: Date.now(),
        tables: buildCloudSnapshot(localId, cloudId),
      };
      await serverPutSnapshot(baseUrl, token, Number(remote.version ?? 0), snapshot);
      pushed += 1;
      markAllPushed(localId, cloudId);
      succeeded = true;
    } catch (e: any) {
      if (e instanceof ServerError && e.status === 409) {
        continue;
      }
      errors.push(errText(e));
      break;
    }
  }

  if (succeeded) {
    recordMergedHashes(localId, cloudId);
  }

  // ---------- 3. 重算 + 落盘 ----------
  if (pulled > 0) reprojectUser(localId);
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
