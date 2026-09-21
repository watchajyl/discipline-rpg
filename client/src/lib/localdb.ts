// ============================================================
// 本地数据层：完全替代原 Express + SQLite 后端
// 所有游戏数值逻辑复用 @shared/gameRules 与 @shared/achievements，
// 数值公式与旧服务端逐行一致，未做任何调参。
// ============================================================
import {
  insertRewardSchema,
  insertTaskSchema,
  loginSchema,
  registerSchema,
  resetSchema,
  type InsertReward,
  type InsertTask,
  type FocusTimer,
  type Expense,
  type JournalEntry,
  type Log,
  type Milestone,
  type PlannerMessage,
  type PlannerSession,
  type ProficiencyRow,
  type Redemption,
  type Reward,
  type Session,
  type SleepLog,
  type SkillNodeRow,
  type Task,
  type Timer,
  type UnlockedAchievementRow,
  type User,
} from "@shared/schema";
import {
  CATEGORY_KEYS,
  MAKEUP_DAYS,
  SKILL_NODES,
  categoryName,
  computeSettlement,
  RULE_DEFAULTS,
  dateKey,
  effectsFor,
  FINISH_BONUS_RATE,
  FINISH_BONUS_RATE_BOOSTED,
  isConsecutivePeriod,
  levelFromXp,
  levelProgress,
  levelTitle,
  metricName,
  modeName,
  normalizeTaskTarget,
  periodKey,
  proficiencyTier,
  repeatName,
  ruleTargetFor,
  ruleSuggest,
  urgencyMultiplier,
  weekKey,
} from "@shared/gameRules";
import { ACHIEVEMENTS, isAchieved, RARITY_META, V1_ACHIEVEMENT_COUNT, type AchievementSnapshot } from "@shared/achievements";
import { OVERWORK_MULT, recommendedWorkMinutes, sleepScore, timeToMinutes, workLimitReason } from "@shared/sleep";
import {
  addDays,
  applyDailyCap,
  attainment,
  categoryFee,
  dayDiff,
  isDailyBilled,
  isWeekEnd,
  normalizeUpkeepConfig,
  setUpkeepClockOffsetMs,
  UPKEEP_ALL_MET_STREAK_BONUSES,
  UPKEEP_BACKFILL_MAX_DAYS,
  UPKEEP_DEFAULT_CONFIG,
  UPKEEP_SUMMARY_MIN_DAYS,
  UPKEEP_ZERO_SPEND_DAYS,
  upkeepNowMs,
  upkeepToday,
  weekDays,
  weekStart,
  type UpkeepCategoryDay,
  type UpkeepConfig,
  type UpkeepConfigRow,
  type UpkeepDay,
  type UpkeepExemption,
  type UpkeepTargets,
} from "@shared/upkeep";
import {
  decryptSecretValue,
  encryptSecretValue,
  hashSecret,
  maskKey,
  randomHex,
  verifySecret,
} from "./crypto";
import { initStorage, readDoc, storageAvailable, writeDoc } from "./storage-driver";

// ---------------- 文档结构 ----------------
type DbDoc = {
  version: number;
  seq: Record<string, number>;
  appSecret: string;
  users: User[];
  sessions: Session[];
  tasks: Task[];
  logs: Log[];
  proficiency: ProficiencyRow[];
  achievements: UnlockedAchievementRow[];
  skillNodes: SkillNodeRow[];
  rewards: Reward[];
  redemptions: Redemption[];
  timers: Timer[];
  /** V3：全局专注计时器（每个账号一条，本地状态，不随云端同步） */
  focusTimers: FocusTimer[];
  /** V4：复盘日记与未来规划（本地保存） */
  journals: JournalEntry[];
  /** V0.2：睡眠记录（本地保存，结算流水仍走 settlement_logs） */
  sleepLogs: SleepLog[];
  /** V0.2：每账号的理想睡眠设置 */
  sleepSettings: Record<number, { idealBedtime: string; idealSleepHours: number }>;
  /** V0.3：开销流水（本地保存，预算完成情况写入结算日志） */
  expenses: Expense[];
  /** V0.4：智能规划聊天会话（本地保存） */
  plannerSessions: PlannerSession[];
  /** 「记住登录状态」持久化的活动会话 token */
  rememberedToken: string | null;
  /** 每个账号最近一次导出备份的时间 */
  lastBackupAt: Record<string, number>;
  // ---- V2 每日维持机制（只追加 + updated_at + 软删，便于后续云端同步） ----
  upkeepDays: UpkeepDay[];
  upkeepExemptions: UpkeepExemption[];
  upkeepConfigs: UpkeepConfigRow[];
  // ---- V2 云端同步 ----
  /** 待上传队列（按入队顺序推送，(table,pk) 去重） */
  outbox: OutboxEntry[];
  /** 已成功推送的行内容指纹：pushed[table][pk] = hash */
  pushed: Record<string, Record<string, string>>;
  /** 每张表的增量拉取游标（ISO 时间戳） */
  cursors: Record<string, string>;
  /** 每个云账号最近一次同步成功时间 */
  lastSyncAt: Record<string, number>;
};

export type OutboxEntry = {
  seq: number;
  /** 云端表名 */
  table: string;
  /** 主键（uuid 或 "day" / "achievementId" 之类的自然键） */
  pk: string;
  /** 所属云账号 uuid */
  cloudUserId: string;
  createdAt: number;
  tries: number;
  lastError?: string;
};

function emptyDoc(): DbDoc {
  return {
    version: 1,
    seq: {},
    appSecret: randomHex(32),
    users: [],
    sessions: [],
    tasks: [],
    logs: [],
    proficiency: [],
    achievements: [],
    skillNodes: [],
    rewards: [],
    redemptions: [],
    timers: [],
    focusTimers: [],
    journals: [],
    sleepLogs: [],
    sleepSettings: {},
    expenses: [],
    plannerSessions: [],
    rememberedToken: null,
    lastBackupAt: {},
    upkeepDays: [],
    upkeepExemptions: [],
    upkeepConfigs: [],
    outbox: [],
    pushed: {},
    cursors: {},
    lastSyncAt: {},
  };
}

let doc: DbDoc = emptyDoc();
let loaded = false;
let loading: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();

export class LocalError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;
  loading = (async () => {
    await initStorage();
    const raw = await readDoc();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DbDoc;
        doc = { ...emptyDoc(), ...parsed };
        if (!doc.appSecret) doc.appSecret = randomHex(32);
        if (!doc.lastBackupAt) doc.lastBackupAt = {};
        if (!Array.isArray(doc.upkeepDays)) doc.upkeepDays = [];
        if (!Array.isArray(doc.upkeepExemptions)) doc.upkeepExemptions = [];
        if (!Array.isArray(doc.upkeepConfigs)) doc.upkeepConfigs = [];
        if (!Array.isArray(doc.outbox)) doc.outbox = [];
        if (!doc.pushed) doc.pushed = {};
        if (!doc.cursors) doc.cursors = {};
        if (!doc.lastSyncAt) doc.lastSyncAt = {};
      } catch {
        doc = emptyDoc();
      }
    } else {
      doc = emptyDoc();
      await writeDoc(JSON.stringify(doc));
    }
    loaded = true;
  })();
  return loading;
}

/** 串行化写入，避免并发结算互相覆盖 */
function persist(): Promise<void> {
  // 每次落盘前把「本地已改、云端还没有」的行推进 outbox（乐观更新已经先发生了）
  try {
    enqueueDirtyRows();
  } catch {
    /* 同步层任何问题都不能影响本地写入 */
  }
  const snapshot = JSON.stringify(doc);
  writeChain = writeChain.then(() => writeDoc(snapshot)).catch(() => undefined);
  return writeChain;
}

function nextId(table: keyof DbDoc): number {
  const key = String(table);
  const cur = doc.seq[key] ?? 0;
  const id = cur + 1;
  doc.seq[key] = id;
  return id;
}

export function isStorageAvailable(): boolean {
  return storageAvailable();
}

// ---------------- 会话 ----------------
let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

function getSession(token: string | null): Session | undefined {
  if (!token) return undefined;
  return doc.sessions.find((s) => s.token === token);
}

async function createSession(userId: number, remember: boolean, ttlMs = 30 * 24 * 60 * 60 * 1000): Promise<string> {
  const token = randomHex(32);
  doc.sessions.push({ token, userId, expiresAt: Date.now() + ttlMs, createdAt: Date.now() });
  doc.rememberedToken = remember ? token : null;
  authToken = token;
  await persist();
  return token;
}

function purgeExpiredSessions() {
  const now = Date.now();
  doc.sessions = doc.sessions.filter((s) => s.expiresAt >= now);
}

function requireUserId(): number {
  const session = getSession(authToken);
  if (!session) throw new LocalError("未登录，请重新登录", 401);
  if (session.expiresAt < Date.now()) {
    doc.sessions = doc.sessions.filter((s) => s.token !== session.token);
    if (doc.rememberedToken === session.token) doc.rememberedToken = null;
    void persist();
    throw new LocalError("会话已过期，请重新登录", 401);
  }
  if (!getUser(session.userId)) {
    doc.sessions = doc.sessions.filter((s) => s.token !== session.token);
    void persist();
    throw new LocalError("账号不存在，请重新登录", 401);
  }
  return session.userId;
}

