// ============================================================
// 本地行 ↔ 云端行 的纯映射（SPEC-V2 1.3）
//
// 云端八张表的列结构见 supabase-schema.sql。本地 V1 数据模型比云端列多出
// 一些字段（notes / blockMinutes / kind / emoji …），统一收进 jsonb 列
// （tasks.config、upkeep_days.per_category.__meta）或文本信封，保证
// 「上传 → 拉回」完全无损，数值一分不差。
// ============================================================
import type { Log, Redemption, Reward, SkillNodeRow, Task, UnlockedAchievementRow } from "@shared/schema";
import type { UpkeepDay } from "@shared/upkeep";

export const CLOUD_TABLES = [
  "profiles",
  "tasks",
  "rewards",
  "settlement_logs",
  "redemptions",
  "achievements_unlocked",
  "skill_nodes_unlocked",
  "upkeep_days",
] as const;
export type CloudTable = (typeof CLOUD_TABLES)[number];

/** 只追加（按主键去重，永不覆盖） */
export const APPEND_ONLY: CloudTable[] = [
  "settlement_logs",
  "redemptions",
  "achievements_unlocked",
  "skill_nodes_unlocked",
  "upkeep_days",
];

// ---------------- 时间与文本工具 ----------------
export const toIso = (ms: number | null | undefined): string | null =>
  ms == null || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
export const fromIso = (s: string | null | undefined, fallback = 0): number => {
  if (!s) return fallback;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : fallback;
};

/** 文本信封：把本地多出来的小字段塞进云端的 text 列，且对旧值向后兼容 */
const ENV = "\u0001drpg:";
export function packText(extra: Record<string, unknown>, main: string): string {
  const keys = Object.keys(extra).filter((k) => extra[k] !== undefined && extra[k] !== "" && extra[k] !== null);
  if (keys.length === 0) return main;
  const obj: Record<string, unknown> = { n: main };
  for (const k of keys) obj[k] = extra[k];
  return ENV + JSON.stringify(obj);
}
export function unpackText(raw: string | null | undefined): { main: string; extra: Record<string, any> } {
  const s = raw ?? "";
  if (!s.startsWith(ENV)) return { main: s, extra: {} };
  try {
    const obj = JSON.parse(s.slice(ENV.length)) as Record<string, any>;
    const { n, ...extra } = obj;
    return { main: typeof n === "string" ? n : "", extra };
  } catch {
    return { main: "", extra: {} };
  }
}

// ---------------- tasks ----------------
export function taskToCloud(t: Task, userId: string) {
  let milestones: unknown = [];
  try {
    milestones = JSON.parse(t.milestones || "[]");
  } catch {
    milestones = [];
  }
  return {
    id: t.uid!,
    user_id: userId,
    title: t.title,
    category: t.category,
    mode: t.mode,
    difficulty: String(t.difficulty),
    xp_per_unit: t.xpPerUnit,
    points_per_unit: t.pointsPerUnit,
    prof_per_unit: t.profPerUnit,
    config: {
      notes: t.notes,
      startDate: t.startDate,
      endDate: t.endDate,
      blockMinutes: t.blockMinutes,
      dailyTargetBlocks: t.dailyTargetBlocks,
      finishBonusGranted: t.finishBonusGranted,
      period: t.period,
      targetPerPeriod: t.targetPerPeriod,
      bestStreak: t.bestStreak,
      lastPeriodKey: t.lastPeriodKey,
      unitName: t.unitName,
      targetCount: t.targetCount,
      currentCount: t.currentCount,
      difficulty: t.difficulty,
      createdAt: t.createdAt,
    },
    milestones,
    streak: t.streak,
    archived: !!t.archived,
    created_at: toIso(t.createdAt),
    updated_at: toIso(t.updatedAt ?? t.createdAt),
    deleted_at: toIso(t.deletedAt ?? null),
  };
}

export function taskFromCloud(row: any, localId: number, localUserId: number): Task {
  const c = row.config ?? {};
  return {
    id: localId,
    uid: row.id,
    userId: localUserId,
    title: row.title ?? "",
    category: row.category ?? "academic",
    mode: row.mode ?? "timer",
    difficulty: Number(c.difficulty ?? row.difficulty) || 2,
    xpPerUnit: row.xp_per_unit ?? 0,
    pointsPerUnit: row.points_per_unit ?? 0,
    profPerUnit: row.prof_per_unit ?? 0,
    notes: c.notes ?? "",
    startDate: c.startDate ?? "",
    endDate: c.endDate ?? "",
    archived: row.archived ? 1 : 0,
    blockMinutes: c.blockMinutes ?? 25,
    dailyTargetBlocks: c.dailyTargetBlocks ?? 2,
    milestones: JSON.stringify(row.milestones ?? []),
    finishBonusGranted: c.finishBonusGranted ?? 0,
    period: c.period ?? "daily",
    targetPerPeriod: c.targetPerPeriod ?? 1,
    streak: row.streak ?? 0,
    bestStreak: c.bestStreak ?? 0,
    lastPeriodKey: c.lastPeriodKey ?? "",
    unitName: c.unitName ?? "次",
    targetCount: c.targetCount ?? 10,
    currentCount: c.currentCount ?? 0,
    createdAt: c.createdAt ?? fromIso(row.created_at, Date.now()),
    updatedAt: fromIso(row.updated_at, c.createdAt ?? Date.now()),
    deletedAt: row.deleted_at ? fromIso(row.deleted_at) : null,
  };
}