// ---------------- 登录限流（内存，按用户名） ----------------
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 8;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string) {
  const k = key.trim().toLowerCase() || "(anonymous)";
  const now = Date.now();
  const cur = attempts.get(k);
  if (!cur || cur.resetAt < now) {
    attempts.set(k, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  cur.count += 1;
  if (cur.count > RATE_MAX) throw new LocalError("尝试次数过多，请 15 分钟后再试", 429);
}

function clearRate(key: string) {
  attempts.delete(key.trim().toLowerCase());
}

// ---------------- 基础读取 ----------------
function getUser(id: number): User | undefined {
  return doc.users.find((u) => u.id === id);
}

function getUserByUsername(username: string): User | undefined {
  return doc.users.find((u) => u.username === username);
}

function getProficiency(userId: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of CATEGORY_KEYS) out[c] = 0;
  for (const r of doc.proficiency.filter((p) => p.userId === userId)) out[r.category] = r.value;
  return out;
}

function addProficiency(userId: number, category: string, delta: number) {
  const row = doc.proficiency.find((p) => p.userId === userId && p.category === category);
  if (row) row.value = Math.max(0, row.value + delta);
  else doc.proficiency.push({ id: nextId("proficiency"), userId, category, value: Math.max(0, delta) });
}

function listTasks(userId: number): Task[] {
  return doc.tasks.filter((t) => t.userId === userId && !t.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
}

function getTask(id: number): Task | undefined {
  return doc.tasks.find((t) => t.id === id && !t.deletedAt);
}

function listRewards(userId: number): Reward[] {
  return doc.rewards.filter((r) => r.userId === userId && !r.deletedAt);
}

function allLogs(userId: number): Log[] {
  return doc.logs.filter((l) => l.userId === userId);
}

/** 只有时间块 / 手动补记 / 番茄钟才计入专注时长；睡眠、娱乐、任务流水不算 */
const FOCUS_LOG_KINDS = new Set(["block", "manual", "focus", "focus_effort"]);

function isFocusLog(l: Log): boolean {
  return FOCUS_LOG_KINDS.has(l.kind);
}

function focusMinutesOf(l: Log): number {
  return isFocusLog(l) ? Math.max(0, l.minutes) : 0;
}

function unlockedNodes(userId: number): string[] {
  return doc.skillNodes.filter((n) => n.userId === userId).map((n) => n.nodeId);
}

function unlockedAchievementIds(userId: number): string[] {
  return doc.achievements.filter((a) => a.userId === userId).map((a) => a.achievementId);
}

function parseMilestones(t: Task): Milestone[] {
  try {
    return JSON.parse(t.milestones) as Milestone[];
  } catch {
    return [];
  }
}

function effectiveStreak(task: Task): number {
  if (task.mode !== "habit" || !task.lastPeriodKey) return 0;
  const period = task.period as "daily" | "weekly";
  const cur = periodKey(period);
  if (task.lastPeriodKey === cur) return task.streak;
  if (isConsecutivePeriod(period, task.lastPeriodKey, cur)) return task.streak;
  return 0;
}

function periodCheckins(task: Task): number {
  const period = task.period as "daily" | "weekly";
  const cur = periodKey(period);
  return doc.logs.filter(
    (l) => l.taskId === task.id && l.kind === "checkin" && periodKey(period, new Date(l.day + "T12:00:00")) === cur,
  ).length;
}

/** V3：按任务口径计算当前周期（或累计）进度；extra 用于结算前的预测 */
function taskMetricProgress(userId: number, task: Task, extra = 0): { current: number; target: number } {
  const { repeat, metric, amount } = normalizeTaskTarget(task);
  const logs = allLogs(userId).filter((l) => l.taskId === task.id);
  const curKey = repeat === "none" ? null : periodKey(repeat as "daily" | "weekly");
  const inPeriod = curKey
    ? logs.filter((l) => periodKey(repeat as "daily" | "weekly", new Date(l.day + "T12:00:00")) === curKey)
    : logs;
  let current = 0;
  if (metric === "checkin") {
    current = inPeriod.filter((l) => l.kind === "checkin" || l.kind === "makeup").length;
  } else if (metric === "blocks") {
    current = inPeriod
      .filter((l) => l.kind === "block" || l.kind === "manual")
      .reduce((a, l) => a + Math.max(1, Math.round(l.ratio)), 0);
  } else {
    current =
      repeat === "none"
        ? task.currentCount ?? 0
        : inPeriod.filter((l) => l.kind === "count").reduce((a, l) => a + Math.max(0, Math.round(l.ratio)), 0);
  }
  return { current: current + extra, target: amount };
}

/** V3：habit 模式达到本期目标后的下一段连续数（不落盘） */
function habitStreakNext(
  task: Task,
  userId: number,
  extra = 0,
): { streak: number; changed: boolean; message: string } {
  if (task.mode !== "habit") return { streak: effectiveStreak(task), changed: false, message: "" };
  const repeat = task.period as "daily" | "weekly";
  const curKey = periodKey(repeat);
  if (task.lastPeriodKey === curKey) return { streak: task.streak, changed: false, message: "" };
  const { current, target } = taskMetricProgress(userId, task, extra);
  if (current < target) return { streak: effectiveStreak(task), changed: false, message: "" };
  if (task.lastPeriodKey && isConsecutivePeriod(repeat, task.lastPeriodKey, curKey)) {
    return { streak: task.streak + 1, changed: true, message: "" };
  }
  return { streak: 1, changed: true, message: task.streak >= 3 ? "从今天重新开始，前面积累的熟练度一分没少。" : "" };
}

function commitHabitStreak(task: Task, next: { streak: number; changed: boolean; message: string }) {
  if (task.mode !== "habit" || !next.changed) return;
  task.streak = next.streak;
  task.bestStreak = Math.max(task.bestStreak, next.streak);
  task.lastPeriodKey = task.period === "weekly" ? periodKey("weekly") : periodKey("daily");
}

function maybeArchiveOneShot(task: Task, userId: number) {
  if (task.archived === 1 || task.finishOnTarget !== 1) return false;
  const { repeat } = normalizeTaskTarget(task);
  if (repeat !== "none") return false;
  const { current, target } = taskMetricProgress(userId, task);
  if (current >= target) {
    task.archived = 1;
    return true;
  }
  return false;
}

// ---------------- 计时器 ----------------
function getTimer(userId: number, taskId: number): Timer | undefined {
  return doc.timers.find((t) => t.userId === userId && t.taskId === taskId);
}

function elapsedMs(t: Timer): number {
  return t.accumulatedMs + (t.running && t.startedAt ? Date.now() - t.startedAt : 0);
}

function startTimer(userId: number, taskId: number): Timer {
  const existing = getTimer(userId, taskId);
  const now = Date.now();
  if (existing) {
    if (!existing.running) {
      existing.running = 1;
      existing.startedAt = now;
      existing.updatedAt = now;
    }
    return existing;
  }
  const t: Timer = {
    id: nextId("timers"),
    userId,
    taskId,
    startedAt: now,
    accumulatedMs: 0,
    running: 1,
    updatedAt: now,
  };
  doc.timers.push(t);
  return t;
}

function pauseTimer(userId: number, taskId: number): Timer | undefined {
  const t = getTimer(userId, taskId);
  if (!t || !t.running) return t;
  const now = Date.now();
  t.accumulatedMs = t.accumulatedMs + (now - t.startedAt);
  t.running = 0;
  t.startedAt = 0;
  t.updatedAt = now;
  return t;
}

function consumeTimer(userId: number, taskId: number, ms: number) {
  const t = getTimer(userId, taskId);
  if (!t) return;
  const now = Date.now();
  const remaining = Math.max(0, elapsedMs(t) - ms);
  t.accumulatedMs = remaining;
  t.startedAt = t.running ? now : 0;
  t.updatedAt = now;
}

function deleteTimer(userId: number, taskId: number) {
  doc.timers = doc.timers.filter((t) => !(t.userId === userId && t.taskId === taskId));
}

// ---------------- 全局专注计时器（V3） ----------------
function getFocusTimer(userId: number): FocusTimer | undefined {
  return doc.focusTimers.find((t) => t.userId === userId);
}

function focusElapsedMs(t: FocusTimer): number {
  return t.accumulatedMs + (t.running && t.startedAt ? Date.now() - t.startedAt : 0);
}

function deleteFocusTimer(userId: number) {
  doc.focusTimers = doc.focusTimers.filter((t) => t.userId !== userId);
}

// ---------------- 视图 ----------------
function taskView(userId: number, t: Task) {
  const ms = parseMilestones(t);
  const target = normalizeTaskTarget(t);
  const isTimerLike = t.mode === "timer" || (t.mode === "habit" && target.metric === "blocks");
  const timer = isTimerLike ? getTimer(userId, t.id) : undefined;
  const todayLogs = allLogs(userId).filter((l) => l.taskId === t.id && l.day === dateKey());
  const progress = taskMetricProgress(userId, t);
  return {
    ...t,
    repeat: target.repeat,
    targetMetric: target.metric,
    targetAmount: target.amount,
    finishOnTarget: t.finishOnTarget ?? 0,
    milestones: ms,
    effectiveStreak: t.mode === "habit" ? effectiveStreak(t) : 0,
    periodCheckins: t.mode === "habit" ? periodCheckins(t) : 0,
    todayBlocks:
      isTimerLike
        ? todayLogs
            .filter((l) => l.kind === "block" || l.kind === "manual")
            .reduce((a, l) => a + Math.max(1, Math.round(l.ratio)), 0)
        : 0,
    todayXp: todayLogs.reduce((a, l) => a + l.xp, 0),
    targetProgress: {
      current: progress.current,
      target: progress.target,
      label: `${repeatName(target.repeat)} · ${metricName(target.metric)}`,
    },
    timer: timer
      ? { running: !!timer.running, elapsedMs: elapsedMs(timer), startedAt: timer.startedAt, accumulatedMs: timer.accumulatedMs }
      : null,
  };
}

async function publicUser(id: number) {
  const u = getUser(id)!;
  const plainKey = await decryptSecretValue(u.aiApiKey, doc.appSecret);
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    xp: u.xp,
    points: u.points,
    theme: u.theme,
    aiConfigured: !!u.aiApiKey,
    hasKey: !!u.aiApiKey,
    aiBaseUrl: u.aiBaseUrl,
    aiModel: u.aiModel,
    aiKeyMasked: maskKey(plainKey),
    githubConfigured: !!u.githubToken,
    githubRepo: u.githubRepo || "",
    securityQuestion: u.securityQuestion,
    cloudUserId: u.cloudUserId ?? null,
    email: u.email ?? "",
  };
}

function todayTotals(userId: number) {
  const day = dateKey();
  const rows = allLogs(userId).filter((l) => l.day === day);
  const cats = Array.from(new Set(rows.filter((r) => r.xp > 0).map((r) => r.category)));
  return {
    xp: rows.reduce((a, r) => a + r.xp, 0),
    points: rows.reduce((a, r) => a + r.points, 0),
    minutes: rows.reduce((a, r) => a + focusMinutesOf(r), 0),
    settlements: rows.filter((r) => r.xp > 0).length,
    categories: cats,
  };
}

function buildSnapshot(userId: number): AchievementSnapshot {
  const user = getUser(userId)!;
  const logsAll = allLogs(userId);
  const taskList = listTasks(userId);
  const byDay = new Map<string, Set<number>>();
  const byWeek = new Map<string, Set<string>>();
  let totalMinutes = 0;
  for (const l of logsAll) {
    totalMinutes += focusMinutesOf(l);
    if (l.xp > 0) {
      if (!byDay.has(l.day)) byDay.set(l.day, new Set());
      byDay.get(l.day)!.add(l.taskId);
      const wk = weekKey(new Date(l.day + "T12:00:00"));
      if (!byWeek.has(wk)) byWeek.set(wk, new Set());
      byWeek.get(wk)!.add(l.category);
    }
  }
  let maxTasksInOneDay = 0;
  byDay.forEach((s) => (maxTasksInOneDay = Math.max(maxTasksInOneDay, s.size)));
  let balancedWeek = false;
  byWeek.forEach((s) => {
    if (CATEGORY_KEYS.every((c) => s.has(c))) balancedWeek = true;
  });
  const maxStreak = taskList.reduce((a, t) => Math.max(a, t.bestStreak), 0);
  const upkeep = upkeepSnapshot(userId);
  return {
    level: levelFromXp(user.xp),
    proficiency: getProficiency(userId),
    totalFocusMinutes: totalMinutes,
    maxStreak,
    maxTasksInOneDay,
    balancedWeek,
    upkeepBestAllMetStreak: upkeep.bestAllMetStreak,
    upkeepBestZeroSpendStreak: upkeep.bestZeroSpendStreak,
    upkeepPerfectWeekNoExemption: upkeep.perfectWeekNoExemption,
  };
}

function checkAchievements(userId: number): string[] {
  const snapshot = buildSnapshot(userId);
  const already = new Set(unlockedAchievementIds(userId));
  const newly: string[] = [];
  let bonus = 0;
  for (const a of ACHIEVEMENTS) {
    if (already.has(a.id)) continue;
    if (isAchieved(a, snapshot)) {
      doc.achievements.push({ id: nextId("achievements"), userId, achievementId: a.id, unlockedAt: Date.now() });
      newly.push(a.id);
      bonus += RARITY_META[a.rarity].reward;
    }
  }
  if (bonus > 0) {
    const u = getUser(userId)!;
    u.points += bonus;
  }
  return newly;
}

function inactiveDays(userId: number): number {
  const all = allLogs(userId).filter((l) => l.xp > 0);
  if (all.length === 0) return 0;
  let days = 0;
  for (let i = 0; i < 60; i++) {
    const key = dateKey(new Date(Date.now() - i * 86400000));
    if (all.some((l) => l.day === key)) break;
    days++;
  }
  return days;
}

// ---------------- 核心结算 ----------------
function applySettlement(opts: {
  userId: number;
  task: Task;
  kind: string;
  ratio: number;
  minutes?: number;
  day?: string;
  note?: string;
  ignoreStreak?: boolean;
  streakOverride?: number;
  sign?: 1 | -1;
  scale?: number;
}): { xp: number; points: number; prof: number; streakMul: number } {
  const { userId, task } = opts;
  const sign = opts.sign ?? 1;
  const day = opts.day ?? dateKey();
  const effects = effectsFor(unlockedNodes(userId), task.category);
  const dayLogs = allLogs(userId).filter((l) => l.day === day);
  const crossCategoryToday = dayLogs.some((l) => l.category !== task.category && l.xp > 0);
  const streak = opts.ignoreStreak ? 0 : opts.streakOverride ?? effectiveStreak(task);
  const urgencyMul = urgencyMultiplier(task.deadline || task.endDate, task.priority, day);

  const res = computeSettlement({
    xpPerUnit: task.xpPerUnit,
    pointsPerUnit: task.pointsPerUnit,
    profPerUnit: task.profPerUnit,
    difficulty: task.difficulty,
    ratio: opts.ratio,
    mode: task.mode as any,
    streak: opts.ignoreStreak ? 0 : streak,
    effects,
    crossCategoryToday,
    urgencyMul,
  });

  const scale = opts.scale ?? 1;
  const xp = Math.round(res.xp * scale) * sign;
  const points = Math.round(res.points * scale) * sign;
  const prof = res.prof * sign;
  const minutes = (opts.minutes ?? 0) * sign;

  const user = getUser(userId)!;
  user.xp = Math.max(0, user.xp + xp);
  user.points = Math.max(0, user.points + points);
  addProficiency(userId, task.category, prof);
  doc.logs.push({
    id: nextId("logs"),
    userId,
    taskId: task.id,
    taskTitle: task.title,
    category: task.category,
    mode: task.mode,
    kind: opts.kind,
    day,
    xp,
    points,
    prof,
    minutes,
    ratio: opts.ratio * sign,
    note: opts.note ?? "",
    createdAt: Date.now(),
  });
  return { xp, points, prof, streakMul: res.streakMul };
}

function finishBonus(userId: number, task: Task, sign: 1 | -1 = 1) {
  const effects = effectsFor(unlockedNodes(userId), task.category);
  const rate = effects.summit ? FINISH_BONUS_RATE_BOOSTED : FINISH_BONUS_RATE;
  const r = applySettlement({
    userId,
    task,
    kind: sign === 1 ? "finish" : "finish_undo",
    ratio: rate,
    note: sign === 1 ? `收官奖励 ${Math.round(rate * 100)}%` : `回收收官奖励`,
    ignoreStreak: true,
    sign,
  });
  return { xp: r.xp, points: r.points, prof: r.prof };
}

/** 自由专注 / 努力奖励 / 娱乐超时调整的落账（仍是只追加流水） */
function pushFocusLog(opts: {
  userId: number;
  taskId: number | null;
  taskTitle: string;
  category: string;
  mode: string;
  kind: string;
  xp: number;
  points: number;
  prof: number;
  minutes: number;
  note: string;
  day?: string;
}) {
  const user = getUser(opts.userId)!;
  user.xp = Math.max(0, user.xp + opts.xp);
  user.points = Math.max(0, user.points + opts.points);
  if (opts.prof !== 0) addProficiency(opts.userId, opts.category, opts.prof);
  doc.logs.push({
    id: nextId("logs"),
    uid: newUid(),
    userId: opts.userId,
    taskId: opts.taskId ?? 0,
    taskTitle: opts.taskTitle,
    category: opts.category,
    mode: opts.mode,
    kind: opts.kind,
    day: opts.day ?? dateKey(),
    xp: opts.xp,
    points: opts.points,
    prof: opts.prof,
    minutes: opts.minutes,
    ratio: opts.minutes > 0 ? Math.max(0, opts.minutes / 60) : opts.points < 0 ? -1 : 0,
    note: opts.note,
    createdAt: Date.now(),
  });
}

// ---------------- 账号 ----------------
const DEFAULT_REWARDS: InsertReward[] = [
  { name: "看一部电影", description: "挑一部一直想看的片子，完整看完不刷手机", cost: 200, emoji: "🎬", stock: -1, tag: "休闲" },
  { name: "一杯手冲咖啡", description: "去喜欢的那家店坐一会儿", cost: 120, emoji: "☕", stock: -1, tag: "小确幸" },
  { name: "买一本想要的书", description: "书单里排最前面的那本", cost: 500, emoji: "📚", stock: -1, tag: "学习" },
  { name: "打一晚游戏不设限", description: "彻底放松，不带负罪感", cost: 350, emoji: "🎮", stock: -1, tag: "休闲" },
  { name: "睡到自然醒", description: "不设闹钟的一个早上", cost: 300, emoji: "😴", stock: -1, tag: "恢复" },
  { name: "一次好好的下馆子", description: "点想吃的，不看价格", cost: 800, emoji: "🍜", stock: -1, tag: "美食" },
  { name: "周末一日游", description: "去城市周边走一天", cost: 2000, emoji: "🚞", stock: -1, tag: "旅行" },
  { name: "换一件想要的装备", description: "犒劳自己一件耐用好物", cost: 5000, emoji: "🎧", stock: 1, tag: "犒赏" },
];

async function createUserRecord(data: {
  username: string;
  password: string;
  displayName?: string;
  securityQuestion: string;
  securityAnswer: string;
}): Promise<User> {
  const user: User = {
    id: nextId("users"),
    username: data.username,
    password: await hashSecret(data.password),
    displayName: data.displayName?.trim() || data.username,
    securityQuestion: data.securityQuestion,
    securityAnswer: await hashSecret(data.securityAnswer.trim().toLowerCase()),
    xp: 0,
    points: 0,
    theme: "dark",
    aiBaseUrl: "https://api.deepseek.com/v1",
    aiApiKey: "",
    aiModel: "deepseek-chat",
    createdAt: Date.now(),
  };
  doc.users.push(user);
  for (const c of CATEGORY_KEYS) {
    doc.proficiency.push({ id: nextId("proficiency"), userId: user.id, category: c, value: 0 });
  }
  for (const r of DEFAULT_REWARDS) {
    doc.rewards.push({ ...r, id: nextId("rewards"), userId: user.id, createdAt: Date.now() });
  }
  return user;
}

function createTaskRecord(userId: number, data: InsertTask): Task {
  const ms: Milestone[] = (data.milestones ?? []).map((m, i) => ({
    id: m.id || `m${i + 1}`,
    title: m.title,
    weight: m.weight || 1,
    done: false,
  }));
  const target = normalizeTaskTarget({ ...data, mode: data.mode });
  const repeat = data.repeat ?? target.repeat;
  const metric = data.targetMetric ?? target.metric;
  const amount = data.targetAmount ?? target.amount;
  const deadline = data.deadline || data.endDate || "";
  const t: Task = {
    id: nextId("tasks"),
    userId,
    title: data.title,
    category: data.category,
    mode: data.mode,
    difficulty: data.difficulty,
    xpPerUnit: data.xpPerUnit,
    pointsPerUnit: data.pointsPerUnit,
    profPerUnit: data.profPerUnit,
    notes: data.notes ?? "",
    startDate: data.startDate ?? "",
    endDate: data.endDate || deadline,
    archived: 0,
    blockMinutes: data.blockMinutes,
    dailyTargetBlocks: data.dailyTargetBlocks,
    milestones: JSON.stringify(ms),
    finishBonusGranted: 0,
    period: data.period,
    targetPerPeriod: data.targetPerPeriod,
    streak: 0,
    bestStreak: 0,
    lastPeriodKey: "",
    unitName: data.unitName,
    targetCount: data.targetCount,
    currentCount: 0,
    createdAt: Date.now(),
    repeat,
    targetMetric: metric,
    targetAmount: amount,
    finishOnTarget: data.finishOnTarget ?? 0,
    priority: data.priority ?? 0,
    deadline,
    dailyBudgetCents: data.dailyBudgetCents,
  };
  // 让旧字段与新口径保持同步，云端旧列与旧版本 UI 都能继续工作
  if (t.mode === "timer") t.dailyTargetBlocks = amount;
  if (t.mode === "habit") {
    t.period = repeat;
    if (metric === "checkin") t.targetPerPeriod = amount;
  }
  if (t.mode === "count") t.targetCount = amount;
  doc.tasks.push(t);
  return t;
}

function clearUserData(userId: number) {
  doc.tasks = doc.tasks.filter((t) => t.userId !== userId);
  doc.logs = doc.logs.filter((l) => l.userId !== userId);
  doc.timers = doc.timers.filter((t) => t.userId !== userId);
  doc.focusTimers = doc.focusTimers.filter((t) => t.userId !== userId);
  doc.achievements = doc.achievements.filter((a) => a.userId !== userId);
  doc.skillNodes = doc.skillNodes.filter((n) => n.userId !== userId);
  doc.redemptions = doc.redemptions.filter((r) => r.userId !== userId);
  doc.upkeepDays = doc.upkeepDays.filter((r) => r.userId !== userId);
  doc.upkeepExemptions = doc.upkeepExemptions.filter((r) => r.userId !== userId);
  doc.journals = doc.journals.filter((r) => r.userId !== userId);
  doc.sleepLogs = doc.sleepLogs.filter((r) => r.userId !== userId);
  delete doc.sleepSettings[userId];
  doc.expenses = doc.expenses.filter((r) => r.userId !== userId);
  doc.plannerSessions = doc.plannerSessions.filter((r) => r.userId !== userId);
  const u = getUser(userId);
  if (u) {
    u.xp = 0;
    u.points = 0;
  }
  for (const p of doc.proficiency.filter((p) => p.userId === userId)) p.value = 0;
}

// ============================================================
// 对外操作（原 Express 路由的逻辑等价物）
// ============================================================

export async function bootstrap() {
  await ensureLoaded();
  return { hasUsers: doc.users.length > 0, storageAvailable: storageAvailable() };
}

export async function register(input: unknown, remember = true) {
  await ensureLoaded();
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw new LocalError(parsed.error.issues[0]?.message ?? "参数有误");
  if (getUserByUsername(parsed.data.username)) throw new LocalError("该用户名已被使用");
  const user = await createUserRecord(parsed.data);
  const token = await createSession(user.id, remember);
  return { user: await publicUser(user.id), token };
}

export async function login(input: unknown, remember = true) {
  await ensureLoaded();
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new LocalError("请输入用户名与密码");
  rateLimit(`login:${parsed.data.username}`);
  const user = getUserByUsername(parsed.data.username);
  // 不区分「用户不存在」与「密码错误」，避免用户名枚举
  const ok = user ? await verifySecret(parsed.data.password, user.password) : false;
  if (!user || !ok) throw new LocalError("用户名或密码不正确", 401);
  clearRate(`login:${parsed.data.username}`);
  purgeExpiredSessions();
  const token = await createSession(user.id, remember);
  return { user: await publicUser(user.id), token };
}

export async function logout() {
  await ensureLoaded();
  if (authToken) {
    doc.sessions = doc.sessions.filter((s) => s.token !== authToken);
    if (doc.rememberedToken === authToken) doc.rememberedToken = null;
  }
  authToken = null;
  await persist();
  return { ok: true };
}

/** 页面刷新后恢复「记住登录状态」的会话 */
export async function restoreSession() {
  await ensureLoaded();
  const token = doc.rememberedToken;
  if (!token) return { user: null, token: null };
  const session = getSession(token);
  if (!session || session.expiresAt < Date.now() || !getUser(session.userId)) {
    doc.rememberedToken = null;
    doc.sessions = doc.sessions.filter((s) => s.token !== token);
    await persist();
    return { user: null, token: null };
  }
  authToken = token;
  return { user: await publicUser(session.userId), token };
}

export async function getSecurityQuestion(username: string) {
  await ensureLoaded();
  rateLimit(`reset:${username}`);
  const user = getUserByUsername(username);
  if (!user) throw new LocalError("无法获取安全问题，请核对用户名", 404);
  return { question: user.securityQuestion };
}

export async function resetPassword(input: unknown) {
  await ensureLoaded();
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) throw new LocalError(parsed.error.issues[0]?.message ?? "参数有误");
  rateLimit(`reset:${parsed.data.username}`);
  const user = getUserByUsername(parsed.data.username);
  const ok = user ? await verifySecret(parsed.data.answer.trim().toLowerCase(), user.securityAnswer) : false;
  if (!user || !ok) throw new LocalError("用户名或安全问题答案不正确");
  user.password = await hashSecret(parsed.data.newPassword);
  // 密码重置后失效所有旧会话
  doc.sessions = doc.sessions.filter((s) => s.userId !== user.id);
  doc.rememberedToken = null;
  clearRate(`reset:${parsed.data.username}`);
  await persist();
  return { ok: true };
}

export async function changePassword(oldPassword: string, newPassword: string) {
  await ensureLoaded();
  const userId = requireUserId();
  const user = getUser(userId)!;
  if (!(await verifySecret(String(oldPassword ?? ""), user.password))) throw new LocalError("原密码不正确");
  if (String(newPassword ?? "").length < 6) throw new LocalError("新密码至少 6 位");
  user.password = await hashSecret(newPassword);
  await persist();
  return { ok: true };
}

export async function getProfile() {
  await ensureLoaded();
  const userId = requireUserId();
  const u = getUser(userId)!;
  const lp = levelProgress(u.xp);
  const prof = getProficiency(userId);
  const topProfCategory = CATEGORY_KEYS.slice().sort((a, b) => (prof[b] ?? 0) - (prof[a] ?? 0))[0] ?? "academic";
  return {
    user: await publicUser(userId),
    ...lp,
    proficiency: prof,
    proficiencyTiers: Object.fromEntries(CATEGORY_KEYS.map((c) => [c, proficiencyTier(prof[c] ?? 0)])),
    unlockedNodes: unlockedNodes(userId),
    unlockedAchievements: unlockedAchievementIds(userId),
    today: todayTotals(userId),
    snapshot: buildSnapshot(userId),
    inactiveDays: inactiveDays(userId),
    topProfCategory,
    topProfCategoryName: categoryName(topProfCategory),
    backup: backupStatus(userId),
  };
}

// ---------------- 任务 ----------------
export async function getTasks() {
  await ensureLoaded();
  const userId = requireUserId();
  return listTasks(userId).map((t) => taskView(userId, t));
}

export async function createTask(input: unknown) {
  await ensureLoaded();
  const userId = requireUserId();
  const parsed = insertTaskSchema.safeParse(input);
  if (!parsed.success) throw new LocalError(parsed.error.issues[0]?.message ?? "任务参数有误");
  const task = createTaskRecord(userId, parsed.data);
  await persist();
  return taskView(userId, task);
}

export async function updateTask(id: number, body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const existing = getTask(id);
  if (!existing || existing.userId !== userId) throw new LocalError("任务不存在", 404);
  const partial = insertTaskSchema.partial().safeParse(body?.task ?? {});
  if (!partial.success) throw new LocalError(partial.error.issues[0]?.message ?? "参数有误");
  const patch: any = { ...partial.data };
  if (partial.data.repeat !== undefined || partial.data.targetMetric !== undefined || partial.data.targetAmount !== undefined) {
    const next = normalizeTaskTarget({ ...existing, ...partial.data, mode: existing.mode });
    patch.repeat = next.repeat;
    patch.targetMetric = next.metric;
    patch.targetAmount = next.amount;
    if (existing.mode === "timer") patch.dailyTargetBlocks = next.amount;
    if (existing.mode === "habit") {
      patch.period = next.repeat;
      if (next.metric === "checkin") patch.targetPerPeriod = next.amount;
    }
    if (existing.mode === "count") patch.targetCount = next.amount;
  }
  if (partial.data.deadline !== undefined) patch.endDate = partial.data.deadline || patch.endDate || "";
  if (partial.data.endDate !== undefined) patch.deadline = partial.data.endDate || patch.deadline || "";
  if (typeof body?.archived === "number") patch.archived = body.archived;
  if (partial.data.milestones) {
    const old = parseMilestones(existing);
    patch.milestones = JSON.stringify(
      partial.data.milestones.map((m, i) => ({
        id: m.id || `m${i + 1}`,
        title: m.title,
        weight: m.weight || 1,
        done: old.find((o) => o.id === m.id)?.done ?? false,
      })),
    );
  }
  Object.assign(existing, patch);
  await persist();
  return taskView(userId, existing);
}

export async function deleteTask(id: number) {
  await ensureLoaded();
  const userId = requireUserId();
  const t = getTask(id);
  if (!t || t.userId !== userId) throw new LocalError("任务不存在", 404);
  // 软删墓碑：同步需要墓碑，且结算日志是只追加的（删任务不回收已得数值）
  t.deletedAt = Date.now();
  t.updatedAt = t.deletedAt;
  doc.timers = doc.timers.filter((x) => x.taskId !== id);
  await persist();
  return { ok: true };
}

// ---------------- 计时器 ----------------
export async function timerAction(taskId: number, action: string) {
  await ensureLoaded();
  const userId = requireUserId();
  const task = getTask(taskId);
  if (!task || task.userId !== userId) throw new LocalError("任务不存在", 404);

  if (action === "start") {
    startTimer(userId, taskId);
    await persist();
    return { ok: true, timer: taskView(userId, task).timer };
  }
  if (action === "pause") {
    pauseTimer(userId, taskId);
    await persist();
    return { ok: true, timer: taskView(userId, task).timer };
  }
  if (action === "abandon") {
    deleteTimer(userId, taskId);
    await persist();
    return { ok: true, timer: null, message: "已放弃本次计时，没有任何扣减。" };
  }
  if (action === "claim" || action === "complete") {
    const timer = getTimer(userId, taskId);
    if (!timer) throw new LocalError("计时器未启动");
    const elapsed = elapsedMs(timer);
    const blockMs = task.blockMinutes * 60 * 1000;
    const blocks = Math.floor(elapsed / blockMs);
    if (blocks < 1) {
      if (action === "complete") {
        deleteTimer(userId, taskId);
        await persist();
        return {
          ok: true,
          gained: { xp: 0, points: 0, prof: 0, minutes: 0 },
          newAchievements: [],
          message: `不足一个专注块（${task.blockMinutes} 分钟），本次未结算，但时间没有白费。`,
        };
      }
      throw new LocalError("尚未满一个专注块");
    }
    const target = normalizeTaskTarget(task);
    const next =
      task.mode === "habit" && target.metric === "blocks"
        ? habitStreakNext(task, userId, blocks)
        : null;
    const guard = overworkScaleFor(userId, blocks * task.blockMinutes);
    const before = levelFromXp(getUser(userId)!.xp);
    const r = applySettlement({
      userId,
      task,
      kind: "block",
      ratio: blocks,
      minutes: blocks * task.blockMinutes,
      note: `完成 ${blocks} 个专注块${guard.over ? "（超过今日建议值，产出 20%）" : ""}`,
      ignoreStreak: task.mode !== "habit",
      streakOverride: next?.changed ? next.streak : undefined,
      scale: guard.scale,
    });
    commitHabitStreak(task, next ?? { streak: 0, changed: false, message: "" });
    if (action === "complete") deleteTimer(userId, taskId);
    else consumeTimer(userId, taskId, blocks * blockMs);
    maybeArchiveOneShot(task, userId);
    const after = levelFromXp(getUser(userId)!.xp);
    const newAchievements = checkAchievements(userId);
    await persist();
    return {
      ok: true,
      gained: { xp: r.xp, points: r.points, prof: r.prof, minutes: blocks * task.blockMinutes },
      blocks,
      levelUp: after > before ? { from: before, to: after, title: levelTitle(after) } : null,
      newAchievements,
      message: `完成 ${blocks} 个专注块${guard.over ? "（已超过今日建议专注时长，产出降至 20%，强烈建议休息）" : ""}`,
    };
  }
  throw new LocalError("未知操作");
}

export async function manualTime(taskId: number, body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const task = getTask(taskId);
  if (!task || task.userId !== userId) throw new LocalError("任务不存在", 404);
  const minutes = Math.max(0, Math.floor(Number(body?.minutes) || 0));
  const day = String(body?.day || dateKey());
  const blocks = Math.floor(minutes / task.blockMinutes);
  if (blocks < 1) throw new LocalError(`不足一个专注块（${task.blockMinutes} 分钟），无法结算`);
  const target = normalizeTaskTarget(task);
  const next =
    task.mode === "habit" && target.metric === "blocks"
      ? habitStreakNext(task, userId, blocks)
      : null;
  const guard =
    day === dateKey()
      ? overworkScaleFor(userId, blocks * task.blockMinutes)
      : { scale: 1, over: false, cap: 0, todayMinutes: 0 };
  const before = levelFromXp(getUser(userId)!.xp);
  const r = applySettlement({
    userId,
    task,
    kind: "manual",
    ratio: blocks,
    minutes: blocks * task.blockMinutes,
    day,
    note: `补记 ${minutes} 分钟${guard.over ? "（超过今日建议值，产出 20%）" : ""}`,
    ignoreStreak: task.mode !== "habit",
    streakOverride: next?.changed ? next.streak : undefined,
    scale: guard.scale,
  });
  commitHabitStreak(task, next ?? { streak: 0, changed: false, message: "" });
  maybeArchiveOneShot(task, userId);
  const after = levelFromXp(getUser(userId)!.xp);
  const newAchievements = checkAchievements(userId);
  await persist();
  return {
    ok: true,
    gained: { xp: r.xp, points: r.points, prof: r.prof, minutes: blocks * task.blockMinutes },
    blocks,
    levelUp: after > before ? { from: before, to: after, title: levelTitle(after) } : null,
    newAchievements,
    message: `补记 ${blocks} 个专注块${guard.over ? "（已超过今日建议专注时长，产出降至 20%）" : ""}`,
  };
}

// ---------------- 里程碑 ----------------
export async function toggleMilestone(taskId: number, body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const task = getTask(taskId);
  if (!task || task.userId !== userId) throw new LocalError("任务不存在", 404);
  const milestoneId = String(body?.milestoneId ?? "");
  const done = !!body?.done;
  const ms = parseMilestones(task);
  const target = ms.find((m) => m.id === milestoneId);
  if (!target) throw new LocalError("里程碑节点不存在", 404);
  if (target.done === done) return { ok: true, gained: { xp: 0, points: 0, prof: 0, minutes: 0 }, newAchievements: [] };
  const totalWeight = ms.reduce((a, m) => a + (m.weight || 1), 0) || 1;
  const ratio = (target.weight || 1) / totalWeight;
  const before = levelFromXp(getUser(userId)!.xp);

  const r = applySettlement({
    userId,
    task,
    kind: done ? "milestone" : "milestone_undo",
    ratio,
    note: `${done ? "完成" : "撤销"}节点「${target.title}」`,
    sign: done ? 1 : -1,
    ignoreStreak: true,
  });

  target.done = done;
  const allDone = ms.every((m) => m.done);
  const hadBonus = task.finishBonusGranted;
  task.milestones = JSON.stringify(ms);
  let bonus: { xp: number; points: number; prof: number } | null = null;
  if (allDone && !hadBonus) {
    bonus = finishBonus(userId, task);
    task.finishBonusGranted = 1;
  } else if (!allDone && hadBonus) {
    finishBonus(userId, task, -1);
    task.finishBonusGranted = 0;
  }
  const after = levelFromXp(getUser(userId)!.xp);
  const newAchievements = checkAchievements(userId);
  await persist();
  return {
    ok: true,
    gained: { xp: r.xp, points: r.points, prof: r.prof, minutes: 0 },
    finishBonus: bonus,
    levelUp: after > before ? { from: before, to: after, title: levelTitle(after) } : null,
    newAchievements,
    message: done ? `节点「${target.title}」已完成` : `已撤销「${target.title}」，奖励同步回收`,
  };
}

// ---------------- 打卡 ----------------
export async function checkin(taskId: number, body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const task = getTask(taskId);
  if (!task || task.userId !== userId) throw new LocalError("任务不存在", 404);
  const percent = Math.max(1, Math.min(100, Math.round(Number(body?.percent ?? 100))));
  const ratio = percent / 100;
  const day = String(body?.day || dateKey());
  const isMakeup = day !== dateKey();
  if (isMakeup) {
    const diff = Math.round(
      (new Date(dateKey() + "T00:00:00").getTime() - new Date(day + "T00:00:00").getTime()) / 86400000,
    );
    if (diff < 0 || diff > MAKEUP_DAYS) throw new LocalError(`只能为过去 ${MAKEUP_DAYS} 天内的漏签补卡`);
  }

  const next = isMakeup
    ? { streak: 0, changed: false, message: "" }
    : habitStreakNext(task, userId, 1);
  const streak = isMakeup ? 0 : next.changed ? next.streak : effectiveStreak(task);

  const before = levelFromXp(getUser(userId)!.xp);
  const r = applySettlement({
    userId,
    task,
    kind: isMakeup ? "makeup" : "checkin",
    ratio,
    day,
    note: isMakeup ? `补签 ${percent}%` : `打卡 ${percent}%`,
    ignoreStreak: isMakeup,
    streakOverride: isMakeup ? 0 : streak,
  });

  commitHabitStreak(task, next);
  const after = levelFromXp(getUser(userId)!.xp);
  const newAchievements = checkAchievements(userId);
  await persist();
  return {
    ok: true,
    gained: { xp: r.xp, points: r.points, prof: r.prof, minutes: 0 },
    streak: next.changed ? next.streak : effectiveStreak(task),
    streakMul: r.streakMul,
    levelUp: after > before ? { from: before, to: after, title: levelTitle(after) } : null,
    newAchievements,
    message: next.message || (isMakeup ? `补签成功（补签不计入连续加成）` : `打卡成功 ${percent}%`),
  };
}

// ---------------- 计件 ----------------
export async function countUp(taskId: number, body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const task = getTask(taskId);
  if (!task || task.userId !== userId) throw new LocalError("任务不存在", 404);
  const delta = Math.max(1, Math.min(100000, Math.floor(Number(body?.delta ?? 1))));
  const target = normalizeTaskTarget(task);
  const next = task.mode === "habit" ? habitStreakNext(task, userId, delta) : null;
  const before = levelFromXp(getUser(userId)!.xp);
  const r = applySettlement({
    userId,
    task,
    kind: "count",
    ratio: delta,
    note: `+${delta} ${task.unitName}`,
    ignoreStreak: task.mode !== "habit",
    streakOverride: next?.changed ? next.streak : undefined,
  });
  commitHabitStreak(task, next ?? { streak: 0, changed: false, message: "" });
  const newCount = task.currentCount + delta;
  const hadBonus = task.finishBonusGranted;
  task.currentCount = newCount;
  let bonus: { xp: number; points: number; prof: number } | null = null;
  if (target.repeat === "none" && newCount >= target.amount && !hadBonus) {
    bonus = finishBonus(userId, task);
    task.finishBonusGranted = 1;
  }
  maybeArchiveOneShot(task, userId);
  const after = levelFromXp(getUser(userId)!.xp);
  const newAchievements = checkAchievements(userId);
  await persist();
  return {
    ok: true,
    gained: { xp: r.xp, points: r.points, prof: r.prof, minutes: 0 },
    finishBonus: bonus,
    levelUp: after > before ? { from: before, to: after, title: levelTitle(after) } : null,
    newAchievements,
    message: `+${delta} ${task.unitName}`,
  };
}

// ---------------- 全局专注计时器（V3 / 番茄钟） ----------------
function focusView(userId: number) {
  const t = getFocusTimer(userId);
  if (!t) return { running: false, elapsedMs: 0, kind: "focus" as const, taskId: null, capMinutes: 60 };
  return {
    running: !!t.running,
    elapsedMs: focusElapsedMs(t),
    kind: t.kind,
    taskId: t.taskId,
    capMinutes: t.capMinutes,
  };
}

export async function focusState() {
  await ensureLoaded();
  const userId = requireUserId();
  return focusView(userId);
}

export async function focusStart(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const kind = body?.kind === "game" ? "game" : "focus";
  const capMinutes = Math.max(10, Math.min(600, Math.floor(Number(body?.capMinutes) || 60)));
  const taskId = body?.taskId ? Number(body.taskId) : null;
  if (taskId != null) {
    const task = getTask(taskId);
    if (!task || task.userId !== userId) throw new LocalError("任务不存在", 404);
  }
  const existing = getFocusTimer(userId);
  if (existing) {
    if (existing.running) return { ok: true, timer: focusView(userId) };
    existing.running = 1;
    existing.startedAt = Date.now();
    existing.updatedAt = Date.now();
    await persist();
    return { ok: true, timer: focusView(userId) };
  }
  const now = Date.now();
  doc.focusTimers.push({
    id: nextId("focusTimers"),
    userId,
    taskId,
    kind,
    startedAt: now,
    accumulatedMs: 0,
    running: 1,
    capMinutes,
    updatedAt: now,
  });
  await persist();
  return { ok: true, timer: focusView(userId) };
}

export async function focusPause() {
  await ensureLoaded();
  const userId = requireUserId();
  const t = getFocusTimer(userId);
  if (!t || !t.running) return { ok: true, timer: focusView(userId) };
  const now = Date.now();
  t.accumulatedMs = focusElapsedMs(t);
  t.running = 0;
  t.startedAt = 0;
  t.updatedAt = now;
  await persist();
  return { ok: true, timer: focusView(userId) };
}

export async function focusAbandon() {
  await ensureLoaded();
  const userId = requireUserId();
  deleteFocusTimer(userId);
  await persist();
  return { ok: true, timer: focusView(userId), message: "已放弃本次计时，没有任何结算。" };
}

export async function focusStop(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const t = getFocusTimer(userId);
  if (!t) throw new LocalError("没有正在运行的计时器");
  const before = levelFromXp(getUser(userId)!.xp);
  const elapsedMs = focusElapsedMs(t);
  const minutes = Math.floor(elapsedMs / 60000);
  const day = String(body?.day || dateKey());
  const taskId =
    body?.taskId !== undefined && body.taskId !== null && body.taskId !== ""
      ? Number(body.taskId)
      : t.taskId;
  const task = taskId ? getTask(taskId) : undefined;
  if (taskId && !task) throw new LocalError("任务不存在", 404);
  deleteFocusTimer(userId);
  const guard =
    day === dateKey() && t.kind !== "game"
      ? overworkScaleFor(userId, minutes)
      : { scale: 1, over: false, cap: 0, todayMinutes: 0 };

  const gained = { xp: 0, points: 0, prof: 0, minutes: 0 };
  let message = "";

  if (t.kind === "game") {
    const overMinutes = Math.max(0, minutes - t.capMinutes);
    const penalty = Math.min(30, Math.floor(overMinutes / 15) * 5);
    if (elapsedMs > 0 && minutes <= t.capMinutes) {
      gained.points += 2;
      pushFocusLog({
        userId,
        taskId: null,
        taskTitle: "娱乐计时",
        category: "life",
        mode: "game",
        kind: "focus_control",
        xp: 0,
        points: 2,
        prof: 0,
        minutes,
        note: `守住娱乐上限 ${t.capMinutes} 分钟，自控奖励 +2 分`,
        day,
      });
      message = `守住 ${t.capMinutes} 分钟上限，获得 +2 分自控奖励。`;
    } else if (penalty > 0) {
      gained.points -= penalty;
      pushFocusLog({
        userId,
        taskId: null,
        taskTitle: "娱乐超时",
        category: "life",
        mode: "game",
        kind: "focus_penalty",
        xp: 0,
        points: -penalty,
        prof: 0,
        minutes,
        note: `娱乐 ${minutes} 分钟，超过 ${t.capMinutes} 分钟上限，温和扣除 ${penalty} 分`,
        day,
      });
      message = `超过娱乐上限 ${t.capMinutes} 分钟共 ${overMinutes} 分钟，温和扣除 ${penalty} 分（单次封顶 30 分）。`;
    } else {
      message = "本次娱乐未超过上限，无扣分。";
    }
  } else if (task) {
    const target = normalizeTaskTarget(task);
    const isTimerLike = task.mode === "timer" || (task.mode === "habit" && target.metric === "blocks");
    if (isTimerLike) {
      const blockMs = task.blockMinutes * 60 * 1000;
      const blocks = Math.floor(elapsedMs / blockMs);
      if (blocks >= 1) {
        const next =
          task.mode === "habit" && target.metric === "blocks"
            ? habitStreakNext(task, userId, blocks)
            : null;
        const r = applySettlement({
          userId,
          task,
          kind: "block",
          ratio: blocks,
          minutes: blocks * task.blockMinutes,
          note: `番茄钟完成 ${blocks} 个专注块${guard.over ? "（超过今日建议值，产出 20%）" : ""}`,
          ignoreStreak: task.mode !== "habit",
          streakOverride: next?.changed ? next.streak : undefined,
          scale: guard.scale,
        });
        commitHabitStreak(task, next ?? { streak: 0, changed: false, message: "" });
        maybeArchiveOneShot(task, userId);
        gained.xp += r.xp;
        gained.points += r.points;
        gained.prof += r.prof;
        gained.minutes += blocks * task.blockMinutes;
        message = `已计入 ${blocks} 个专注块（${r.xp} XP）。${guard.over ? " 已超过今日建议专注时长，产出降至 20%，强烈建议休息。" : ""}`;
      }
      const leftoverMinutes = Math.floor((elapsedMs - blocks * blockMs) / 60000);
      if (leftoverMinutes >= 5) {
        const effXp = Math.round(((task.xpPerUnit * leftoverMinutes) / 60) * guard.scale);
        const effPts = Math.round(((task.pointsPerUnit * leftoverMinutes) / 60) * guard.scale);
        const effProf = Math.max(1, Math.round((task.profPerUnit * leftoverMinutes) / 60));
        pushFocusLog({
          userId,
          taskId,
          taskTitle: task.title,
          category: task.category,
          mode: task.mode,
          kind: "focus_effort",
          xp: effXp,
          points: effPts,
          prof: effProf,
          minutes: leftoverMinutes,
          note: `未满一个专注块的零散投入 ${leftoverMinutes} 分钟${guard.over ? "（产出 20%）" : ""}`,
          day,
        });
        gained.xp += effXp;
        gained.points += effPts;
        gained.prof += effProf;
        gained.minutes += leftoverMinutes;
        message += `零散 ${leftoverMinutes} 分钟也已记入少量奖励。`;
      }
      if (!message) message = "本次专注未满一个完整专注块，建议再多坚持一会儿。";
    } else {
      const effXp = Math.round(((task.xpPerUnit * minutes) / 60) * guard.scale);
      const effPts = Math.round(((task.pointsPerUnit * minutes) / 60) * guard.scale);
      const effProf = Math.max(1, Math.round((task.profPerUnit * minutes) / 60));
      pushFocusLog({
        userId,
        taskId,
        taskTitle: task.title,
        category: task.category,
        mode: task.mode,
        kind: "focus_effort",
        xp: effXp,
        points: effPts,
        prof: effProf,
        minutes,
        note: `为「${task.title}」投入 ${minutes} 分钟，待手动确认进度${guard.over ? "（产出 20%）" : ""}`,
        day,
      });
      gained.xp += effXp;
      gained.points += effPts;
      gained.prof += effProf;
      gained.minutes += minutes;
      message = `已记录 ${minutes} 分钟努力并给少量奖励，别忘了确认任务进度。${guard.over ? " 已超过今日建议专注时长，产出降至 20%。" : ""}`;
    }
  } else if (minutes >= 5) {
    const units = Math.max(0, Math.round((minutes / 25) * guard.scale));
    const profUnits = Math.max(1, Math.round(minutes / 25));
    pushFocusLog({
      userId,
      taskId: null,
      taskTitle: "自由专注",
      category: "life",
      mode: "focus",
      kind: "focus",
      xp: units,
      points: units,
      prof: profUnits,
      minutes,
      note: `自由专注 ${minutes} 分钟${guard.over ? "（产出 20%）" : ""}`,
      day,
    });
    gained.xp += units;
    gained.points += units;
    gained.prof += profUnits;
    gained.minutes += minutes;
    message = `自由专注 ${minutes} 分钟，已记录（+${units} XP）。${guard.over ? " 已超过今日建议专注时长，产出降至 20%，强烈建议休息。" : ""}`;
  } else {
    message = "专注不足 5 分钟，本次仅记录不奖励。";
  }

  const after = levelFromXp(getUser(userId)!.xp);
  const newAchievements = checkAchievements(userId);
  await persist();
  return {
    ok: true,
    gained,
    levelUp: after > before ? { from: before, to: after, title: levelTitle(after) } : null,
    newAchievements,
    message,
  };
}