// ---------------- settlement_logs（只追加） ----------------
export function logToCloud(l: Log, userId: string, taskUid: string | null) {
  return {
    id: l.uid!,
    user_id: userId,
    task_id: taskUid,
    task_title: l.taskTitle ?? "",
    category: l.category,
    mode: l.mode ?? "",
    occurred_on: l.day,
    occurred_at: toIso(l.createdAt),
    ratio: l.ratio,
    xp: l.xp,
    points: l.points,
    prof: l.prof,
    minutes: l.minutes,
    note: packText({ k: l.kind }, l.note ?? ""),
    created_at: toIso(l.createdAt),
  };
}

export function logFromCloud(row: any, localId: number, localUserId: number, localTaskId: number): Log {
  const { main, extra } = unpackText(row.note);
  return {
    id: localId,
    uid: row.id,
    userId: localUserId,
    taskId: localTaskId,
    taskTitle: row.task_title ?? "",
    category: row.category ?? "academic",
    mode: row.mode ?? "",
    kind: extra.k ?? "block",
    day: row.occurred_on ?? "",
    xp: row.xp ?? 0,
    points: row.points ?? 0,
    prof: row.prof ?? 0,
    minutes: row.minutes ?? 0,
    ratio: row.ratio ?? 1,
    note: main,
    createdAt: fromIso(row.occurred_at ?? row.created_at, Date.now()),
  };
}

// ---------------- rewards ----------------
export function rewardToCloud(r: Reward, userId: string) {
  return {
    id: r.uid!,
    user_id: userId,
    name: r.name,
    description: r.description ?? "",
    cost: r.cost,
    icon: r.emoji ?? "",
    tag: r.tag ?? "",
    stock: r.stock,
    archived: !!r.archived,
    created_at: toIso(r.createdAt),
    updated_at: toIso(r.updatedAt ?? r.createdAt),
    deleted_at: toIso(r.deletedAt ?? null),
  };
}

export function rewardFromCloud(row: any, localId: number, localUserId: number): Reward {
  return {
    id: localId,
    uid: row.id,
    userId: localUserId,
    name: row.name ?? "",
    description: row.description ?? "",
    cost: row.cost ?? 0,
    emoji: row.icon ?? "🎁",
    stock: row.stock ?? -1,
    tag: row.tag ?? "",
    archived: row.archived ? 1 : 0,
    createdAt: fromIso(row.created_at, Date.now()),
    updatedAt: fromIso(row.updated_at, Date.now()),
    deletedAt: row.deleted_at ? fromIso(row.deleted_at) : null,
  };
}

// ---------------- redemptions（只追加） ----------------
export function redemptionToCloud(r: Redemption, userId: string, rewardUid: string | null) {
  return {
    id: r.uid!,
    user_id: userId,
    reward_id: rewardUid,
    name: packText({ e: r.emoji }, r.name ?? ""),
    cost: r.cost,
    redeemed_at: toIso(r.createdAt),
  };
}

export function redemptionFromCloud(row: any, localId: number, localUserId: number, localRewardId: number): Redemption {
  const { main, extra } = unpackText(row.name);
  return {
    id: localId,
    uid: row.id,
    userId: localUserId,
    rewardId: localRewardId,
    name: main,
    emoji: extra.e ?? "🎁",
    cost: row.cost ?? 0,
    createdAt: fromIso(row.redeemed_at, Date.now()),
  };
}

// ---------------- achievements / skill nodes（只追加，自然主键） ----------------
export function achievementToCloud(a: UnlockedAchievementRow, userId: string) {
  return { user_id: userId, achievement_id: a.achievementId, unlocked_at: toIso(a.unlockedAt) };
}
export function skillNodeToCloud(n: SkillNodeRow, userId: string) {
  return { user_id: userId, node_id: n.nodeId, cost: n.cost ?? 0, unlocked_at: toIso(n.unlockedAt) };
}

// ---------------- upkeep_days（只追加，(user_id, day) 主键幂等） ----------------
export function upkeepDayToCloud(u: UpkeepDay, userId: string) {
  return {
    user_id: userId,
    day: u.day,
    per_category: {
      ...u.perCategory,
      __meta: {
        totalDue: u.totalDue,
        streakBonus: u.streakBonus,
        netSpend: u.netSpend,
        allMetStreak: u.allMetStreak,
        capped: u.capped,
      },
    },
    total_charged: u.totalCharged,
    total_waived: u.totalWaived,
    exemptions_used: u.exemptionsUsed,
    all_met: u.allMet,
    bonus_granted: u.bonusGranted,
    in_grace: u.grace,
    settled_at: toIso(u.settledAt),
  };
}

export function upkeepDayFromCloud(row: any, localUserId: number): UpkeepDay {
  const pc = { ...(row.per_category ?? {}) };
  const meta = pc.__meta ?? {};
  delete pc.__meta;
  const settledAt = fromIso(row.settled_at, Date.now());
  return {
    userId: localUserId,
    day: row.day,
    perCategory: pc,
    totalDue: meta.totalDue ?? row.total_charged ?? 0,
    totalCharged: row.total_charged ?? 0,
    totalWaived: row.total_waived ?? 0,
    bonusGranted: row.bonus_granted ?? 0,
    streakBonus: meta.streakBonus ?? 0,
    netSpend: meta.netSpend ?? (row.total_charged ?? 0) - (row.bonus_granted ?? 0),
    exemptionsUsed: row.exemptions_used ?? 0,
    allMet: !!row.all_met,
    allMetStreak: meta.allMetStreak ?? 0,
    grace: !!row.in_grace,
    capped: !!meta.capped,
    settledAt,
    updatedAt: settledAt,
    deletedAt: null,
  } as UpkeepDay;
}