// ---------------- 流水 / 统计 ----------------
export async function getLogs(limit = 200) {
  await ensureLoaded();
  const userId = requireUserId();
  return allLogs(userId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function getStats() {
  await ensureLoaded();
  const userId = requireUserId();
  const all = allLogs(userId);
  const today = new Date();
  const daily: { day: string; label: string; xp: number; points: number; minutes: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = dateKey(d);
    const rows = all.filter((l) => l.day === key);
    daily.push({
      day: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      xp: rows.reduce((a, r) => a + r.xp, 0),
      points: rows.reduce((a, r) => a + r.points, 0),
      minutes: rows.reduce((a, r) => a + focusMinutesOf(r), 0),
    });
  }
  const weekly: { week: string; label: string; minutes: number; xp: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 7 * 86400000);
    const wk = weekKey(d);
    const rows = all.filter((l) => weekKey(new Date(l.day + "T12:00:00")) === wk);
    weekly.push({
      week: wk,
      label: wk.split("-W")[1] + "周",
      minutes: rows.reduce((a, r) => a + focusMinutesOf(r), 0),
      xp: rows.reduce((a, r) => a + r.xp, 0),
    });
  }
  const prof = getProficiency(userId);
  const byCategory = CATEGORY_KEYS.map((c) => {
    const rows = all.filter((l) => l.category === c);
    return {
      category: c,
      xp: rows.reduce((a, r) => a + r.xp, 0),
      minutes: rows.reduce((a, r) => a + focusMinutesOf(r), 0),
      prof: prof[c] ?? 0,
      tier: proficiencyTier(prof[c] ?? 0).name,
    };
  });
  const heatmap: { day: string; xp: number; count: number }[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = dateKey(d);
    const rows = all.filter((l) => l.day === key);
    heatmap.push({ day: key, xp: rows.reduce((a, r) => a + r.xp, 0), count: rows.filter((r) => r.xp > 0).length });
  }
  // ---- V2 每日维持：近 30 天费用柱状图 + 30 天 × 5 类别达标度热力图 ----
  const upkeepCfg = getUpkeepConfig(userId);
  const upkeepRows = new Map(listUpkeepDays(userId).map((r) => [r.day, r]));
  const todayKey = upkeepToday();
  const upkeepDaily: {
    day: string;
    label: string;
    charged: number;
    bonus: number;
    net: number;
    allMet: boolean;
    estimated: boolean;
  }[] = [];
  const upkeepHeatmap: { day: string; label: string; estimated: boolean; cells: { category: string; ratio: number; billable: boolean }[] }[] = [];
  for (let i = 29; i >= 0; i--) {
    const key = addDays(todayKey, -i);
    const d = new Date(key + "T12:00:00");
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const row = upkeepRows.get(key);
    const estimated = !row && key === todayKey;
    if (row) {
      upkeepDaily.push({
        day: key,
        label,
        charged: row.totalCharged,
        bonus: row.bonusGranted + row.streakBonus,
        net: row.netSpend,
        allMet: row.allMet,
        estimated: false,
      });
      upkeepHeatmap.push({
        day: key,
        label,
        estimated: false,
        cells: CATEGORY_KEYS.map((c) => ({
          category: c,
          ratio: row.perCategory[c]?.ratio ?? 0,
          billable: row.perCategory[c]?.billable ?? false,
        })),
      });
    } else if (estimated) {
      const preview = previewUpkeepDay(userId, key, upkeepCfg);
      upkeepDaily.push({
        day: key,
        label,
        charged: preview.totalDue,
        bonus: preview.allMet ? upkeepCfg.allMetBonus : 0,
        net: preview.netSpend,
        allMet: preview.allMet,
        estimated: true,
      });
      upkeepHeatmap.push({
        day: key,
        label,
        estimated: true,
        cells: CATEGORY_KEYS.map((c) => ({
          category: c,
          ratio: preview.perCategory[c]?.ratio ?? 0,
          billable: preview.perCategory[c]?.billable ?? false,
        })),
      });
    } else {
      upkeepDaily.push({ day: key, label, charged: 0, bonus: 0, net: 0, allMet: false, estimated: false });
      upkeepHeatmap.push({
        day: key,
        label,
        estimated: false,
        cells: CATEGORY_KEYS.map((c) => ({ category: c, ratio: -1, billable: false })),
      });
    }
  }

  return {
    daily,
    weekly,
    byCategory,
    heatmap,
    upkeepDaily,
    upkeepHeatmap,
    upkeepTotals: {
      charged: upkeepDaily.reduce((a, r) => a + (r.estimated ? 0 : r.charged), 0),
      bonus: upkeepDaily.reduce((a, r) => a + (r.estimated ? 0 : r.bonus), 0),
      net: upkeepDaily.reduce((a, r) => a + (r.estimated ? 0 : r.net), 0),
      allMetDays: upkeepDaily.filter((r) => !r.estimated && r.allMet).length,
      settledDays: upkeepDaily.filter((r) => upkeepRows.has(r.day)).length,
    },
    totals: {
      xp: all.reduce((a, r) => a + r.xp, 0),
      points: all.reduce((a, r) => a + r.points, 0),
      minutes: all.reduce((a, r) => a + focusMinutesOf(r), 0),
      settlements: all.filter((r) => r.xp > 0).length,
      activeDays: new Set(all.filter((r) => r.xp > 0).map((r) => r.day)).size,
    },
  };
}

// ---------------- 成长树 ----------------
export async function unlockSkillNode(nodeId: string) {
  await ensureLoaded();
  const userId = requireUserId();
  const node = SKILL_NODES.find((n) => n.id === nodeId);
  if (!node) throw new LocalError("节点不存在");
  const already = unlockedNodes(userId);
  if (already.includes(nodeId)) throw new LocalError("该节点已解锁");
  const prev = SKILL_NODES.find((n) => n.category === node.category && n.slot === node.slot - 1);
  if (prev && !already.includes(prev.id)) throw new LocalError(`需要先解锁「${prev.name}」`);
  const prof = getProficiency(userId)[node.category] ?? 0;
  if (prof < node.profRequired) throw new LocalError(`熟练度不足（${prof}/${node.profRequired}）`);
  const user = getUser(userId)!;
  if (user.points < node.cost) throw new LocalError(`积分不足（${user.points}/${node.cost}）`);
  user.points -= node.cost;
  doc.skillNodes.push({ id: nextId("skillNodes"), userId, nodeId, unlockedAt: Date.now() });
  await persist();
  return { ok: true, unlockedNodes: unlockedNodes(userId) };
}

// ---------------- 积分商城 ----------------
export async function getRewards() {
  await ensureLoaded();
  const userId = requireUserId();
  return listRewards(userId).sort((a, b) => a.cost - b.cost);
}

export async function createReward(input: unknown) {
  await ensureLoaded();
  const userId = requireUserId();
  const parsed = insertRewardSchema.safeParse(input);
  if (!parsed.success) throw new LocalError(parsed.error.issues[0]?.message ?? "参数有误");
  const reward: Reward = { ...parsed.data, id: nextId("rewards"), userId, createdAt: Date.now() };
  doc.rewards.push(reward);
  await persist();
  return reward;
}

export async function updateReward(id: number, input: unknown) {
  await ensureLoaded();
  const userId = requireUserId();
  const parsed = insertRewardSchema.partial().safeParse(input ?? {});
  if (!parsed.success) throw new LocalError("参数有误");
  const reward = listRewards(userId).find((r) => r.id === id);
  if (!reward) throw new LocalError("奖励不存在", 404);
  Object.assign(reward, parsed.data);
  await persist();
  return reward;
}

export async function deleteReward(id: number) {
  await ensureLoaded();
  const userId = requireUserId();
  const reward = listRewards(userId).find((r) => r.id === id);
  if (!reward) throw new LocalError("奖励不存在", 404);
  reward.deletedAt = Date.now();
  reward.updatedAt = reward.deletedAt;
  await persist();
  return { ok: true };
}

export async function redeemReward(id: number) {
  await ensureLoaded();
  const userId = requireUserId();
  const reward = listRewards(userId).find((r) => r.id === id);
  if (!reward) throw new LocalError("奖励不存在", 404);
  if (reward.stock === 0) throw new LocalError("库存已用完");
  const user = getUser(userId)!;
  if (user.points < reward.cost) throw new LocalError(`积分不足，还差 ${reward.cost - user.points} 分`);
  user.points -= reward.cost;
  if (reward.stock > 0) reward.stock -= 1;
  doc.redemptions.push({
    id: nextId("redemptions"),
    userId,
    rewardId: reward.id,
    name: reward.name,
    emoji: reward.emoji,
    cost: reward.cost,
    createdAt: Date.now(),
  });
  await persist();
  return { ok: true };
}

export async function getRedemptions(): Promise<Redemption[]> {
  await ensureLoaded();
  const userId = requireUserId();
  return doc.redemptions.filter((r) => r.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------- 设置 ----------------
export async function updateSettings(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const user = getUser(userId)!;
  const b = body ?? {};
  if (typeof b.aiBaseUrl === "string") user.aiBaseUrl = b.aiBaseUrl.trim();
  if (typeof b.aiModel === "string") user.aiModel = b.aiModel.trim();
  if (typeof b.aiApiKey === "string" && b.aiApiKey.trim() !== "") {
    user.aiApiKey = await encryptSecretValue(b.aiApiKey.trim(), doc.appSecret);
  }
  if (b.clearApiKey === true) user.aiApiKey = "";
  if (typeof b.theme === "string") user.theme = b.theme;
  if (typeof b.displayName === "string" && b.displayName.trim()) user.displayName = b.displayName.trim();
  await persist();
  return { user: await publicUser(userId) };
}

// ---------------- 备份 ----------------
function backupStatus(userId: number) {
  const last = doc.lastBackupAt[String(userId)] ?? 0;
  const settlements = allLogs(userId).filter((l) => l.xp > 0).length;
  const daysSince = last ? Math.floor((Date.now() - last) / 86400000) : null;
  const due = settlements >= 20 && (last === 0 || (daysSince ?? 0) > 14);
  return { lastBackupAt: last || null, daysSince, settlements, due };
}

export async function exportData() {
  await ensureLoaded();
  const userId = requireUserId();
  const user = getUser(userId)!;
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    user: { username: user.username, displayName: user.displayName, xp: user.xp, points: user.points },
    proficiency: getProficiency(userId),
    tasks: listTasks(userId),
    logs: allLogs(userId),
    achievements: unlockedAchievementIds(userId),
    skillNodes: unlockedNodes(userId),
    rewards: listRewards(userId),
    redemptions: doc.redemptions.filter((r) => r.userId === userId),
    upkeepDays: doc.upkeepDays.filter((r) => r.userId === userId),
    upkeepExemptions: doc.upkeepExemptions.filter((r) => r.userId === userId),
    upkeepConfig: getUpkeepConfig(userId),
  };
  doc.lastBackupAt[String(userId)] = Date.now();
  await persist();
  return payload;
}

export async function importData(payload: any) {
  await ensureLoaded();
  const userId = requireUserId();
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.tasks)) {
    throw new LocalError("文件格式不正确");
  }
  clearUserData(userId);
  const idMap = new Map<number, number>();
  for (const t of payload.tasks) {
    const id = nextId("tasks");
    const task: Task = {
      ...(t as Task),
      id,
      userId,
      milestones: typeof t.milestones === "string" ? t.milestones : JSON.stringify(t.milestones ?? []),
      createdAt: t.createdAt ?? Date.now(),
    };
    doc.tasks.push(task);
    idMap.set(t.id, id);
  }
  for (const l of payload.logs ?? []) {
    doc.logs.push({
      ...(l as Log),
      id: nextId("logs"),
      userId,
      taskId: idMap.get(l.taskId) ?? 0,
      createdAt: l.createdAt ?? Date.now(),
    });
  }
  for (const [cat, v] of Object.entries(payload.proficiency ?? {})) {
    addProficiency(userId, cat, Number(v) || 0);
  }
  for (const a of payload.achievements ?? []) {
    doc.achievements.push({ id: nextId("achievements"), userId, achievementId: String(a), unlockedAt: Date.now() });
  }
  for (const n of payload.skillNodes ?? []) {
    doc.skillNodes.push({ id: nextId("skillNodes"), userId, nodeId: String(n), unlockedAt: Date.now() });
  }
  if (Array.isArray(payload.rewards) && payload.rewards.length) {
    doc.rewards = doc.rewards.filter((r) => r.userId !== userId);
    for (const r of payload.rewards) {
      doc.rewards.push({ ...(r as Reward), id: nextId("rewards"), userId, createdAt: r.createdAt ?? Date.now() });
    }
  }
  for (const r of payload.redemptions ?? []) {
    doc.redemptions.push({
      ...(r as Redemption),
      id: nextId("redemptions"),
      userId,
      createdAt: r.createdAt ?? Date.now(),
    });
  }
  for (const r of payload.upkeepDays ?? []) {
    if (!r?.day) continue;
    doc.upkeepDays.push({ ...(r as UpkeepDay), userId, deletedAt: r.deletedAt ?? null, updatedAt: r.updatedAt ?? Date.now() });
  }
  for (const r of payload.upkeepExemptions ?? []) {
    if (!r?.day || !r?.category) continue;
    doc.upkeepExemptions.push({
      ...(r as UpkeepExemption),
      id: nextId("upkeepExemptions"),
      userId,
      deletedAt: r.deletedAt ?? null,
      updatedAt: r.updatedAt ?? Date.now(),
    });
  }
  if (payload.upkeepConfig) writeUpkeepConfig(userId, normalizeUpkeepConfig(payload.upkeepConfig));
  const user = getUser(userId)!;
  user.xp = Number(payload.user?.xp) || 0;
  user.points = Number(payload.user?.points) || 0;
  await persist();
  return { ok: true };
}

export async function clearData() {
  await ensureLoaded();
  const userId = requireUserId();
  clearUserData(userId);
  await persist();
  return { ok: true };
}

// ---------------- AI（浏览器直连） ----------------
const MAX_AI_BODY_BYTES = 256 * 1024;

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 169 && p[1] === 254) return true; // 含 169.254.169.254 元数据地址
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
  if (p[0] >= 224) return true;
  return false;
}

function isIPv4(s: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

function isPrivateAddress(addr: string): boolean {
  const ip = addr.replace(/^\[|\]$/g, "");
  if (isIPv4(ip)) return isPrivateIPv4(ip);
  if (ip.includes(":")) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fe80")) return true;
    const first = parseInt(low.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true;
    const v4 = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) return isPrivateIPv4(v4[1]);
  }
  return false;
}

/** 校验用户提供的 AI 接口地址：必须 https，且不得指向内网/本地/元数据地址 */
export function assertSafeBaseUrl(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) throw new LocalError("请先填写 AI 接口地址");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LocalError("AI 接口地址格式不正确");
  }
  if (url.protocol !== "https:") throw new LocalError("AI 接口地址必须使用 https");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new LocalError("不允许访问内网或本地地址");
  }
  if (isPrivateAddress(host)) throw new LocalError("不允许访问内网或本地地址");
  return value;
}

export const CORS_HINT =
  "浏览器直连该接口被拒绝（网络或 CORS 限制）。部分供应商不允许网页端直接调用，请改用允许跨域的接口或代理；内置规则引擎依然可以正常给出参数建议。";

class NetworkError extends Error {}

async function callProvider(baseUrl: string, apiKey: string, model: string, messages: any[], jsonMode = true) {
  const safeBase = assertSafeBaseUrl(baseUrl);
  const url = `${safeBase.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    let r: Response;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.5,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("请求超时（20 秒）");
      throw new NetworkError(CORS_HINT);
    }
    const raw = (await r.text()).slice(0, MAX_AI_BODY_BYTES);
    if (!r.ok) throw new Error(`供应商返回 ${r.status}：${raw.slice(0, 200)}`);
    return JSON.parse(raw);
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------- V4 复盘 / 规划 ----------------
function journalContext(userId: number): string {
  const tasks = listTasks(userId)
    .filter((t) => !t.deletedAt)
    .slice(0, 15)
    .map((t) => {
      const target = normalizeTaskTarget(t);
      return {
        title: t.title,
        category: t.category,
        mode: t.mode,
        repeat: target.repeat,
        metric: target.metric,
        target: target.amount,
        priority: t.priority ?? 0,
        deadline: t.deadline || t.endDate || "",
      };
    });
  const logs = allLogs(userId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 25)
    .map((l) => ({ day: l.day, title: l.taskTitle, kind: l.kind, xp: l.xp, minutes: l.minutes }));
  return JSON.stringify({ tasks, recentLogs: logs });
}

function extractJsonObject(text: string): any {
  const t = String(text ?? "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型返回不是 JSON");
  return JSON.parse(t.slice(start, end + 1));
}

export async function journalList() {
  await ensureLoaded();
  const userId = requireUserId();
  return doc.journals
    .filter((j) => j.userId === userId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function journalUpsert(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const kind = body?.kind === "plan" ? "plan" : "review";
  const period = body?.period === "weekly" ? "weekly" : "daily";
  const periodKey = String(body?.periodKey || (period === "weekly" ? weekKey() : dateKey()));
  const content = String(body?.content ?? "").trim();
  if (!content) throw new LocalError("内容不能为空");
  const existing = doc.journals.find(
    (j) => j.userId === userId && j.kind === kind && j.periodKey === periodKey,
  );
  const now = Date.now();
  let row: JournalEntry;
  if (existing) {
    existing.content = content;
    existing.updatedAt = now;
    row = existing;
  } else {
    row = {
      id: nextId("journals"),
      userId,
      kind,
      period,
      periodKey,
      content,
      createdAt: now,
      updatedAt: now,
    };
    doc.journals.push(row);
  }
  await persist();
  return row;
}

export async function journalAiReview(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const row = doc.journals.find((j) => j.userId === userId && j.id === Number(body?.id));
  if (!row) throw new LocalError("记录不存在", 404);
  const u = getUser(userId)!;
  const context = journalContext(userId);
  const fallback = {
    feedback:
      row.content.length >= 40
        ? "复盘内容比较具体，继续保持；把最重要的三件事和实际用时对齐，明天会更稳。"
        : "复盘可以再具体一点：记下完成了什么、用了多久、卡在哪里，AI 才能给出更准的建议。",
    tomorrowFocus: "先处理截止日期最近、优先级最高的 1-2 项任务，其余安排到后面。",
    suggestedAdjustments: "如果今天有一类任务总是没做，明天把它放到精力最好的时段。",
  };
  if (!u.aiApiKey) {
    row.aiFeedback = JSON.stringify({ ...fallback, source: "rule" });
    row.updatedAt = Date.now();
    await persist();
    return { ...fallback, source: "rule", notice: "当前使用内置复盘模板，配置 API Key 可获得个性化复盘。" };
  }
  const sys =
    "你是自律成长系统的复盘教练。根据用户写的复盘内容和系统记录，输出严格的 JSON：{feedback(2-4句中文评价), tomorrowFocus(1-2句明日安排建议), suggestedAdjustments(1-2句调整建议)}。只输出 JSON。";
  try {
    const apiKey = await decryptSecretValue(u.aiApiKey, doc.appSecret);
    const data = await callProvider(u.aiBaseUrl, apiKey, u.aiModel, [
      { role: "system", content: sys },
      { role: "user", content: `复盘内容：${row.content}\n\n系统上下文：${context}` },
    ]);
    const parsed = extractJsonObject(data?.choices?.[0]?.message?.content ?? "{}");
    const result = {
      feedback: String(parsed.feedback ?? fallback.feedback),
      tomorrowFocus: String(parsed.tomorrowFocus ?? fallback.tomorrowFocus),
      suggestedAdjustments: String(parsed.suggestedAdjustments ?? fallback.suggestedAdjustments),
      source: "ai" as const,
    };
    row.aiFeedback = JSON.stringify(result);
    row.updatedAt = Date.now();
    await persist();
    return result;
  } catch (e: any) {
    const reason = e instanceof NetworkError ? CORS_HINT : String(e?.message ?? e).slice(0, 80);
    return { ...fallback, source: "rule" as const, notice: `AI 调用失败（${reason}），已回退内置模板。` };
  }
}

export async function planAiDecompose(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const row = doc.journals.find((j) => j.userId === userId && j.id === Number(body?.id));
  if (!row) throw new LocalError("记录不存在", 404);
  const u = getUser(userId)!;
  const context = journalContext(userId);
  const existingTitles = listTasks(userId)
    .filter((t) => !t.deletedAt)
    .map((t) => t.title.replace(/[，。、\s]/g, ""));
  const fallbackTasks = String(row.content)
    .split(/[\n；;。，,、]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .map((s, i) => ({
      title: s.slice(0, 60),
      category: i % 5 === 0 ? "academic" : i % 5 === 1 ? "language" : i % 5 === 2 ? "life" : i % 5 === 3 ? "social" : "finance",
      mode: "timer",
      repeat: "daily",
      targetMetric: "blocks",
      targetAmount: 2,
      priority: i < 2 ? 3 : 2,
      deadline: "",
      difficulty: 2,
      xpPerUnit: 20,
      pointsPerUnit: 15,
      profPerUnit: 15,
      unitName: "次",
      reason: "从规划文本拆出的下一步动作；配置 API Key 后可拆得更细、更贴合你的节奏。",
    }))
    .filter((t) => {
      const title = String(t.title).replace(/[，。、\s]/g, "");
      return title && !existingTitles.some((et) => et && (title.includes(et) || et.includes(title)));
    })
    .slice(0, 6);
  const fallback = { summary: `已从规划中拆出 ${fallbackTasks.length} 个可执行任务。`, tasks: fallbackTasks };
  if (!u.aiApiKey) {
    row.aiPlan = JSON.stringify({ ...fallback, source: "rule" });
    row.updatedAt = Date.now();
    await persist();
    return { ...fallback, source: "rule", notice: "当前使用文本拆解，配置 API Key 可获得更贴合你节奏的规划。" };
  }
  const sys =
    "你是自律成长系统的规划助手。用户会提供未来规划文本和已有任务上下文。你的职责是把规划文本拆成 3-8 个新的、可立即执行的下一步任务，而不是复述已有任务。要求：1) 不要照抄或近似重复已有任务标题；2) 每个任务必须以具体动作开头（如“完成…第一步”“整理…”“准备…”），包含数量、时长或截止日等信息；3) 根据紧迫度给出 priority(0-4) 与 deadline；4) 输出严格的 JSON：{summary(一句中文总结), tasks(3-8项数组，每项含 title(中文), category('academic'|'language'|'life'|'social'|'finance'), mode('timer'|'milestone'|'habit'|'count'), repeat('none'|'daily'|'weekly'), targetMetric('checkin'|'count'|'blocks'), targetAmount(正整数), priority(0-4整数), deadline('YYYY-MM-DD'或''), difficulty(1-4), xpPerUnit, pointsPerUnit, profPerUnit, unitName(中文), reason(一句中文，说明它对应规划的哪一步))}。只输出 JSON。";
  try {
    const apiKey = await decryptSecretValue(u.aiApiKey, doc.appSecret);
    const data = await callProvider(u.aiBaseUrl, apiKey, u.aiModel, [
      { role: "system", content: sys },
      { role: "user", content: `未来规划：${row.content}\n\n系统上下文：${context}\n\n特别注意：已有任务不要重复生成，请只输出针对这份规划的新增下一步任务。` },
    ]);
    const parsed = extractJsonObject(data?.choices?.[0]?.message?.content ?? "{}");
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .map((t: any, i: number) => ({
            title: String(t?.title ?? "").slice(0, 60),
            category: ["academic", "language", "life", "social", "finance"].includes(String(t?.category))
              ? String(t.category)
              : fallbackTasks[i]?.category ?? "life",
            mode: ["timer", "milestone", "habit", "count"].includes(String(t?.mode))
              ? String(t.mode)
              : fallbackTasks[i]?.mode ?? "timer",
            repeat: ["none", "daily", "weekly"].includes(String(t?.repeat))
              ? String(t.repeat)
              : fallbackTasks[i]?.repeat ?? "daily",
            targetMetric: ["checkin", "count", "blocks"].includes(String(t?.targetMetric))
              ? String(t.targetMetric)
              : fallbackTasks[i]?.targetMetric ?? "blocks",
            targetAmount: Number(t?.targetAmount) > 0 ? Number(t.targetAmount) : fallbackTasks[i]?.targetAmount ?? 2,
            priority: Number(t?.priority) >= 0 && Number(t?.priority) <= 4 ? Number(t.priority) : 2,
            deadline: String(t?.deadline ?? "").slice(0, 10),
            difficulty: Number(t?.difficulty) >= 1 && Number(t?.difficulty) <= 4 ? Number(t.difficulty) : 2,
            xpPerUnit: Number(t?.xpPerUnit) > 0 ? Number(t.xpPerUnit) : 20,
            pointsPerUnit: Number(t?.pointsPerUnit) > 0 ? Number(t.pointsPerUnit) : 15,
            profPerUnit: Number(t?.profPerUnit) > 0 ? Number(t.profPerUnit) : 15,
            unitName: String(t?.unitName ?? "次").slice(0, 20),
            reason: String(t?.reason ?? ""),
          }))
          .filter((t: any) => {
            const title = String(t?.title ?? "").replace(/[，。、\s]/g, "");
            return title && !existingTitles.some((et) => et && (title.includes(et) || et.includes(title)));
          })
          .slice(0, 8)
      : fallbackTasks;
    const result = {
      summary: String(parsed.summary ?? fallback.summary),
      tasks,
      source: "ai" as const,
    };
    row.aiPlan = JSON.stringify(result);
    row.updatedAt = Date.now();
    await persist();
    return result;
  } catch (e: any) {
    const reason = e instanceof NetworkError ? CORS_HINT : String(e?.message ?? e).slice(0, 80);
    return { ...fallback, source: "rule" as const, notice: `AI 调用失败（${reason}），已回退文本拆解。` };
  }
}

// ---------------- V0.4 智能规划聊天 ----------------
function plannerSessionFor(userId: number): PlannerSession {
  let session = doc.plannerSessions.find((s) => s.userId === userId);
  if (!session) {
    session = {
      id: nextId("plannerSessions"),
      userId,
      messages: [],
      askCount: 0,
      updatedAt: Date.now(),
    };
    doc.plannerSessions.push(session);
  }
  return session;
}

function plannerContext(userId: number): string {
  const tasks = listTasks(userId)
    .filter((t) => !t.deletedAt)
    .slice(0, 20)
    .map((t) => ({
      title: t.title,
      category: t.category,
      mode: t.mode,
      deadline: t.deadline || t.endDate || "",
      priority: t.priority ?? 0,
    }));
  return JSON.stringify({ today: dateKey(), existingTasks: tasks });
}

function plannerSystemPrompt(askCount: number): string {
  return `你是自律成长系统里的任务规划顾问。用户会用自然语言描述一个目标，你要通过简短对话澄清模糊点，最终把它变成 1-8 个可执行任务。

严格规则：
1. 每次只问一个最关键的问题；如果适合让用户选择，给出 2-4 个 options。
2. 最多问 4 个问题。当前已经问过 ${askCount} 个问题。问满 4 个后，即使信息不全，也要基于合理假设直接给计划。
3. 当信息足够，或已经问满 4 次，输出 action="plan"。
4. 不要重复系统中已有的任务。
5. 始终用中文，只输出 JSON，不要输出 Markdown 或额外解释。

可输出两种 JSON：
- 继续提问：{"action":"ask","question":"一个简短问题","options":["选项A","选项B"]}
- 给出计划：{"action":"plan","summary":"一句总结","tasks":[{...}]}

task 字段：title(中文), category(academic|language|life|social|finance), mode(timer|milestone|habit|count), repeat(none|daily|weekly), targetMetric(checkin|count|blocks), targetAmount(正整数), priority(0-4整数), deadline("YYYY-MM-DD"或空字符串), difficulty(1-4), xpPerUnit(整数), pointsPerUnit(整数), profPerUnit(整数), unitName(简短中文单位), reason(一句中文说明它对应规划的哪一步)。

数值建议：计时单块经验 15-60；计件按单个单位给较小值；里程碑按整个任务总量给 100-400。`;
}

function parsePlannerAction(raw: string): {
  action: "ask" | "plan";
  question?: string;
  options?: string[];
  summary?: string;
  tasks?: unknown[];
} {
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { action: "ask", question: "请再说得具体一点，你想完成什么？", options: [] };
  }
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const action = obj?.action === "plan" ? "plan" : "ask";
    return {
      action,
      question: action === "ask" ? String(obj?.question || "请再说得具体一点。") : undefined,
      options: Array.isArray(obj?.options) ? obj.options.map(String).slice(0, 4) : [],
      summary: action === "plan" ? String(obj?.summary || "") : undefined,
      tasks: action === "plan" && Array.isArray(obj?.tasks) ? obj.tasks : [],
    };
  } catch {
    return { action: "ask", question: "请再说得具体一点，你想完成什么？", options: [] };
  }
}

function normalizePlannerTasks(raw: unknown[]): InsertTask[] {
  const out: InsertTask[] = [];
  const existingTitles = doc.tasks
    .filter((t) => !t.deletedAt)
    .map((t) => t.title.replace(/[，。、\s]/g, ""));
  for (const item of raw) {
    const t = item as any;
    const title = String(t?.title ?? "").trim().slice(0, 60);
    if (!title) continue;
    const clean = title.replace(/[，。、\s]/g, "");
    if (existingTitles.some((et) => et && (clean.includes(et) || et.includes(clean)))) continue;
    const category = ["academic", "language", "life", "social", "finance"].includes(String(t?.category))
      ? (String(t.category) as InsertTask["category"])
      : "life";
    const mode = ["timer", "milestone", "habit", "count"].includes(String(t?.mode))
      ? (String(t.mode) as InsertTask["mode"])
      : "timer";
    const repeat = ["none", "daily", "weekly"].includes(String(t?.repeat))
      ? (String(t.repeat) as InsertTask["repeat"])
      : mode === "habit"
        ? "daily"
        : mode === "timer"
          ? "daily"
          : "none";
    const targetMetric = ["checkin", "count", "blocks"].includes(String(t?.targetMetric))
      ? (String(t.targetMetric) as InsertTask["targetMetric"])
      : mode === "timer"
        ? "blocks"
        : mode === "habit"
          ? "checkin"
          : "count";
    const targetAmount = Number(t?.targetAmount) > 0 ? Math.round(Number(t.targetAmount)) : 1;
    const priority = Number(t?.priority) >= 0 && Number(t?.priority) <= 4 ? Math.round(Number(t.priority)) : 2;
    const difficulty = Number(t?.difficulty) >= 1 && Number(t?.difficulty) <= 4 ? Math.round(Number(t.difficulty)) : 2;
    const deadline = String(t?.deadline ?? "").slice(0, 10);
    const target = normalizeTaskTarget({ mode, repeat, targetMetric, targetAmount, unitName: t?.unitName });
    out.push({
      title,
      category,
      mode,
      difficulty,
      xpPerUnit: Number(t?.xpPerUnit) > 0 ? Math.round(Number(t.xpPerUnit)) : 20,
      pointsPerUnit: Number(t?.pointsPerUnit) > 0 ? Math.round(Number(t.pointsPerUnit)) : 15,
      profPerUnit: Number(t?.profPerUnit) > 0 ? Math.round(Number(t.profPerUnit)) : 15,
      notes: "",
      startDate: "",
      endDate: deadline,
      blockMinutes: 25,
      dailyTargetBlocks: 2,
      milestones: [],
      period: repeat === "weekly" ? "weekly" : "daily",
      targetPerPeriod: targetMetric === "checkin" ? targetAmount : 1,
      unitName: target.unitName || "次",
      targetCount: targetMetric === "count" ? targetAmount : 10,
      repeat,
      targetMetric,
      targetAmount,
      finishOnTarget: repeat === "none" ? 1 : 0,
      priority,
      deadline,
    });
  }
  return out.slice(0, 8);
}

export async function plannerState() {
  await ensureLoaded();
  const userId = requireUserId();
  const session = plannerSessionFor(userId);
  return {
    messages: session.messages,
    askCount: session.askCount,
    configured: !!getUser(userId)!.aiApiKey,
  };
}

export async function plannerReset() {
  await ensureLoaded();
  const userId = requireUserId();
  doc.plannerSessions = doc.plannerSessions.filter((s) => s.userId !== userId);
  await persist();
  return plannerState();
}

export async function plannerSend(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const u = getUser(userId)!;
  const content = String(body?.content ?? "").trim();
  if (!content) throw new LocalError("请输入你的目标");
  const session = plannerSessionFor(userId);
  const now = Date.now();
  session.messages.push({ role: "user", content, createdAt: now });

  if (!u.aiApiKey) {
    const blocked: PlannerMessage = {
      role: "assistant",
      content: "智能规划需要先在设置页配置 AI 接口，我才能和你一步步确认需求。",
      action: "blocked",
      createdAt: now + 1,
    };
    session.messages.push(blocked);
    session.updatedAt = now + 1;
    await persist();
    return { message: blocked, messages: session.messages, configured: false };
  }

  const system = plannerSystemPrompt(session.askCount);
  const context = plannerContext(userId);
  const history = session.messages.map((m) => ({ role: m.role, content: m.content }));
  try {
    const apiKey = await decryptSecretValue(u.aiApiKey, doc.appSecret);
    const data = await callProvider(u.aiBaseUrl, apiKey, u.aiModel, [
      { role: "system", content: `${system}\n\n当前系统上下文：${context}` },
      ...history,
    ]);
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = parsePlannerAction(raw);
    let message: PlannerMessage;
    if (parsed.action === "plan") {
      const tasks = normalizePlannerTasks(parsed.tasks ?? []);
      message = {
        role: "assistant",
        content: parsed.summary || "我已经把计划整理好了。",
        action: "plan",
        plan: { summary: parsed.summary || "", tasks },
        createdAt: Date.now(),
      };
    } else {
      message = {
        role: "assistant",
        content: parsed.question || "请再说得具体一点。",
        action: "ask",
        question: parsed.question,
        options: parsed.options ?? [],
        createdAt: Date.now(),
      };
      session.askCount += 1;
    }
    session.messages.push(message);
    session.updatedAt = Date.now();
    await persist();
    return { message, messages: session.messages, configured: true };
  } catch (e: any) {
    const reason = e instanceof NetworkError ? CORS_HINT : String(e?.message ?? e).slice(0, 100);
    const message: PlannerMessage = {
      role: "assistant",
      content: `智能规划暂时不可用：${reason}`,
      action: "blocked",
      createdAt: Date.now(),
    };
    session.messages.push(message);
    session.updatedAt = Date.now();
    await persist();
    return { message, messages: session.messages, configured: true };
  }
}

export async function plannerConfirm(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const tasks = normalizePlannerTasks(Array.isArray(body?.tasks) ? body.tasks : []);
  if (tasks.length === 0) throw new LocalError("计划中没有可创建的任务");
  for (const task of tasks) createTaskRecord(userId, task);
  const session = plannerSessionFor(userId);
  session.messages.push({
    role: "assistant",
    content: `已创建 ${tasks.length} 个任务。`,
    action: "done",
    createdAt: Date.now(),
  });
  session.updatedAt = Date.now();
  await persist();
  return { ok: true, created: tasks.map((t) => t.title) };
}

// ---------------- V0.2 睡眠 ----------------
function sleepSettingsFor(userId: number): { idealBedtime: string; idealSleepHours: number } {
  const s = doc.sleepSettings[userId];
  return {
    idealBedtime: s?.idealBedtime || "23:00",
    idealSleepHours: s?.idealSleepHours || 7.5,
  };
}

export async function sleepState() {
  await ensureLoaded();
  const userId = requireUserId();
  const settings = sleepSettingsFor(userId);
  const records = doc.sleepLogs
    .filter((l) => l.userId === userId)
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day) || a.createdAt - b.createdAt);
  return { settings, records: records.slice(-14) };
}

export async function sleepSettingsUpdate(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const bedtime = String(body?.idealBedtime || "23:00");
  if (Number.isNaN(timeToMinutes(bedtime))) throw new LocalError("理想入睡时间格式不正确");
  const hours = Math.max(4, Math.min(12, Number(body?.idealSleepHours) || 7.5));
  doc.sleepSettings[userId] = { idealBedtime: bedtime, idealSleepHours: hours };
  await persist();
  return { settings: doc.sleepSettings[userId] };
}

export async function sleepRecord(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const day = String(body?.day || dateKey());
  const sleepTime = String(body?.sleepTime || "");
  const wakeTime = String(body?.wakeTime || "");
  const settings = sleepSettingsFor(userId);
  const score = sleepScore({
    sleepTime,
    wakeTime,
    idealBedtime: settings.idealBedtime,
    idealSleepHours: settings.idealSleepHours,
  });
  if (score.minutes <= 0) throw new LocalError(score.reason);
  const existing = doc.sleepLogs.find((l) => l.userId === userId && l.day === day);
  const now = Date.now();
  if (existing) {
    const dx = score.xp - existing.xp;
    const dp = score.points - existing.points;
    const dpr = score.prof - existing.prof;
    if (dx !== 0 || dp !== 0 || dpr !== 0) {
      pushFocusLog({
        userId,
        taskId: null,
        taskTitle: "睡眠调整",
        category: "life",
        mode: "sleep",
        kind: "sleep_adjust",
        xp: dx,
        points: dp,
        prof: dpr,
        minutes: Math.max(0, score.minutes - existing.durationMinutes),
        note: `更新 ${day} 睡眠记录`,
        day,
      });
    }
    existing.sleepTime = sleepTime;
    existing.wakeTime = wakeTime;
    existing.durationMinutes = score.minutes;
    existing.xp = score.xp;
    existing.points = score.points;
    existing.prof = score.prof;
    existing.updatedAt = now;
  } else {
    pushFocusLog({
      userId,
      taskId: null,
      taskTitle: "睡眠记录",
      category: "life",
      mode: "sleep",
      kind: "sleep",
      xp: score.xp,
      points: score.points,
      prof: score.prof,
      minutes: score.minutes,
      note: `${day} 睡眠 ${(score.minutes / 60).toFixed(1)} 小时`,
      day,
    });
    doc.sleepLogs.push({
      id: nextId("sleepLogs"),
      userId,
      day,
      sleepTime,
      wakeTime,
      durationMinutes: score.minutes,
      xp: score.xp,
      points: score.points,
      prof: score.prof,
      createdAt: now,
      updatedAt: now,
    });
  }
  await persist();
  const record = existing ?? doc.sleepLogs.find((l) => l.userId === userId && l.day === day);
  return { ok: true, score, record };
}

// ---------------- V0.3 开销记账 ----------------
function findBudgetTask(userId: number): Task | undefined {
  return doc.tasks.find(
    (t) =>
      t.userId === userId &&
      !t.deletedAt &&
      t.archived !== 1 &&
      t.category === "finance" &&
      normalizeTaskTarget(t).repeat === "daily" &&
      (t.dailyBudgetCents != null ||
        normalizeTaskTarget(t).metric === "count" ||
        /预算|开销|支出/.test(t.title)),
  );
}

function budgetCentsOf(t: Task): number | null {
  if (t.dailyBudgetCents != null) return t.dailyBudgetCents;
  if (normalizeTaskTarget(t).metric === "count") return normalizeTaskTarget(t).amount * 100;
  return null;
}

function expenseStateData(userId: number) {
  const today = dateKey();
  const rows = doc.expenses
    .filter((e) => e.userId === userId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  const todayRows = rows.filter((e) => e.day === today);
  const totalCents = todayRows.reduce((a, e) => a + e.amountCents, 0);
  const budgetTask = findBudgetTask(userId);
  const budgetCents = budgetTask ? budgetCentsOf(budgetTask) : null;
  const byCategory = (["food", "life", "fun", "study"] as const).map((key) => ({
    key,
    totalCents: todayRows.filter((e) => e.category === key).reduce((a, e) => a + e.amountCents, 0),
  }));
  return {
    today: {
      day: today,
      totalCents,
      budgetCents,
      met: budgetCents != null && totalCents <= budgetCents,
    },
    budgetTask: budgetTask ? taskView(userId, budgetTask) : null,
    recent: rows.slice(0, 20),
    byCategory,
  };
}

function createBudgetTask(userId: number, budgetCents: number): Task {
  const budgetYuan = Math.max(1, Math.round(budgetCents / 100));
  const data: InsertTask = {
    title: `每日开销控制在 ${budgetYuan} 元`,
    category: "finance",
    mode: "habit",
    difficulty: 2,
    xpPerUnit: 10,
    pointsPerUnit: 8,
    profPerUnit: 6,
    notes: "V0.3 自动生成的每日预算任务，可在开销页或任务页修改金额与奖励。",
    startDate: "",
    endDate: "",
    blockMinutes: 25,
    dailyTargetBlocks: 1,
    milestones: [],
    period: "daily",
    targetPerPeriod: 1,
    unitName: "次",
    targetCount: 1,
    repeat: "daily",
    targetMetric: "checkin",
    targetAmount: 1,
    finishOnTarget: 0,
    priority: 2,
    deadline: "",
    dailyBudgetCents: budgetCents,
  };
  return createTaskRecord(userId, data);
}

export async function expenseState() {
  await ensureLoaded();
  return expenseStateData(requireUserId());
}

export async function expenseAdd(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const day = String(body?.day || dateKey());
  const category: "food" | "life" | "fun" | "study" = ["food", "life", "fun", "study"].includes(
    String(body?.category),
  )
    ? (String(body.category) as "food" | "life" | "fun" | "study")
    : "life";
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new LocalError("请输入有效金额");
  const cents = Math.round(amount * 100);
  const note = String(body?.note ?? "").slice(0, 100);
  doc.expenses.push({
    id: nextId("expenses"),
    userId,
    day,
    category,
    amountCents: cents,
    note,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  let budgetTask = findBudgetTask(userId);
  let autoCreated = false;
  if (!budgetTask) {
    budgetTask = createBudgetTask(userId, 100 * 100);
    autoCreated = true;
  }
  const budgetCents = budgetCentsOf(budgetTask!);
  const total = doc.expenses
    .filter((e) => e.userId === userId && e.day === day)
    .reduce((a, e) => a + e.amountCents, 0);
  let message = "";
  if (budgetCents != null) {
    if (total <= budgetCents) {
      if (budgetTask!.mode === "habit") {
        const already = periodCheckins(budgetTask!) >= budgetTask!.targetPerPeriod;
        if (!already) {
          await checkin(budgetTask!.id, { percent: 100 });
          message = `今日开销 ${(total / 100).toFixed(2)} 元，预算任务已完成。`;
        }
      } else {
        const already = doc.logs.some(
          (l) => l.userId === userId && l.taskId === budgetTask!.id && l.day === day && l.kind === "budget_met",
        );
        if (!already) {
          pushFocusLog({
            userId,
            taskId: budgetTask!.id,
            taskTitle: budgetTask!.title,
            category: "finance",
            mode: budgetTask!.mode,
            kind: "budget_met",
            xp: budgetTask!.xpPerUnit,
            points: budgetTask!.pointsPerUnit,
            prof: budgetTask!.profPerUnit,
            minutes: 0,
            note: `当日开销达标（${(total / 100).toFixed(2)}/${(budgetCents / 100).toFixed(2)} 元）`,
            day,
          });
          message = `今日开销 ${(total / 100).toFixed(2)} 元，预算任务已完成。`;
        }
      }
    } else {
      message = `今日开销 ${(total / 100).toFixed(2)} 元，已超出预算 ${((total - budgetCents) / 100).toFixed(2)} 元（不扣分）。`;
    }
  }
  if (autoCreated) message = `${message ? message + " " : ""}已自动创建每日预算任务（100 元/天），可随时修改。`;
  await persist();
  return { ok: true, message, state: expenseStateData(userId) };
}

export async function expenseBudget(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new LocalError("请输入有效金额");
  const cents = Math.round(amount * 100);
  const existing = findBudgetTask(userId);
  if (existing) {
    existing.dailyBudgetCents = cents;
    if (normalizeTaskTarget(existing).metric === "count") {
      existing.targetAmount = Math.max(1, Math.round(cents / 100));
    }
  } else {
    createBudgetTask(userId, cents);
  }
  await persist();
  return { ok: true, state: expenseStateData(userId) };
}

export async function expenseDelete(id: number) {
  await ensureLoaded();
  const userId = requireUserId();
  const idx = doc.expenses.findIndex((e) => e.userId === userId && e.id === id);
  if (idx < 0) throw new LocalError("记录不存在", 404);
  doc.expenses.splice(idx, 1);
  await persist();
  return { ok: true, state: expenseStateData(userId) };
}

// ---------------- V0.3.1 睡眠健康工作闸门 ----------------
function previousNightSleepMinutes(userId: number): number {
  const key = dateKey(new Date(Date.now() - 86400000));
  return doc.sleepLogs.find((l) => l.userId === userId && l.day === key)?.durationMinutes ?? 0;
}

function focusMinutesToday(userId: number): number {
  const today = dateKey();
  return allLogs(userId)
    .filter(
      (l) =>
        l.userId === userId &&
        l.day === today &&
        ["block", "manual", "focus", "focus_effort"].includes(l.kind),
    )
    .reduce((a, l) => a + Math.max(0, l.minutes), 0);
}

function overworkScaleFor(
  userId: number,
  extraMinutes: number,
): { scale: number; over: boolean; cap: number; todayMinutes: number } {
  const cap = recommendedWorkMinutes(previousNightSleepMinutes(userId));
  const todayMinutes = focusMinutesToday(userId) + extraMinutes;
  return { scale: todayMinutes > cap ? OVERWORK_MULT : 1, over: todayMinutes > cap, cap, todayMinutes };
}

function overworkStatus(userId: number) {
  const sleepMinutes = previousNightSleepMinutes(userId);
  const cap = recommendedWorkMinutes(sleepMinutes);
  const todayMinutes = focusMinutesToday(userId);
  return {
    sleepMinutes,
    cap,
    todayMinutes,
    over: todayMinutes > cap,
    reason: workLimitReason(sleepMinutes, todayMinutes, cap),
  };
}

export async function focusLimits() {
  await ensureLoaded();
  return overworkStatus(requireUserId());
}

export async function aiTest(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const u = getUser(userId)!;
  const baseUrl = String(body?.aiBaseUrl || u.aiBaseUrl || "").trim();
  const model = String(body?.aiModel || u.aiModel || "").trim();
  const apiKey = String(body?.aiApiKey || (await decryptSecretValue(u.aiApiKey, doc.appSecret)) || "").trim();
  assertSafeBaseUrl(baseUrl);
  if (!apiKey) throw new LocalError("尚未配置 API Key");
  try {
    const data = await callProvider(baseUrl, apiKey, model, [{ role: "user", content: '回复 JSON {"ok":true}' }]);
    const content = data?.choices?.[0]?.message?.content ?? "";
    return { ok: true, message: `连通成功，模型 ${model} 已响应`, raw: String(content).slice(0, 120) };
  } catch (e: any) {
    if (e instanceof NetworkError) throw new LocalError(CORS_HINT);
    throw new LocalError(`连接失败：${e?.message ?? e}`);
  }
}

export async function aiSuggest(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const { title = "", category = "academic", mode = "timer", goal = "" } = body ?? {};
  const fallback = ruleSuggest(String(category), String(mode));
  const targetFallback = ruleTargetFor(String(category), String(mode));
  const ruleResult = {
    ...fallback,
    category: String(category),
    mode: String(mode),
    repeat: targetFallback.repeat,
    targetMetric: targetFallback.metric,
    targetAmount: targetFallback.amount,
    unitName: targetFallback.unitName,
    finishOnTarget: false,
    source: "rule" as const,
  };
  const u = getUser(userId)!;
  if (!u.aiApiKey) {
    return { ...ruleResult, notice: "当前使用内置规则，配置 API Key 可获得个性化深度规划。" };
  }
  const sys =
    "你是一个自律管理系统的规划助手。请根据用户的目标描述，不只调数值，还要推荐任务的类别、结算模式与达标口径。输出严格的 JSON，字段：category('academic'|'language'|'life'|'social'|'finance'), mode('timer'|'milestone'|'habit'|'count'), repeat('none'|'daily'|'weekly'), targetMetric('checkin'|'count'|'blocks'), targetAmount(正整数), finishOnTarget(true|false，仅一次性总目标建议 true), blockMinutes(整数分钟), dailyTargetBlocks(整数), period('daily'|'weekly'), targetPerPeriod(整数), targetCount(整数), unitName(简短中文单位), difficulty(1-4整数), xpPerUnit(整数), pointsPerUnit(整数), profPerUnit(整数), milestones(中文字符串数组，3-6项), reason(一句中文理由，说明为什么选这个形态)。数值需符合：计时模式单块经验 15-60；计件模式按单个单位给较小值；里程碑模式为整个任务总量给较大值(100-400)。如果用户提到每日/每周重复，优先 repeat 为 daily/weekly；如果提到时间投入，优先 timer+blocks；如果提到数量，优先 count。只输出 JSON。";
  const userMsg = `任务标题：${title || "（未命名）"}\n用户当前类别：${categoryName(String(category))}\n当前结算模式：${modeName(String(mode))}\n用户目标描述：${goal || "（未填写）"}\n请据此推荐 category、mode、repeat、targetMetric 等完整形态。`;
  try {
    const apiKey = await decryptSecretValue(u.aiApiKey, doc.appSecret);
    const data = await callProvider(u.aiBaseUrl, apiKey, u.aiModel, [
      { role: "system", content: sys },
      { role: "user", content: userMsg },
    ]);
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const okCategory = ["academic", "language", "life", "social", "finance"].includes(String(parsed.category));
    const okMode = ["timer", "milestone", "habit", "count"].includes(String(parsed.mode));
    const okRepeat = ["none", "daily", "weekly"].includes(String(parsed.repeat));
    const okMetric = ["checkin", "count", "blocks"].includes(String(parsed.targetMetric));
    return {
      category: okCategory ? String(parsed.category) : ruleResult.category,
      mode: okMode ? String(parsed.mode) : ruleResult.mode,
      repeat: okRepeat ? (parsed.repeat as "none" | "daily" | "weekly") : ruleResult.repeat,
      targetMetric: okMetric ? (parsed.targetMetric as "checkin" | "count" | "blocks") : ruleResult.targetMetric,
      targetAmount: Number(parsed.targetAmount) > 0 ? Number(parsed.targetAmount) : ruleResult.targetAmount,
      finishOnTarget: parsed.finishOnTarget === true,
      blockMinutes: Number(parsed.blockMinutes) || fallback.blockMinutes,
      dailyTargetBlocks: Number(parsed.dailyTargetBlocks) || fallback.dailyTargetBlocks,
      period: parsed.period === "weekly" ? "weekly" : fallback.period ?? "daily",
      targetPerPeriod: Number(parsed.targetPerPeriod) || fallback.targetPerPeriod,
      targetCount: Number(parsed.targetCount) || fallback.targetCount,
      unitName: parsed.unitName || fallback.unitName || ruleResult.unitName,
      difficulty: Number(parsed.difficulty) || 2,
      xpPerUnit: Number(parsed.xpPerUnit) || fallback.xpPerUnit,
      pointsPerUnit: Number(parsed.pointsPerUnit) || fallback.pointsPerUnit,
      profPerUnit: Number(parsed.profPerUnit) || fallback.profPerUnit,
      milestones: Array.isArray(parsed.milestones) ? parsed.milestones.map(String).slice(0, 8) : fallback.milestones,
      reason: String(parsed.reason ?? fallback.reason),
      source: "ai",
    };
  } catch (e: any) {
    const reason = e instanceof NetworkError ? CORS_HINT : String(e?.message ?? e).slice(0, 80);
    return { ...ruleResult, notice: `AI 调用失败（${reason}），已回退内置规则。` };
  }
}

// ============================================================
// 演示数据
// ============================================================
type DemoSpec = {
  title: string;
  category: string;
  mode: string;
  blockMinutes?: number;
  chance: number;
  milestones?: string[];
};

const DEMO_SPECS: DemoSpec[] = [
  { title: "博士论文写作", category: "academic", mode: "timer", blockMinutes: 50, chance: 0.8 },
  { title: "论文章节推进", category: "academic", mode: "milestone", chance: 0.06, milestones: ["确定选题与研究问题", "完成文献综述初稿", "整理数据与方法设计", "完成结果分析", "完成全文初稿"] },
  { title: "英语精读打卡", category: "language", mode: "habit", chance: 0.72 },
  { title: "学术英语听力", category: "language", mode: "timer", blockMinutes: 25, chance: 0.45 },
  { title: "每日快走 30 分钟", category: "life", mode: "habit", chance: 0.62 },
  { title: "早睡记录", category: "life", mode: "count", chance: 0.5 },
  { title: "主动联络同行", category: "social", mode: "count", chance: 0.3 },
  { title: "每周一次深度交流", category: "social", mode: "habit", chance: 0.22 },
  { title: "记账与预算复盘", category: "finance", mode: "habit", chance: 0.35 },
];

/** 简单可复现的伪随机数（演示数据用） */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 在当前账号内生成 60 天演示数据（等价于旧版 yunlong 账号） */
export async function seedDemoData() {
  await ensureLoaded();
  const userId = requireUserId();
  const rand = mulberry32(20260818);
  const days = 60;
  const existing = listTasks(userId);
  const created: Task[] = [];
  for (const s of DEMO_SPECS) {
    let t = existing.find((x) => x.title === s.title);
    if (!t) {
      const rule = ruleSuggest(s.category, s.mode);
      t = createTaskRecord(userId, {
        title: s.title,
        category: s.category as any,
        mode: s.mode as any,
        difficulty: 2,
        xpPerUnit: rule.xpPerUnit,
        pointsPerUnit: rule.pointsPerUnit,
        profPerUnit: rule.profPerUnit,
        notes: "演示数据",
        startDate: "",
        endDate: "",
        blockMinutes: s.blockMinutes ?? rule.blockMinutes ?? 25,
        dailyTargetBlocks: rule.dailyTargetBlocks ?? 2,
        milestones: (s.milestones ?? []).map((title, i) => ({ id: `m${i + 1}`, title, weight: 1, done: false })),
        period: (rule.period as any) ?? "daily",
        targetPerPeriod: rule.targetPerPeriod ?? 1,
        unitName: rule.unitName ?? "次",
        targetCount: rule.targetCount ?? 10,
      });
    }
    created.push(t);
  }

  let addedXp = 0;
  let addedPoints = 0;
  const seededLogIds: number[] = [];
  const pushLog = (t: Task, d: Date, ratio: number) => {
    const minutes = t.mode === "timer" ? t.blockMinutes * ratio : t.mode === "habit" ? 30 : t.mode === "milestone" ? 60 : 20;
    const xp = Math.round(t.xpPerUnit * ratio);
    const points = Math.round(t.pointsPerUnit * ratio);
    const prof = Math.round(t.profPerUnit * ratio);
    addedXp += xp;
    addedPoints += points;
    doc.logs.push({
      id: nextId("logs"),
      userId,
      taskId: t.id,
      taskTitle: t.title,
      category: t.category,
      mode: t.mode,
      kind: t.mode === "timer" ? "block" : t.mode === "habit" ? "checkin" : t.mode === "milestone" ? "milestone" : "count",
      day: dateKey(d),
      xp,
      points,
      prof,
      minutes,
      ratio,
      note: "演示数据",
      createdAt: d.getTime(),
    });
    seededLogIds.push(doc.logs[doc.logs.length - 1].id);
    addProficiency(userId, t.category, prof);
  };

  for (let i = days; i >= 1; i--) {
    const d = new Date(Date.now() - i * 86400000);
    for (const t of created) {
      const spec = DEMO_SPECS.find((s) => s.title === t.title)!;
      if (rand() > spec.chance) continue;
      const ratio =
        t.mode === "timer"
          ? 1 + (rand() > 0.6 ? 1 : 0)
          : t.mode === "count"
            ? 1 + Math.floor(rand() * 2)
            : t.mode === "milestone"
              ? 0.2
              : 1;
      pushLog(t, d, ratio);
    }
  }

  // 让等级稳定落在 Lv.14 区间（totalXpFor(14)=5337，totalXpFor(15)=5937）
  const academicTimer = created.find((t) => t.mode === "timer" && t.category === "academic")!;
  let guard = 0;
  while (addedXp < 5400 && guard++ < 400) {
    const d = new Date(Date.now() - (1 + Math.floor(rand() * days)) * 86400000);
    pushLog(academicTimer, d, 1);
  }
  // 超出上限时随机移除已生成的演示记录，避免只裁掉最近几天导致图表断档
  while (addedXp > 5900 && guard++ < 2000 && seededLogIds.length > 0) {
    const pick = Math.floor(rand() * seededLogIds.length);
    const [logId] = seededLogIds.splice(pick, 1);
    const idx = doc.logs.findIndex((l) => l.id === logId);
    if (idx < 0) continue;
    const [removed] = doc.logs.splice(idx, 1);
    addedXp -= removed.xp;
    addedPoints -= removed.points;
    addProficiency(userId, removed.category, -removed.prof);
  }

  const u = getUser(userId)!;
  u.xp += addedXp;
  u.points += addedPoints;

  // 习惯任务的连续记录
  for (const t of created.filter((x) => x.mode === "habit")) {
    t.streak = 9;
    t.bestStreak = 12;
    t.lastPeriodKey = periodKey(t.period as any);
  }
  // 里程碑任务：前两个节点已完成
  const milestoneTask = created.find((t) => t.mode === "milestone");
  if (milestoneTask) {
    const ms = parseMilestones(milestoneTask).map((m, i) => ({ ...m, done: i < 2 }));
    milestoneTask.milestones = JSON.stringify(ms);
  }
  // 计件任务：累计进度
  for (const t of created.filter((x) => x.mode === "count")) {
    t.currentCount = doc.logs
      .filter((l) => l.taskId === t.id)
      .reduce((a, l) => a + Math.max(1, Math.round(l.ratio)), 0);
  }

  const newAchievements = checkAchievements(userId);

  // 成长树：解锁学术分支前两个节点（真实扣除积分）
  const nodes = ["academic_1", "academic_2"];
  for (const nodeId of nodes) {
    const node = SKILL_NODES.find((n) => n.id === nodeId)!;
    const prof = getProficiency(userId)[node.category] ?? 0;
    if (unlockedNodes(userId).includes(nodeId)) continue;
    if (prof >= node.profRequired && u.points >= node.cost) {
      u.points -= node.cost;
      doc.skillNodes.push({ id: nextId("skillNodes"), userId, nodeId, unlockedAt: Date.now() });
    }
  }

  await persist();
  return {
    ok: true,
    addedXp,
    addedPoints,
    logs: allLogs(userId).length,
    level: levelFromXp(u.xp),
    achievements: unlockedAchievementIds(userId).length,
    skillNodes: unlockedNodes(userId).length,
    newAchievements,
  };
}

/** 登录页一键体验：创建演示账号并载入演示数据 */
export async function createDemoAccount() {
  await ensureLoaded();
  let username = "yunlong";
  let n = 1;
  while (getUserByUsername(username)) username = `yunlong${++n}`;
  const user = await createUserRecord({
    username,
    password: "grow2026",
    displayName: "演示账号",
    securityQuestion: "我的第一位导师姓什么？",
    securityAnswer: "张",
  });
  const token = await createSession(user.id, true);
  const seeded = await seedDemoData();
  return { user: await publicUser(user.id), token, username, password: "grow2026", seeded };
}

// ============================================================
// V2 每日维持机制引擎
// 所有可调参数在 @shared/upkeep 中；此处只做取数、结算与持久化。
// 设计要点：
//   1) upkeepDays 只追加，主键 (userId, day)，重复结算直接跳过 → 幂等
//   2) 每行带 updatedAt / deletedAt，便于后续云端同步与软删
//   3) 不向 doc.logs 写任何维持记录，V1 的统计与成就数值完全不受影响
// ============================================================

// ---------------- 配置 ----------------
export function getUpkeepConfig(userId: number): UpkeepConfig {
  const row = doc.upkeepConfigs.find((r) => r.userId === userId);
  return normalizeUpkeepConfig(row?.config ?? UPKEEP_DEFAULT_CONFIG);
}

function writeUpkeepConfig(userId: number, cfg: UpkeepConfig) {
  const row = doc.upkeepConfigs.find((r) => r.userId === userId);
  if (row) {
    row.config = cfg;
    row.updatedAt = Date.now();
  } else {
    doc.upkeepConfigs.push({ userId, config: cfg, updatedAt: Date.now() });
  }
}

// ---------------- 取数 ----------------
function listUpkeepDays(userId: number): UpkeepDay[] {
  return doc.upkeepDays.filter((r) => r.userId === userId && !r.deletedAt).sort((a, b) => (a.day < b.day ? -1 : 1));
}

function findUpkeepDay(userId: number, day: string): UpkeepDay | undefined {
  return doc.upkeepDays.find((r) => r.userId === userId && r.day === day && !r.deletedAt);
}

/** 某日某类别的实际投入（结算次数只数产出为正的结算，与 V1 统计口径一致） */
function upkeepDayMetrics(userId: number, day: string, category: string) {
  const rows = doc.logs.filter((l) => l.userId === userId && l.day === day && l.category === category);
  return {
    minutes: rows.reduce((a, r) => a + focusMinutesOf(r), 0),
    proficiency: rows.reduce((a, r) => a + Math.max(0, r.prof), 0),
    count: rows.filter((r) => r.xp > 0).length,
  };
}

/** 该日所属自然周内、截至该日的累计投入（weekly 模式用） */
function upkeepWeekMetrics(userId: number, day: string, category: string) {
  const days = weekDays(day).filter((d) => d <= day);
  return days.reduce(
    (acc, d) => {
      const m = upkeepDayMetrics(userId, d, category);
      return { minutes: acc.minutes + m.minutes, proficiency: acc.proficiency + m.proficiency, count: acc.count + m.count };
    },
    { minutes: 0, proficiency: 0, count: 0 },
  );
}

function exemptedCategories(userId: number, day: string): Set<string> {
  return new Set(
    doc.upkeepExemptions.filter((e) => e.userId === userId && e.day === day && !e.deletedAt).map((e) => e.category),
  );
}

function exemptionsUsedInWeek(userId: number, day: string): number {
  const start = weekStart(day);
  const end = addDays(start, 6);
  return doc.upkeepExemptions.filter((e) => e.userId === userId && !e.deletedAt && e.day >= start && e.day <= end).length;
}

function userCreatedDay(userId: number): string {
  const u = getUser(userId)!;
  return dateKey(new Date(u.createdAt));
}

/** 新账号宽限期：期间只展示不扣费 */
function graceInfo(userId: number, cfg: UpkeepConfig, day: string) {
  const created = userCreatedDay(userId);
  const elapsed = Math.max(0, dayDiff(created, day));
  const inGrace = elapsed < cfg.graceDays;
  return { inGrace, daysLeft: Math.max(0, cfg.graceDays - elapsed), created };
}

/** 上一日结转的连续未达标天数（豁免日原样结转，不递增也不清零） */
function prevMissStreak(userId: number, day: string, category: string): number {
  const prev = findUpkeepDay(userId, addDays(day, -1));
  return prev?.perCategory?.[category]?.missStreak ?? 0;
}

/** weekly 模式：上一个结算周结转的连续未达标周数 */
function prevWeeklyMissStreak(userId: number, day: string, category: string): number {
  for (let i = 1; i <= 14; i++) {
    const row = findUpkeepDay(userId, addDays(day, -i));
    const pc = row?.perCategory?.[category];
    if (pc?.weeklySettled) return pc.missStreak;
  }
  return 0;
}

function prevAllMetStreak(userId: number, day: string): number {
  const prev = findUpkeepDay(userId, addDays(day, -1));
  return prev?.allMetStreak ?? 0;
}

// ---------------- 单日计算（纯读，不写库） ----------------
type UpkeepDayComputation = {
  day: string;
  perCategory: Record<string, UpkeepCategoryDay>;
  totalDue: number;
  totalCharged: number;
  totalWaived: number;
  bonusGranted: number;
  streakBonus: number;
  netSpend: number;
  exemptionsUsed: number;
  allMet: boolean;
  allMetStreak: number;
  grace: boolean;
  graceDaysLeft: number;
  capped: boolean;
  rawTotal: number;
  streakMilestone: number | null;
};

function computeUpkeepDay(userId: number, day: string, cfg: UpkeepConfig): UpkeepDayComputation {
  const grace = graceInfo(userId, cfg, day);
  const exempted = exemptedCategories(userId, day);
  const isSettleDayForWeek = isWeekEnd(day);
  const fees: Record<string, number> = {};
  const perCategory: Record<string, UpkeepCategoryDay> = {};

  for (const category of CATEGORY_KEYS) {
    const c = cfg.categories[category as keyof typeof cfg.categories];
    const dailyMetrics = upkeepDayMetrics(userId, day, category);
    let targets: UpkeepTargets = c.targets;
    let metrics = dailyMetrics;
    let billable = isDailyBilled(c.mode);
    let weeklySettled = false;

    if (c.mode === "weekly") {
      metrics = upkeepWeekMetrics(userId, day, category);
      targets = c.weeklyTargets;
      weeklySettled = isSettleDayForWeek;
      billable = false; // 不计入「全维达成」的每日判定，只在周日结算维持费
    }

    const att = attainment(targets, metrics);
    const isExempt = exempted.has(category) && (billable || c.mode === "weekly");
    let missStreak = 0;
    let fee = 0;

    if (c.mode === "off") {
      missStreak = 0;
    } else if (c.mode === "weekly") {
      const prev = prevWeeklyMissStreak(userId, day, category);
      if (isExempt) {
        missStreak = prev;
      } else if (att.ratio >= 1) {
        missStreak = weeklySettled ? 0 : prev;
      } else {
        missStreak = weeklySettled ? prev + 1 : prev;
      }
      if (weeklySettled && !isExempt && att.ratio < 1) {
        fee = categoryFee(c.baseFee, att.ratio, cfg.escalation, missStreak);
      }
    } else {
      const prev = prevMissStreak(userId, day, category);
      if (isExempt) {
        // 豁免：当日免费，且不计入连续未达标天数
        missStreak = prev;
      } else if (att.ratio >= 1) {
        missStreak = 0;
      } else {
        // 宽限期内只展示不扣费，也不累积连续未达标天数（出宽限期后从最轻的倍数开始）
        missStreak = grace.inGrace ? prev : prev + 1;
        fee = categoryFee(c.baseFee, att.ratio, cfg.escalation, prev + 1);
      }
    }

    fees[category] = fee;
    perCategory[category] = {
      category: category as any,
      mode: c.mode,
      billable,
      ratio: att.ratio,
      parts: att.parts,
      fee,
      due: fee,
      charged: 0,
      waived: 0,
      exempted: isExempt,
      missStreak,
      weeklySettled,
    };
  }

  const rawTotal = Object.values(fees).reduce((a, b) => a + b, 0);
  const { total: cappedTotal, scaled } = applyDailyCap(fees, cfg.dailyCapPoints);
  for (const category of CATEGORY_KEYS) perCategory[category].due = scaled[category] ?? 0;

  // 全维达成：所有按日计费类别达标度均为 1（豁免不算达成）
  const billableKeys = CATEGORY_KEYS.filter((c) => perCategory[c].billable);
  const allMet =
    billableKeys.length > 0 && billableKeys.every((c) => perCategory[c].ratio >= 1 && !perCategory[c].exempted);
  const allMetStreak = allMet ? prevAllMetStreak(userId, day) + 1 : 0;
  const milestone = allMet ? UPKEEP_ALL_MET_STREAK_BONUSES.find((b) => b.days === allMetStreak) : undefined;
  const bonusGranted = allMet ? cfg.allMetBonus : 0;
  const streakBonus = milestone?.bonus ?? 0;

  const due = grace.inGrace ? 0 : cappedTotal;
  const balance = getUser(userId)!.points;
  const charged = Math.max(0, Math.min(due, balance));
  const waived = due - charged;

  // 实扣按应扣比例分摊，便于面板逐类别展示
  if (charged > 0 && cappedTotal > 0) {
    const ordered = CATEGORY_KEYS.slice().sort((a, b) => perCategory[b].due - perCategory[a].due);
    let used = 0;
    for (const c of ordered) {
      const v = Math.min(perCategory[c].due, Math.floor((perCategory[c].due / cappedTotal) * charged));
      perCategory[c].charged = v;
      used += v;
    }
    let rest = Math.max(0, charged - used);
    while (rest > 0) {
      let moved = false;
      for (const c of ordered) {
        if (rest <= 0) break;
        if (perCategory[c].charged < perCategory[c].due) {
          perCategory[c].charged += 1;
          rest -= 1;
          moved = true;
        }
      }
      if (!moved) break;
    }
    for (const c of CATEGORY_KEYS) {
      perCategory[c].waived = Math.max(0, perCategory[c].due - perCategory[c].charged);
    }
  } else {
    for (const c of CATEGORY_KEYS) {
      perCategory[c].charged = 0;
      perCategory[c].waived = grace.inGrace ? 0 : perCategory[c].due;
    }
  }

  return {
    day,
    perCategory,
    totalDue: due,
    totalCharged: charged,
    totalWaived: waived,
    bonusGranted,
    streakBonus,
    netSpend: charged - bonusGranted - streakBonus,
    exemptionsUsed: CATEGORY_KEYS.filter((c) => perCategory[c].exempted).length,
    allMet,
    allMetStreak,
    grace: grace.inGrace,
    graceDaysLeft: grace.daysLeft,
    capped: rawTotal > cfg.dailyCapPoints,
    rawTotal,
    streakMilestone: milestone?.days ?? null,
  };
}

/** 当天的实时预估（不写库、不扣费） */
function previewUpkeepDay(userId: number, day: string, cfg: UpkeepConfig): UpkeepDayComputation {
  return computeUpkeepDay(userId, day, cfg);
}

// ---------------- 结算落库（幂等） ----------------
function settleUpkeepDay(userId: number, day: string, cfg: UpkeepConfig): UpkeepDay | null {
  if (findUpkeepDay(userId, day)) return null; // (userId, day) 主键去重 → 幂等
  const comp = computeUpkeepDay(userId, day, cfg);
  const now = Date.now();
  const user = getUser(userId)!;
  user.points = Math.max(0, user.points - comp.totalCharged);
  user.points += comp.bonusGranted + comp.streakBonus;
  const row: UpkeepDay = {
    userId,
    day,
    perCategory: comp.perCategory,
    totalDue: comp.totalDue,
    totalCharged: comp.totalCharged,
    totalWaived: comp.totalWaived,
    bonusGranted: comp.bonusGranted,
    streakBonus: comp.streakBonus,
    netSpend: comp.netSpend,
    exemptionsUsed: comp.exemptionsUsed,
    allMet: comp.allMet,
    allMetStreak: comp.allMetStreak,
    grace: comp.grace,
    capped: comp.capped,
    settledAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  doc.upkeepDays.push(row);
  return row;
}

// ---------------- 成就快照 ----------------
function upkeepSnapshot(userId: number) {
  const rows = listUpkeepDays(userId);
  let bestAllMetStreak = 0;
  for (const r of rows) bestAllMetStreak = Math.max(bestAllMetStreak, r.allMetStreak);

  let bestZeroSpendStreak = 0;
  let run = 0;
  let prevDay = "";
  for (const r of rows) {
    if (r.grace) {
      // 宽限期不计入「零支出周」，避免新账号一开就白拿成就
      run = 0;
      prevDay = r.day;
      continue;
    }
    const contiguous = prevDay ? dayDiff(prevDay, r.day) === 1 : true;
    run = (contiguous ? run : 0) + (r.netSpend <= 0 ? 1 : 0);
    if (r.netSpend > 0) run = 0;
    bestZeroSpendStreak = Math.max(bestZeroSpendStreak, run);
    prevDay = r.day;
  }

  // 无需豁免：某一整周 7 天全部有结算记录、全部全维达成、且全周未用豁免
  let perfectWeekNoExemption = false;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const weekStarts = Array.from(new Set(rows.map((r) => weekStart(r.day))));
  for (const ws of weekStarts) {
    const days = weekDays(ws);
    const all = days.map((d) => byDay.get(d));
    if (all.every((r) => r && r.allMet && r.exemptionsUsed === 0)) {
      const used = exemptionsUsedInWeek(userId, ws);
      if (used === 0) perfectWeekNoExemption = true;
    }
  }

  return { bestAllMetStreak, bestZeroSpendStreak, perfectWeekNoExemption, zeroSpendTarget: UPKEEP_ZERO_SPEND_DAYS };
}

// ---------------- 面板数据 ----------------
function upkeepView(userId: number, catchUp?: { days: number; charged: number; rows: { day: string; charged: number; net: number; allMet: boolean }[] } | null) {
  const cfg = getUpkeepConfig(userId);
  const today = upkeepToday();
  const preview = computeUpkeepDay(userId, today, cfg);
  const rows = listUpkeepDays(userId);
  const recent = rows.slice(-30);
  const usedThisWeek = exemptionsUsedInWeek(userId, today);
  const snap = upkeepSnapshot(userId);
  const lastSettledDay = rows.length ? rows[rows.length - 1].day : null;
  return {
    config: cfg,
    today,
    weekStart: weekStart(today),
    estimate: {
      day: today,
      perCategory: preview.perCategory,
      totalDue: preview.totalDue,
      rawTotal: preview.rawTotal,
      capped: preview.capped,
      allMet: preview.allMet,
      allMetStreak: preview.allMetStreak,
      bonus: preview.bonusGranted,
      streakBonus: preview.streakBonus,
      netSpend: preview.netSpend,
      grace: preview.grace,
      graceDaysLeft: preview.graceDaysLeft,
      streakMilestone: preview.streakMilestone,
    },
    exemptions: {
      total: cfg.weeklyExemptions,
      used: usedThisWeek,
      left: Math.max(0, cfg.weeklyExemptions - usedThisWeek),
      today: Array.from(exemptedCategories(userId, today)),
    },
    lastSettledDay,
    recent,
    catchUp: catchUp ?? null,
    snapshot: snap,
    nextMilestone: UPKEEP_ALL_MET_STREAK_BONUSES.find((b) => b.days > preview.allMetStreak) ?? null,
    streakBonuses: UPKEEP_ALL_MET_STREAK_BONUSES,
    summaryMinDays: UPKEEP_SUMMARY_MIN_DAYS,
  };
}

// ---------------- 对外 API ----------------
/** 跨日结算：从上次结算日的次日逐日补算到「昨天」，幂等 */
export async function catchUpUpkeep() {
  await ensureLoaded();
  const userId = requireUserId();
  const cfg = getUpkeepConfig(userId);
  const today = upkeepToday();
  const yesterday = addDays(today, -1);
  const settled: { day: string; charged: number; net: number; allMet: boolean }[] = [];

  if (cfg.enabled) {
    const rows = listUpkeepDays(userId);
    const created = userCreatedDay(userId);
    let cursor = rows.length ? addDays(rows[rows.length - 1].day, 1) : created;
    const earliest = addDays(yesterday, -(UPKEEP_BACKFILL_MAX_DAYS - 1));
    if (cursor < earliest) cursor = earliest;
    let guard = 0;
    while (cursor <= yesterday && guard++ < UPKEEP_BACKFILL_MAX_DAYS + 2) {
      const row = settleUpkeepDay(userId, cursor, cfg);
      if (row) settled.push({ day: row.day, charged: row.totalCharged, net: row.netSpend, allMet: row.allMet });
      cursor = addDays(cursor, 1);
    }
  }

  const newAchievements = settled.length ? checkAchievements(userId) : [];
  if (settled.length) await persist();
  const summary = {
    days: settled.length,
    charged: settled.reduce((a, r) => a + r.charged, 0),
    net: settled.reduce((a, r) => a + r.net, 0),
    allMetDays: settled.filter((r) => r.allMet).length,
    rows: settled,
  };
  return { ...upkeepView(userId, summary.days ? summary : null), newAchievements, summary };
}

export async function getUpkeep() {
  await ensureLoaded();
  const userId = requireUserId();
  return upkeepView(userId, null);
}

/** 使用本周豁免格：该类别当日免费且不计入连续未达标天数，不可透支 */
export async function useUpkeepExemption(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const category = String(body?.category ?? "");
  if (!CATEGORY_KEYS.includes(category as any)) throw new LocalError("类别不存在");
  const cfg = getUpkeepConfig(userId);
  if (!cfg.enabled) throw new LocalError("维持机制当前已关闭");
  const mode = cfg.categories[category as keyof typeof cfg.categories].mode;
  if (mode === "off") throw new LocalError("该类别当前为「只统计」，无需豁免");
  const today = upkeepToday();
  if (exemptedCategories(userId, today).has(category)) throw new LocalError("该类别今日已使用豁免");
  const used = exemptionsUsedInWeek(userId, today);
  if (used >= cfg.weeklyExemptions) throw new LocalError("本周豁免格已用完，下周一恢复");
  const now = Date.now();
  doc.upkeepExemptions.push({
    id: nextId("upkeepExemptions"),
    userId,
    day: today,
    category,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  await persist();
  return upkeepView(userId, null);
}

export async function updateUpkeepConfig(body: any) {
  await ensureLoaded();
  const userId = requireUserId();
  const reset = !!body?.reset;
  const base = reset ? UPKEEP_DEFAULT_CONFIG : { ...getUpkeepConfig(userId), ...(body?.config ?? body ?? {}) };
  const next = normalizeUpkeepConfig(base);
  writeUpkeepConfig(userId, next);
  await persist();
  return upkeepView(userId, null);
}

// ============================================================
// 仅供自动化自测使用的时间/数据注入点。
// 生产 UI 中没有任何入口，只在 window 上挂载函数，不影响任何界面与数值。
// ============================================================
export const __upkeepDev = {
  async setClockOffsetDays(days: number) {
    setUpkeepClockOffsetMs(Math.round(Number(days) || 0) * 86400000);
    return { offsetDays: Number(days) || 0 };
  },
  async resetClock() {
    setUpkeepClockOffsetMs(0);
    return { offsetDays: 0 };
  },
  /** 直接写入一条产出日志（不加分、不动等级），用于构造历史投入 */
  async injectLog(input: { category: string; day: string; minutes?: number; prof?: number; settlements?: number }) {
    await ensureLoaded();
    const userId = requireUserId();
    const n = Math.max(1, Math.round(Number(input.settlements ?? 1)));
    for (let i = 0; i < n; i++) {
      doc.logs.push({
        id: nextId("logs"),
        userId,
        taskId: 0,
        taskTitle: "自测注入",
        category: input.category,
        mode: "timer",
        kind: "block",
        day: input.day,
        xp: 1,
        points: 0,
        prof: i === 0 ? Math.max(0, Math.round(Number(input.prof ?? 0))) : 0,
        minutes: i === 0 ? Math.max(0, Math.round(Number(input.minutes ?? 0))) : 0,
        ratio: 1,
        note: "dev",
        createdAt: Date.now(),
      });
    }
    await persist();
    return { ok: true };
  },
  async setPoints(points: number) {
    await ensureLoaded();
    const userId = requireUserId();
    getUser(userId)!.points = Math.max(0, Math.round(Number(points) || 0));
    await persist();
    return { points: getUser(userId)!.points };
  },
  async setCreatedDaysAgo(days: number) {
    await ensureLoaded();
    const userId = requireUserId();
    getUser(userId)!.createdAt = Date.now() - Math.max(0, Math.round(Number(days) || 0)) * 86400000;
    await persist();
    return { createdAt: getUser(userId)!.createdAt };
  },
  async resetUpkeep() {
    await ensureLoaded();
    const userId = requireUserId();
    doc.upkeepDays = doc.upkeepDays.filter((r) => r.userId !== userId);
    doc.upkeepExemptions = doc.upkeepExemptions.filter((r) => r.userId !== userId);
    doc.logs = doc.logs.filter((l) => !(l.userId === userId && l.note === "dev"));
    doc.achievements = doc.achievements.filter(
      (a) => !(a.userId === userId && a.achievementId.startsWith("upkeep_")),
    );
    setUpkeepClockOffsetMs(0);
    await persist();
    return { ok: true };
  },
  /** V1 回归自测：纯计算，不写库 */
  v1Baseline() {
    const out: Record<string, number[]> = {};
    const run = (key: string, mode: any, ratio: number) => {
      const d = (RULE_DEFAULTS as any)[key];
      const r = computeSettlement({
        xpPerUnit: d.xpPerUnit,
        pointsPerUnit: d.pointsPerUnit,
        profPerUnit: d.profPerUnit,
        difficulty: 2,
        ratio,
        mode,
        streak: 0,
      });
      out[key] = [r.xp, r.points, r.prof];
    };
    run("academic_timer", "timer", 1);
    run("academic_milestone", "milestone", 1);
    run("academic_habit", "habit", 1);
    run("academic_count", "count", 1);
    return { results: out, v1AchievementCount: V1_ACHIEVEMENT_COUNT, totalAchievements: ACHIEVEMENTS.length };
  },
  async catchUp() {
    return catchUpUpkeep();
  },
  async view() {
    return getUpkeep();
  },
  async dump() {
    await ensureLoaded();
    const userId = requireUserId();
    return {
      points: getUser(userId)!.points,
      xp: getUser(userId)!.xp,
      proficiency: getProficiency(userId),
      upkeepDays: listUpkeepDays(userId),
      config: getUpkeepConfig(userId),
      achievements: unlockedAchievementIds(userId),
    };
  },
};

if (typeof window !== "undefined") {
  (window as any).__upkeepDev = __upkeepDev;
}

// ============================================================
// V2 云端同步层（SPEC-V2 第一章）
//
// 设计要点：
//   1) 离线优先：UI 永远读本地 doc；写操作先本地 + 乐观更新，
//      persist() 时把「本地已改、云端还没有」的行推进 outbox 队列。
//   2) outbox 按 (table, pk) 去重，重复操作只会留一条 → 联网补传绝不重复计分。
//   3) 只追加表（结算/兑换/维持/成就/成长树）按主键去重合并，永不覆盖；
//      profiles / tasks / rewards 走 last-write-wins by updated_at，删除用软删墓碑。
//   4) 合并完成后调用 reprojectUser()，由 projectState() 纯函数重算
//      xp / points / proficiency / level，保证多设备最终一致。
// ============================================================
import { projectState } from "@shared/projection";
import {
  achievementToCloud,
  APPEND_ONLY,
  CLOUD_TABLES,
  logFromCloud,
  logToCloud,
  redemptionFromCloud,
  redemptionToCloud,
  rewardFromCloud,
  rewardToCloud,
  skillNodeToCloud,
  taskFromCloud,
  taskToCloud,
  toIso,
  fromIso,
  upkeepDayFromCloud,
  upkeepDayToCloud,
  type CloudTable,
} from "./cloud-map";

// ---------------- 基础工具 ----------------
export function newUid(): string {
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${randomHex(8)}-${randomHex(2)}-4${randomHex(2).slice(1)}-a${randomHex(2).slice(1)}-${randomHex(6)}`;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

/** 行内容指纹（刻意不含 updatedAt，避免「刚拉下来就又变脏」） */
function contentHash(obj: unknown): string {
  return fnv1a(JSON.stringify(obj, (k, v) => (k === "updatedAt" ? undefined : v)));
}

const CURSOR_COL: Record<CloudTable, string> = {
  profiles: "updated_at",
  tasks: "updated_at",
  rewards: "updated_at",
  settlement_logs: "created_at",
  redemptions: "redeemed_at",
  achievements_unlocked: "unlocked_at",
  skill_nodes_unlocked: "unlocked_at",
  upkeep_days: "settled_at",
};

const CONFLICT_KEY: Record<CloudTable, string> = {
  profiles: "user_id",
  tasks: "id",
  rewards: "id",
  settlement_logs: "id",
  redemptions: "id",
  achievements_unlocked: "user_id,achievement_id",
  skill_nodes_unlocked: "user_id,node_id",
  upkeep_days: "user_id,day",
};

// ---------------- 云账号绑定 ----------------
export function cloudUserIdOf(userId: number): string | null {
  return getUser(userId)?.cloudUserId ?? null;
}

/** 当前登录的本地账号是否为云端账号 */
export function activeCloudUserId(): string | null {
  const s = getSession(authToken);
  if (!s) return null;
  return cloudUserIdOf(s.userId);
}

function activeLocalUserId(): number | null {
  const s = getSession(authToken);
  return s ? s.userId : null;
}

/** 同步引擎入口：当前登录账号的本地 id 与云端 id */
export async function activeUserIds(): Promise<{ localId: number; cloudId: string } | null> {
  await ensureLoaded();
  const localId = activeLocalUserId();
  if (localId == null) return null;
  const cloudId = cloudUserIdOf(localId);
  if (!cloudId) return null;
  return { localId, cloudId };
}

// ---------------- uid 回填 ----------------
function backfillUids(userId: number) {
  for (const t of doc.tasks) if (t.userId === userId && !t.uid) t.uid = newUid();
  for (const r of doc.rewards) if (r.userId === userId && !r.uid) r.uid = newUid();
  for (const l of doc.logs) if (l.userId === userId && !l.uid) l.uid = newUid();
  for (const r of doc.redemptions) if (r.userId === userId && !r.uid) r.uid = newUid();
}

// ---------------- 行枚举 ----------------
type DirtyRow = { table: CloudTable; pk: string; hash: string };

function enumerateRows(userId: number, cloudId: string): DirtyRow[] {
  const out: DirtyRow[] = [];
  const u = getUser(userId);
  if (!u) return out;
  out.push({ table: "profiles", pk: cloudId, hash: contentHash(profileToCloud(userId, cloudId)) });
  for (const t of doc.tasks) if (t.userId === userId && t.uid) out.push({ table: "tasks", pk: t.uid, hash: contentHash(taskToCloud(t, cloudId)) });
  for (const r of doc.rewards) if (r.userId === userId && r.uid) out.push({ table: "rewards", pk: r.uid, hash: contentHash(rewardToCloud(r, cloudId)) });
  for (const l of doc.logs) if (l.userId === userId && l.uid) out.push({ table: "settlement_logs", pk: l.uid, hash: "a" });
  for (const r of doc.redemptions) if (r.userId === userId && r.uid) out.push({ table: "redemptions", pk: r.uid, hash: "a" });
  for (const a of doc.achievements) if (a.userId === userId) out.push({ table: "achievements_unlocked", pk: a.achievementId, hash: "a" });
  for (const n of doc.skillNodes) if (n.userId === userId) out.push({ table: "skill_nodes_unlocked", pk: n.nodeId, hash: "a" });
  for (const d of doc.upkeepDays) if (d.userId === userId && !d.deletedAt) out.push({ table: "upkeep_days", pk: d.day, hash: "a" });
  return out;
}

/** persist() 的钩子：把变脏的行入队。同步层出错绝不影响本地写入。 */
function enqueueDirtyRows() {
  const localId = activeLocalUserId();
  if (localId == null) return;
  const cloudId = cloudUserIdOf(localId);
  if (!cloudId) return; // 本地模式不入队
  backfillUids(localId);
  const now = Date.now();
  const queued = new Set(doc.outbox.map((e) => `${e.table}::${e.pk}`));
  let seq = doc.outbox.reduce((a, e) => Math.max(a, e.seq), 0);
  for (const row of enumerateRows(localId, cloudId)) {
    const known = doc.pushed[row.table]?.[row.pk];
    if (known === row.hash) continue;
    // 可变表：内容变了就刷新 updatedAt（last-write-wins 依据）
    if (row.table === "tasks") {
      const t = doc.tasks.find((x) => x.uid === row.pk);
      if (t) t.updatedAt = now;
    } else if (row.table === "rewards") {
      const r = doc.rewards.find((x) => x.uid === row.pk);
      if (r) r.updatedAt = now;
    }
    const key = `${row.table}::${row.pk}`;
    if (queued.has(key)) continue;
    queued.add(key);
    doc.outbox.push({ seq: ++seq, table: row.table, pk: row.pk, cloudUserId: cloudId, createdAt: now, tries: 0 });
  }
}

// ---------------- profiles ----------------
function profileToCloud(userId: number, cloudId: string) {
  const u = getUser(userId)!;
  const pend = doc.upkeepExemptions
    .filter((e) => e.userId === userId && !e.deletedAt)
    .map((e) => ({ day: e.day, category: e.category, createdAt: e.createdAt }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.category < b.category ? -1 : 1));
  return {
    user_id: cloudId,
    display_name: u.displayName,
    theme: u.theme,
    // 只同步 base_url / model —— AI API Key 绝不上云
    ai_config: { base_url: u.aiBaseUrl, model: u.aiModel },
    upkeep_config: getUpkeepConfig(userId),
    settings: {
      pendingExemptions: pend,
      createdAt: u.createdAt,
      sleep: doc.sleepSettings[userId] ?? null,
    },
    timezone: getUpkeepConfig(userId).timezone,
    last_backup_at: toIso(doc.lastBackupAt[String(userId)] ?? null),
  };
}

function profileFromCloud(userId: number, row: any) {
  const u = getUser(userId);
  if (!u) return;
  if (typeof row.display_name === "string" && row.display_name) u.displayName = row.display_name;
  if (row.theme === "dark" || row.theme === "light") u.theme = row.theme;
  const ai = row.ai_config ?? {};
  if (typeof ai.base_url === "string" && ai.base_url) u.aiBaseUrl = ai.base_url;
  if (typeof ai.model === "string" && ai.model) u.aiModel = ai.model;
  if (row.upkeep_config && Object.keys(row.upkeep_config).length) {
    writeUpkeepConfig(userId, normalizeUpkeepConfig(row.upkeep_config));
  }
  const sleepCfg = (row.settings ?? {}).sleep;
  if (sleepCfg && typeof sleepCfg.idealBedtime === "string" && sleepCfg.idealBedtime) {
    doc.sleepSettings[userId] = {
      idealBedtime: sleepCfg.idealBedtime,
      idealSleepHours: Number(sleepCfg.idealSleepHours) || 7.5,
    };
  }
  const pend = (row.settings ?? {}).pendingExemptions;
  if (Array.isArray(pend)) {
    for (const e of pend) {
      if (!e?.day || !e?.category) continue;
      const exists = doc.upkeepExemptions.some((x) => x.userId === userId && x.day === e.day && x.category === e.category);
      if (exists) continue;
      doc.upkeepExemptions.push({
        id: nextId("upkeepExemptions"),
        userId,
        day: e.day,
        category: e.category,
        createdAt: e.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      });
    }
  }
  const lb = fromIso(row.last_backup_at, 0);
  if (lb) doc.lastBackupAt[String(userId)] = Math.max(doc.lastBackupAt[String(userId)] ?? 0, lb);
}

// ---------------- 数值重算（SPEC-V2 1.4） ----------------
export function reprojectUser(userId: number): { xp: number; points: number } {
  const u = getUser(userId);
  if (!u) return { xp: 0, points: 0 };
  const s = projectState(
    doc.logs.filter((l) => l.userId === userId),
    doc.redemptions.filter((r) => r.userId === userId),
    doc.upkeepDays.filter((d) => d.userId === userId && !d.deletedAt),
    doc.skillNodes.filter((n) => n.userId === userId),
    doc.achievements.filter((a) => a.userId === userId),
  );
  u.xp = s.xp;
  u.points = s.points;
  for (const c of CATEGORY_KEYS) {
    const row = doc.proficiency.find((p) => p.userId === userId && p.category === c);
    if (row) row.value = s.proficiency[c] ?? 0;
    else doc.proficiency.push({ id: nextId("proficiency"), userId, category: c, value: s.proficiency[c] ?? 0 });
  }
  return { xp: s.xp, points: s.points };
}

// ---------------- 推送用的行序列化 ----------------
export function buildPushRow(table: CloudTable, pk: string, userId: number, cloudId: string): any | null {
  switch (table) {
    case "profiles":
      return profileToCloud(userId, cloudId);
    case "tasks": {
      const t = doc.tasks.find((x) => x.userId === userId && x.uid === pk);
      return t ? taskToCloud(t, cloudId) : null;
    }
    case "rewards": {
      const r = doc.rewards.find((x) => x.userId === userId && x.uid === pk);
      return r ? rewardToCloud(r, cloudId) : null;
    }
    case "settlement_logs": {
      const l = doc.logs.find((x) => x.userId === userId && x.uid === pk);
      if (!l) return null;
      const task = doc.tasks.find((t) => t.id === l.taskId && t.userId === userId);
      return logToCloud(l, cloudId, task?.uid ?? null);
    }
    case "redemptions": {
      const r = doc.redemptions.find((x) => x.userId === userId && x.uid === pk);
      if (!r) return null;
      const rw = doc.rewards.find((x) => x.id === r.rewardId && x.userId === userId);
      return redemptionToCloud(r, cloudId, rw?.uid ?? null);
    }
    case "achievements_unlocked": {
      const a = doc.achievements.find((x) => x.userId === userId && x.achievementId === pk);
      return a ? achievementToCloud(a, cloudId) : null;
    }
    case "skill_nodes_unlocked": {
      const n = doc.skillNodes.find((x) => x.userId === userId && x.nodeId === pk);
      if (!n) return null;
      const node = SKILL_NODES.find((x) => x.id === n.nodeId);
      return skillNodeToCloud({ ...n, cost: n.cost ?? node?.cost ?? 0 }, cloudId);
    }
    case "upkeep_days": {
      const d = doc.upkeepDays.find((x) => x.userId === userId && x.day === pk && !x.deletedAt);
      return d ? upkeepDayToCloud(d, cloudId) : null;
    }
  }
  return null;
}

// ---------------- 合并云端行 ----------------
export function mergeCloudRows(userId: number, table: CloudTable, rows: any[]): number {
  let applied = 0;
  for (const row of rows) {
    switch (table) {
      case "profiles": {
        profileFromCloud(userId, row);
        applied++;
        break;
      }
      case "tasks": {
        const local = doc.tasks.find((t) => t.userId === userId && t.uid === row.id);
        const cloudAt = fromIso(row.updated_at, 0);
        if (!local) {
          doc.tasks.push(taskFromCloud(row, nextId("tasks"), userId));
          applied++;
        } else if (cloudAt >= (local.updatedAt ?? 0)) {
          // last-write-wins by updated_at（含 deleted_at 墓碑）
          Object.assign(local, taskFromCloud(row, local.id, userId));
          applied++;
        }
        break;
      }
      case "rewards": {
        const local = doc.rewards.find((r) => r.userId === userId && r.uid === row.id);
        const cloudAt = fromIso(row.updated_at, 0);
        if (!local) {
          doc.rewards.push(rewardFromCloud(row, nextId("rewards"), userId));
          applied++;
        } else if (cloudAt >= (local.updatedAt ?? 0)) {
          Object.assign(local, rewardFromCloud(row, local.id, userId));
          applied++;
        }
        break;
      }
      case "settlement_logs": {
        if (doc.logs.some((l) => l.userId === userId && l.uid === row.id)) break; // 主键去重，永不覆盖
        const task = row.task_id ? doc.tasks.find((t) => t.userId === userId && t.uid === row.task_id) : undefined;
        doc.logs.push(logFromCloud(row, nextId("logs"), userId, task?.id ?? 0));
        applied++;
        break;
      }
      case "redemptions": {
        if (doc.redemptions.some((r) => r.userId === userId && r.uid === row.id)) break;
        const rw = row.reward_id ? doc.rewards.find((x) => x.userId === userId && x.uid === row.reward_id) : undefined;
        doc.redemptions.push(redemptionFromCloud(row, nextId("redemptions"), userId, rw?.id ?? 0));
        applied++;
        break;
      }
      case "achievements_unlocked": {
        if (doc.achievements.some((a) => a.userId === userId && a.achievementId === row.achievement_id)) break;
        doc.achievements.push({
          id: nextId("achievements"),
          userId,
          achievementId: row.achievement_id,
          unlockedAt: fromIso(row.unlocked_at, Date.now()),
        });
        applied++;
        break;
      }
      case "skill_nodes_unlocked": {
        if (doc.skillNodes.some((n) => n.userId === userId && n.nodeId === row.node_id)) break;
        doc.skillNodes.push({
          id: nextId("skillNodes"),
          userId,
          nodeId: row.node_id,
          cost: row.cost ?? 0,
          unlockedAt: fromIso(row.unlocked_at, Date.now()),
        });
        applied++;
        break;
      }
      case "upkeep_days": {
        if (doc.upkeepDays.some((d) => d.userId === userId && d.day === row.day)) break; // (user,day) 幂等
        doc.upkeepDays.push(upkeepDayFromCloud(row, userId));
        applied++;
        break;
      }
    }
  }
  return applied;
}

// ---------------- outbox 维护 ----------------
export function outboxEntries(cloudId: string): OutboxEntry[] {
  return doc.outbox.filter((e) => e.cloudUserId === cloudId).sort((a, b) => a.seq - b.seq);
}

export function outboxCount(cloudId: string | null): number {
  if (!cloudId) return 0;
  return doc.outbox.filter((e) => e.cloudUserId === cloudId).length;
}

export function markPushed(userId: number, cloudId: string, entries: { table: CloudTable; pk: string }[]) {
  for (const e of entries) {
    const hash =
      e.table === "profiles"
        ? contentHash(profileToCloud(userId, cloudId))
        : e.table === "tasks"
          ? contentHash(taskToCloud(doc.tasks.find((t) => t.uid === e.pk)!, cloudId))
          : e.table === "rewards"
            ? contentHash(rewardToCloud(doc.rewards.find((r) => r.uid === e.pk)!, cloudId))
            : "a";
    if (!doc.pushed[e.table]) doc.pushed[e.table] = {};
    doc.pushed[e.table][e.pk] = hash;
  }
  const drop = new Set(entries.map((e) => `${e.table}::${e.pk}`));
  doc.outbox = doc.outbox.filter((e) => !(e.cloudUserId === cloudId && drop.has(`${e.table}::${e.pk}`)));
}

export function markPushFailed(cloudId: string, table: CloudTable, message: string) {
  for (const e of doc.outbox) {
    if (e.cloudUserId === cloudId && e.table === table) {
      e.tries += 1;
      e.lastError = message.slice(0, 200);
    }
  }
}

/** 拉取合并后记录指纹，避免刚合并进来的行又被判为「本地已改」 */
export function recordMergedHashes(userId: number, cloudId: string) {
  for (const row of enumerateRows(userId, cloudId)) {
    if (!doc.pushed[row.table]) doc.pushed[row.table] = {};
    if (doc.outbox.some((e) => e.cloudUserId === cloudId && e.table === row.table && e.pk === row.pk)) continue;
    doc.pushed[row.table][row.pk] = row.hash;
  }
}

export function getCursor(cloudId: string, table: CloudTable): string {
  return doc.cursors[`${cloudId}:${table}`] ?? "1970-01-01T00:00:00.000Z";
}
export function setCursor(cloudId: string, table: CloudTable, iso: string) {
  const cur = doc.cursors[`${cloudId}:${table}`];
  if (!cur || Date.parse(iso) >= Date.parse(cur)) doc.cursors[`${cloudId}:${table}`] = iso;
}
export function cursorColumn(table: CloudTable): string {
  return CURSOR_COL[table];
}
export function conflictKey(table: CloudTable): string {
  return CONFLICT_KEY[table];
}
export function isAppendOnly(table: CloudTable): boolean {
  return APPEND_ONLY.includes(table);
}
export function cloudTables(): readonly CloudTable[] {
  return CLOUD_TABLES;
}

export function lastSyncAt(cloudId: string | null): number {
  return cloudId ? (doc.lastSyncAt[cloudId] ?? 0) : 0;
}
export function setLastSyncAt(cloudId: string, at: number) {
  doc.lastSyncAt[cloudId] = at;
}

export async function persistNow() {
  await persist();
}

/** 「强制以云端为准重新拉取」：清空本机该账号的业务数据与游标后全量重拉 */
export async function resetLocalForCloud(cloudId: string) {
  await ensureLoaded();
  const localId = doc.users.find((u) => u.cloudUserId === cloudId)?.id;
  if (localId == null) throw new LocalError("未找到对应的本地账号", 404);
  clearUserData(localId);
  doc.rewards = doc.rewards.filter((r) => r.userId !== localId);
  doc.upkeepConfigs = doc.upkeepConfigs.filter((r) => r.userId !== localId);
  doc.outbox = doc.outbox.filter((e) => e.cloudUserId !== cloudId);
  for (const t of CLOUD_TABLES) {
    delete doc.cursors[`${cloudId}:${t}`];
    if (doc.pushed[t]) doc.pushed[t] = {};
  }
  await persist();
  return { ok: true };
}

// ---------------- 云端账号的本地镜像账号 ----------------
export async function attachCloudSession(input: {
  cloudUserId: string;
  email: string;
  displayName?: string;
  remember?: boolean;
}): Promise<{ user: any; token: string }> {
  await ensureLoaded();
  let user = doc.users.find((u) => u.cloudUserId === input.cloudUserId);
  if (!user) {
    user = {
      id: nextId("users"),
      username: input.email,
      cloudUserId: input.cloudUserId,
      email: input.email,
      password: "",
      displayName: input.displayName?.trim() || input.email.split("@")[0],
      securityQuestion: "",
      securityAnswer: "",
      xp: 0,
      points: 0,
      theme: "dark",
      aiBaseUrl: "https://api.deepseek.com/v1",
      aiApiKey: "",
      aiModel: "deepseek-chat",
      createdAt: Date.now(),
    };
    doc.users.push(user);
    for (const c of CATEGORY_KEYS) doc.proficiency.push({ id: nextId("proficiency"), userId: user.id, category: c, value: 0 });
    for (const r of DEFAULT_REWARDS) {
      doc.rewards.push({ ...r, id: nextId("rewards"), uid: newUid(), userId: user.id, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null });
    }
  } else {
    user.email = input.email;
    user.username = input.email;
  }
  purgeExpiredSessions();
  const token = await createSession(user.id, input.remember !== false);
  await persist();
  return { user: await publicUser(user.id), token };
}

/** V0.5：把当前本地账号连接到 GitHub 私有同步仓库（不创建新的镜像账号） */
export async function githubConnectCurrent(input: {
  token: string;
  repo: string;
  cloudUserId: string;
  login: string;
}): Promise<{ user: any; token: string }> {
  await ensureLoaded();
  const userId = requireUserId();
  const u = getUser(userId)!;
  const repo = String(input.repo ?? "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (!repo.includes("/")) throw new LocalError("同步仓库格式应为 owner/repo");
  u.cloudUserId = String(input.cloudUserId);
  u.email = String(input.login || input.cloudUserId);
  u.username = u.username || String(input.login || input.cloudUserId);
  u.githubToken = await encryptSecretValue(String(input.token ?? ""), doc.appSecret);
  u.githubRepo = repo;
  backfillUids(userId);
  await persist();
  const s = getSession(authToken);
  return { user: await publicUser(userId), token: s?.token ?? "" };
}

/** V0.5：断开当前账号的 GitHub 同步，恢复纯本地模式 */
export async function githubDisconnectCurrent() {
  await ensureLoaded();
  const userId = requireUserId();
  const u = getUser(userId)!;
  const cloudId = u.cloudUserId ?? null;
  if (cloudId) {
    doc.outbox = doc.outbox.filter((e) => e.cloudUserId !== cloudId);
    for (const t of CLOUD_TABLES) {
      delete doc.cursors[`${cloudId}:${t}`];
      if (doc.pushed[t]) doc.pushed[t] = {};
    }
  }
  u.cloudUserId = null;
  u.email = "";
  u.githubToken = "";
  u.githubRepo = "";
  await persist();
  return { ok: true, user: await publicUser(userId) };
}

/** V0.5：当前会话对应的 GitHub 用户 id，用于启动时恢复登录 */
export async function githubCurrentUser(): Promise<{ id: string; email: string } | null> {
  await ensureLoaded();
  const cloudId = activeCloudUserId();
  if (!cloudId || !cloudId.startsWith("github:")) return null;
  const localId = activeLocalUserId();
  if (localId == null) return null;
  return { id: cloudId, email: getUser(localId)?.email || cloudId };
}

/** V0.6：把当前本地账号连接到自托管在线后端 */
export async function serverConnectCurrent(input: {
  serverUrl: string;
  token: string;
  cloudUserId: string;
  email: string;
}): Promise<{ user: any; token: string }> {
  await ensureLoaded();
  const userId = requireUserId();
  const u = getUser(userId)!;
  u.cloudUserId = String(input.cloudUserId);
  u.email = String(input.email || input.cloudUserId);
  u.username = u.username || String(input.email || input.cloudUserId);
  u.serverUrl = String(input.serverUrl ?? "").trim();
  u.serverToken = await encryptSecretValue(String(input.token ?? ""), doc.appSecret);
  u.githubToken = "";
  u.githubRepo = "";
  backfillUids(userId);
  await persist();
  const s = getSession(authToken);
  return { user: await publicUser(userId), token: s?.token ?? "" };
}

/** V0.6：当前会话对应的在线后端用户 id，用于启动时恢复登录 */
export async function serverCurrentUser(): Promise<{ id: string; email: string } | null> {
  await ensureLoaded();
  const cloudId = activeCloudUserId();
  if (!cloudId || cloudId.startsWith("github:")) return null;
  const localId = activeLocalUserId();
  if (localId == null) return null;
  return { id: cloudId, email: getUser(localId)?.email || cloudId };
}

/** V0.6：读取当前账号的在线后端连接信息 */
export async function serverConnection(userId: number): Promise<{ baseUrl: string; token: string }> {
  await ensureLoaded();
  const u = getUser(userId);
  if (!u) return { baseUrl: "", token: "" };
  return {
    baseUrl: u.serverUrl || "",
    token: await decryptSecretValue(u.serverToken ?? "", doc.appSecret),
  };
}

/** V0.6：断开当前账号的在线后端连接 */
export async function serverDisconnectCurrent() {
  await ensureLoaded();
  const userId = requireUserId();
  const u = getUser(userId)!;
  const cloudId = u.cloudUserId ?? null;
  if (cloudId) {
    doc.outbox = doc.outbox.filter((e) => e.cloudUserId !== cloudId);
    for (const t of CLOUD_TABLES) {
      delete doc.cursors[`${cloudId}:${t}`];
      if (doc.pushed[t]) doc.pushed[t] = {};
    }
  }
  u.cloudUserId = null;
  u.email = "";
  u.serverUrl = "";
  u.serverToken = "";
  await persist();
  return { ok: true, user: await publicUser(userId) };
}

/** V0.5：读取当前账号的 GitHub 连接信息（token 在内存中解密） */
export async function githubConnection(userId: number): Promise<{ token: string; repo: string }> {
  await ensureLoaded();
  const u = getUser(userId);
  if (!u) return { token: "", repo: "" };
  return {
    token: await decryptSecretValue(u.githubToken ?? "", doc.appSecret),
    repo: u.githubRepo ?? "",
  };
}

/** V0.5：把当前账号的全部可同步行序列化成单个快照，供 GitHub 文件后端使用 */
export function buildCloudSnapshot(userId: number, cloudId: string): Record<CloudTable, any[]> {
  const out = {} as Record<CloudTable, any[]>;
  for (const table of CLOUD_TABLES) out[table] = [];
  for (const row of enumerateRows(userId, cloudId)) {
    const built = buildPushRow(row.table, row.pk, userId, cloudId);
    if (built) out[row.table].push(built);
  }
  return out;
}

/** V0.5：GitHub 快照上传成功后，清空该账号的全部 outbox */
export function markAllPushed(userId: number, cloudId: string) {
  const entries = enumerateRows(userId, cloudId).map((r) => ({ table: r.table, pk: r.pk }));
  markPushed(userId, cloudId, entries);
}

/** 本地模式账号列表（可迁移到云端的候选） */
export async function localOnlyAccounts() {
  await ensureLoaded();
  return doc.users
    .filter((u) => !u.cloudUserId)
    .map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      xp: u.xp,
      points: u.points,
      tasks: doc.tasks.filter((t) => t.userId === u.id && !t.deletedAt).length,
      logs: doc.logs.filter((l) => l.userId === u.id).length,
      upkeepDays: doc.upkeepDays.filter((d) => d.userId === u.id).length,
      records:
        doc.tasks.filter((t) => t.userId === u.id && !t.deletedAt).length +
        doc.logs.filter((l) => l.userId === u.id).length +
        doc.redemptions.filter((r) => r.userId === u.id).length +
        doc.upkeepDays.filter((d) => d.userId === u.id).length,
    }))
    .filter((a) => a.records > 0);
}

/** 一键把某个本地模式账号的数据搬到当前云端账号（数值由 projectState 复算，保持不变） */
export async function migrateLocalAccountToCloud(fromLocalUserId: number) {
  await ensureLoaded();
  const targetId = requireUserId();
  const target = getUser(targetId)!;
  if (!target.cloudUserId) throw new LocalError("请先登录云端账号");
  const source = getUser(fromLocalUserId);
  if (!source) throw new LocalError("本地数据不存在", 404);
  if (source.id === targetId) throw new LocalError("不能迁移到自己");
  const before = { xp: source.xp, points: source.points, proficiency: getProficiency(fromLocalUserId) };

  const taskIdMap = new Map<number, number>();
  for (const t of doc.tasks.filter((x) => x.userId === fromLocalUserId)) {
    const id = nextId("tasks");
    taskIdMap.set(t.id, id);
    doc.tasks.push({ ...t, id, uid: newUid(), userId: targetId, updatedAt: Date.now(), deletedAt: t.deletedAt ?? null });
  }
  const rewardIdMap = new Map<number, number>();
  for (const r of doc.rewards.filter((x) => x.userId === fromLocalUserId)) {
    const id = nextId("rewards");
    rewardIdMap.set(r.id, id);
    doc.rewards.push({ ...r, id, uid: newUid(), userId: targetId, updatedAt: Date.now(), deletedAt: r.deletedAt ?? null });
  }
  for (const l of doc.logs.filter((x) => x.userId === fromLocalUserId)) {
    doc.logs.push({ ...l, id: nextId("logs"), uid: newUid(), userId: targetId, taskId: taskIdMap.get(l.taskId) ?? 0 });
  }
  for (const r of doc.redemptions.filter((x) => x.userId === fromLocalUserId)) {
    doc.redemptions.push({ ...r, id: nextId("redemptions"), uid: newUid(), userId: targetId, rewardId: rewardIdMap.get(r.rewardId) ?? 0 });
  }
  for (const a of doc.achievements.filter((x) => x.userId === fromLocalUserId)) {
    if (doc.achievements.some((x) => x.userId === targetId && x.achievementId === a.achievementId)) continue;
    doc.achievements.push({ ...a, id: nextId("achievements"), userId: targetId });
  }
  for (const n of doc.skillNodes.filter((x) => x.userId === fromLocalUserId)) {
    if (doc.skillNodes.some((x) => x.userId === targetId && x.nodeId === n.nodeId)) continue;
    doc.skillNodes.push({ ...n, id: nextId("skillNodes"), userId: targetId });
  }
  for (const d of doc.upkeepDays.filter((x) => x.userId === fromLocalUserId)) {
    if (doc.upkeepDays.some((x) => x.userId === targetId && x.day === d.day)) continue;
    doc.upkeepDays.push({ ...d, userId: targetId });
  }
  for (const e of doc.upkeepExemptions.filter((x) => x.userId === fromLocalUserId)) {
    if (doc.upkeepExemptions.some((x) => x.userId === targetId && x.day === e.day && x.category === e.category)) continue;
    doc.upkeepExemptions.push({ ...e, id: nextId("upkeepExemptions"), userId: targetId });
  }
  const srcCfg = doc.upkeepConfigs.find((c) => c.userId === fromLocalUserId);
  if (srcCfg) writeUpkeepConfig(targetId, normalizeUpkeepConfig(srcCfg.config));

  const after = reprojectUser(targetId);
  await persist();
  return {
    ok: true,
    before,
    after: { xp: after.xp, points: after.points, proficiency: getProficiency(targetId) },
    migrated: {
      tasks: taskIdMap.size,
      logs: doc.logs.filter((l) => l.userId === targetId).length,
      upkeepDays: doc.upkeepDays.filter((d) => d.userId === targetId).length,
    },
  };
}

/** 导入 V1 备份 JSON 到当前账号；云端账号会自动重算并排队上传 */
export async function importBackupToCloud(payload: any) {
  await importData(payload);
  const userId = requireUserId();
  const u = getUser(userId)!;
  if (u.cloudUserId) {
    backfillUids(userId);
    reprojectUser(userId);
    await persist();
  }
  return { ok: true, xp: getUser(userId)!.xp, points: getUser(userId)!.points };
}

/** 自测用：对比增量维护值与 projectState 重算值 */
export const __syncDev = {
  async projectionDiff() {
    await ensureLoaded();
    const userId = requireUserId();
    const u = getUser(userId)!;
    const before = { xp: u.xp, points: u.points, proficiency: { ...getProficiency(userId) } };
    const s = projectState(
      doc.logs.filter((l) => l.userId === userId),
      doc.redemptions.filter((r) => r.userId === userId),
      doc.upkeepDays.filter((d) => d.userId === userId && !d.deletedAt),
      doc.skillNodes.filter((n) => n.userId === userId),
      doc.achievements.filter((a) => a.userId === userId),
    );
    return { incremental: before, projected: { xp: s.xp, points: s.points, proficiency: s.proficiency } };
  },
  async outbox() {
    await ensureLoaded();
    const cid = activeCloudUserId();
    return { cloudUserId: cid, entries: cid ? outboxEntries(cid) : [] };
  },
  async whoami() {
    await ensureLoaded();
    const id = activeLocalUserId();
    return id == null ? null : { localId: id, cloudUserId: cloudUserIdOf(id), points: getUser(id)!.points, xp: getUser(id)!.xp };
  },
};

if (typeof window !== "undefined") {
  (window as any).__syncDev = __syncDev;
}
