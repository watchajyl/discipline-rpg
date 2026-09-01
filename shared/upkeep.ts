// ============================================================
// 每日维持机制 —— 全部可调参数与纯函数集中于此
// 本文件不修改 V1 任何既有数值；V1 的四种结算模式产出完全不受影响。
//
// 调参入口一览（改这里即可，UI 会自动跟随）：
//   UPKEEP_DEFAULT_CONFIG          推荐默认配置（设置页「恢复推荐默认值」用的就是它）
//   UPKEEP_LIMITS                  各输入框的取值范围
//   UPKEEP_ALL_MET_STREAK_BONUSES  连续全维达成的额外奖励台阶
//   UPKEEP_BACKFILL_MAX_DAYS       单次补算最多回溯多少天
//   UPKEEP_SUMMARY_MIN_DAYS        补算多少天以上才弹汇总卡
// ============================================================

import { CATEGORY_KEYS, dateKey, type CategoryKey } from "./gameRules";

// ---------------- 类型 ----------------
export type UpkeepMode = "daily_required" | "daily_tracked" | "weekly" | "off";

export type UpkeepTargets = {
  /** 当日/当周该类别专注分钟数门槛，0 表示不设该门槛 */
  minutes: number;
  /** 当日/当周该类别结算次数门槛，0 表示不设该门槛 */
  count: number;
  /** 当日/当周该类别熟练度门槛，0 表示不设该门槛 */
  proficiency: number;
};

export type UpkeepCategoryConfig = {
  mode: UpkeepMode;
  baseFee: number;
  targets: UpkeepTargets;
  weeklyTargets: UpkeepTargets;
};

export type UpkeepStreakBonus = { days: number; bonus: number; achievementId: string };

export type UpkeepConfig = {
  /** 总开关，关闭后完全不结算、不扣费 */
  enabled: boolean;
  timezone: string;
  /** 每日维持费总额封顶 */
  dailyCapPoints: number;
  /** 全维达成奖励 */
  allMetBonus: number;
  /** 每周豁免格数量（周一 00:00 重置） */
  weeklyExemptions: number;
  /** 新账号宽限期天数（期间只展示不扣费） */
  graceDays: number;
  /** 连续未达标天数 → 倍数，索引 0 表示第 1 天，超出取最后一项 */
  escalation: number[];
  categories: Record<CategoryKey, UpkeepCategoryConfig>;
};

// ---------------- 默认值（SPEC-V2 2.5 原样） ----------------
export const UPKEEP_DEFAULT_CONFIG: UpkeepConfig = {
  enabled: true,
  timezone: "Asia/Shanghai",
  dailyCapPoints: 60,
  allMetBonus: 25,
  weeklyExemptions: 3,
  graceDays: 7,
  escalation: [0.4, 0.7, 1.0, 1.4, 1.8, 2.2],
  categories: {
    academic: {
      mode: "daily_required",
      baseFee: 14,
      targets: { minutes: 50, count: 0, proficiency: 30 },
      weeklyTargets: { minutes: 0, count: 0, proficiency: 0 },
    },
    language: {
      mode: "daily_required",
      baseFee: 12,
      targets: { minutes: 25, count: 1, proficiency: 18 },
      weeklyTargets: { minutes: 0, count: 0, proficiency: 0 },
    },
    life: {
      mode: "daily_tracked",
      baseFee: 8,
      targets: { minutes: 0, count: 1, proficiency: 10 },
      weeklyTargets: { minutes: 0, count: 0, proficiency: 0 },
    },
    social: {
      mode: "daily_tracked",
      baseFee: 8,
      targets: { minutes: 0, count: 1, proficiency: 8 },
      weeklyTargets: { minutes: 0, count: 0, proficiency: 0 },
    },
    finance: {
      mode: "daily_tracked",
      baseFee: 8,
      targets: { minutes: 0, count: 1, proficiency: 8 },
      weeklyTargets: { minutes: 0, count: 0, proficiency: 0 },
    },
  },
};

/** 连续全维达成额外奖励（SPEC-V2 2.3） */
export const UPKEEP_ALL_MET_STREAK_BONUSES: UpkeepStreakBonus[] = [
  { days: 3, bonus: 50, achievementId: "upkeep_allmet_3" },
  { days: 7, bonus: 150, achievementId: "upkeep_allmet_7" },
  { days: 14, bonus: 400, achievementId: "upkeep_allmet_14" },
  { days: 30, bonus: 1000, achievementId: "upkeep_allmet_30" },
];

/** 「零支出周」需要的连续零净支出天数 */
export const UPKEEP_ZERO_SPEND_DAYS = 7;

/** 单次补算最多回溯天数（防止极端长时间未打开时一次算上千天） */
export const UPKEEP_BACKFILL_MAX_DAYS = 60;

/** 补算天数 ≥ 此值时展示汇总卡 */
export const UPKEEP_SUMMARY_MIN_DAYS = 2;

export const UPKEEP_LIMITS = {
  baseFee: { min: 0, max: 200 },
  target: { min: 0, max: 1000 },
  dailyCapPoints: { min: 0, max: 1000 },
  allMetBonus: { min: 0, max: 500 },
  weeklyExemptions: { min: 0, max: 7 },
  graceDays: { min: 0, max: 60 },
};

export const UPKEEP_MODES: { key: UpkeepMode; name: string; desc: string }[] = [
  { key: "daily_required", name: "每日必做", desc: "每日判定并计费，计入全维达成" },
  { key: "daily_tracked", name: "每日关注", desc: "每日判定并计费（费用较轻），计入全维达成" },
  { key: "weekly", name: "按周结算", desc: "按自然周累计判定，仅周日结算一次维持费" },
  { key: "off", name: "只统计", desc: "只展示进度，不计费，不计入全维达成" },
];

export function upkeepModeName(mode: UpkeepMode): string {
  return UPKEEP_MODES.find((m) => m.key === mode)?.name ?? mode;
}

/** 该 mode 是否参与「全维达成」判定并按日计费 */
export function isDailyBilled(mode: UpkeepMode): boolean {
  return mode === "daily_required" || mode === "daily_tracked";
}

// ---------------- 时钟（含仅开发/自测用的注入点） ----------------
/** 仅用于自动化自测的时间注入点（localStorage 键，生产 UI 中没有任何入口） */
export const UPKEEP_DEV_CLOCK_KEY = "__upkeep_dev_clock_offset_ms";

let clockOffsetMs = (() => {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(UPKEEP_DEV_CLOCK_KEY) : null;
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
})();

/** 仅用于自动化自测的时间注入点，生产 UI 中没有任何入口 */
export function setUpkeepClockOffsetMs(ms: number) {
  clockOffsetMs = Number(ms) || 0;
  try {
    if (typeof localStorage !== "undefined") {
      if (clockOffsetMs) localStorage.setItem(UPKEEP_DEV_CLOCK_KEY, String(clockOffsetMs));
      else localStorage.removeItem(UPKEEP_DEV_CLOCK_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function getUpkeepClockOffsetMs(): number {
  return clockOffsetMs;
}

export function upkeepNowMs(): number {
  return Date.now() + clockOffsetMs;
}

export function upkeepNow(): Date {
  return new Date(upkeepNowMs());
}

/** 维持机制视角的「今天」 */
export function upkeepToday(): string {
  return dateKey(upkeepNow());
}

// ---------------- 日期工具（本地自然日/自然周，周一为周首） ----------------
export function parseDay(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function dayDiff(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86400000);
}

/** 周一为一周第一天：返回 0(周一)–6(周日) */
export function weekdayIndex(day: string): number {
  return (parseDay(day).getDay() + 6) % 7;
}

export function isWeekEnd(day: string): boolean {
  return weekdayIndex(day) === 6;
}

/** 该日所属自然周的周一 */
export function weekStart(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

export function weekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// ---------------- 达标度 ----------------
export type DayMetrics = { minutes: number; count: number; proficiency: number };

export type AttainmentPart = {
  key: "proficiency" | "minutes" | "count";
  label: string;
  unit: string;
  current: number;
  target: number;
  ratio: number;
};

export type Attainment = { ratio: number; parts: AttainmentPart[]; configured: boolean };

const PART_META: { key: AttainmentPart["key"]; label: string; unit: string }[] = [
  { key: "proficiency", label: "熟练度", unit: "" },
  { key: "minutes", label: "时长", unit: "分钟" },
  { key: "count", label: "结算", unit: "次" },
];

/**
 * 达标度 = min(1, max(各已设置门槛的完成比例))；
 * 门槛为 0 / 未设置则跳过；三项全未设置 → 视为 1（不计费）。
 */
export function attainment(targets: UpkeepTargets, metrics: DayMetrics): Attainment {
  const parts: AttainmentPart[] = [];
  for (const meta of PART_META) {
    const target = Math.max(0, Number(targets?.[meta.key] ?? 0));
    if (!target) continue;
    const current = Math.max(0, Number(metrics?.[meta.key] ?? 0));
    parts.push({ ...meta, current, target, ratio: Math.min(1, current / target) });
  }
  if (parts.length === 0) return { ratio: 1, parts: [], configured: false };
  const ratio = Math.min(1, Math.max(...parts.map((p) => p.ratio)));
  return { ratio, parts, configured: true };
}

/** 连续未达标天数 → 递增倍数（missDays 从 1 起算） */
export function escalationMul(escalation: number[], missDays: number): number {
  const table = escalation?.length ? escalation : UPKEEP_DEFAULT_CONFIG.escalation;
  if (missDays <= 0) return 0;
  return table[Math.min(missDays, table.length) - 1];
}

/** 单类别维持费 = round(baseFee × (1 − 达标度) × 连续漏天倍数) */
export function categoryFee(baseFee: number, ratio: number, escalation: number[], missDays: number): number {
  if (ratio >= 1) return 0;
  const fee = Math.round(Math.max(0, baseFee) * (1 - Math.max(0, Math.min(1, ratio))) * escalationMul(escalation, missDays));
  return Math.max(0, fee);
}

/** 总额封顶：按比例缩放各类别费用，保证求和恰好等于封顶值 */
export function applyDailyCap(fees: Record<string, number>, cap: number): { total: number; scaled: Record<string, number> } {
  const keys = Object.keys(fees);
  const raw = keys.reduce((a, k) => a + (fees[k] || 0), 0);
  const limit = Math.max(0, cap);
  if (raw <= limit) return { total: raw, scaled: { ...fees } };
  const scaled: Record<string, number> = {};
  const ordered = keys.slice().sort((a, b) => (fees[b] || 0) - (fees[a] || 0));
  let used = 0;
  for (const k of ordered) {
    const v = Math.min(fees[k] || 0, Math.floor(((fees[k] || 0) / raw) * limit));
    scaled[k] = v;
    used += v;
  }
  // 余额逐分分配给费用最高的类别，且任何类别不超过它自己的原始费用（达标类别永远为 0）
  let rest = Math.max(0, limit - used);
  while (rest > 0) {
    let moved = false;
    for (const k of ordered) {
      if (rest <= 0) break;
      if (scaled[k] < (fees[k] || 0)) {
        scaled[k] += 1;
        rest -= 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { total: limit - rest, scaled };
}

// ---------------- 记录结构（为后续云端同步预留：软删 + updated_at + 只追加） ----------------
export type UpkeepCategoryDay = {
  category: CategoryKey;
  mode: UpkeepMode;
  /** 是否计入计费与全维达成 */
  billable: boolean;
  ratio: number;
  parts: AttainmentPart[];
  /** 未封顶前的应扣 */
  fee: number;
  /** 封顶后应扣 */
  due: number;
  /** 实际扣除（受余额保护） */
  charged: number;
  /** 余额不足未扣的部分，仅展示不累积欠账 */
  waived: number;
  exempted: boolean;
  missStreak: number;
  /** weekly 模式：本周是否为结算日 */
  weeklySettled?: boolean;
};

export type UpkeepDay = {
  userId: number;
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
  capped: boolean;
  settledAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type UpkeepExemption = {
  id: number;
  userId: number;
  day: string;
  category: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type UpkeepConfigRow = {
  userId: number;
  config: UpkeepConfig;
  updatedAt: number;
};

// ---------------- 配置规整 ----------------
function clampInt(v: any, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function normalizeTargets(t: any, fallback: UpkeepTargets): UpkeepTargets {
  return {
    minutes: clampInt(t?.minutes, UPKEEP_LIMITS.target.min, UPKEEP_LIMITS.target.max, fallback.minutes),
    count: clampInt(t?.count, UPKEEP_LIMITS.target.min, UPKEEP_LIMITS.target.max, fallback.count),
    proficiency: clampInt(t?.proficiency, UPKEEP_LIMITS.target.min, UPKEEP_LIMITS.target.max, fallback.proficiency),
  };
}

/** 把任意（含历史/部分）配置对象规整为完整合法的 UpkeepConfig */
export function normalizeUpkeepConfig(input: any): UpkeepConfig {
  const def = UPKEEP_DEFAULT_CONFIG;
  const src = input ?? {};
  const escalation =
    Array.isArray(src.escalation) && src.escalation.length > 0
      ? src.escalation.map((x: any) => Math.max(0, Number(x) || 0))
      : def.escalation.slice();
  const categories = {} as Record<CategoryKey, UpkeepCategoryConfig>;
  for (const key of CATEGORY_KEYS as CategoryKey[]) {
    const d = def.categories[key];
    const c = src.categories?.[key] ?? {};
    const mode: UpkeepMode = UPKEEP_MODES.some((m) => m.key === c.mode) ? c.mode : d.mode;
    categories[key] = {
      mode,
      baseFee: clampInt(c.baseFee, UPKEEP_LIMITS.baseFee.min, UPKEEP_LIMITS.baseFee.max, d.baseFee),
      targets: normalizeTargets(c.targets, d.targets),
      weeklyTargets: normalizeTargets(c.weeklyTargets, d.weeklyTargets),
    };
  }
  return {
    enabled: src.enabled === undefined ? def.enabled : !!src.enabled,
    timezone: typeof src.timezone === "string" && src.timezone.trim() ? src.timezone.trim() : def.timezone,
    dailyCapPoints: clampInt(src.dailyCapPoints, UPKEEP_LIMITS.dailyCapPoints.min, UPKEEP_LIMITS.dailyCapPoints.max, def.dailyCapPoints),
    allMetBonus: clampInt(src.allMetBonus, UPKEEP_LIMITS.allMetBonus.min, UPKEEP_LIMITS.allMetBonus.max, def.allMetBonus),
    weeklyExemptions: clampInt(src.weeklyExemptions, UPKEEP_LIMITS.weeklyExemptions.min, UPKEEP_LIMITS.weeklyExemptions.max, def.weeklyExemptions),
    graceDays: clampInt(src.graceDays, UPKEEP_LIMITS.graceDays.min, UPKEEP_LIMITS.graceDays.max, def.graceDays),
    escalation,
    categories,
  };
}

// ---------------- 模拟器（设置页强度模拟器复用同一套纯函数） ----------------
export type SimulationRow = {
  category: CategoryKey;
  mode: UpkeepMode;
  ratio: number;
  todayFee: number;
  sevenDayFee: number;
};

export type SimulationResult = {
  rows: SimulationRow[];
  todayTotal: number;
  todayCapped: number;
  sevenDayTotal: number;
  allMet: boolean;
  netToday: number;
};

/**
 * 给定假想达标度，算出「今天会扣多少」与「连续漏 7 天累计会扣多少」。
 * 七天累计按倍数表逐日递增（第 1..7 天），每日单独套用总额封顶。
 */
export function simulateUpkeep(config: UpkeepConfig, ratios: Record<string, number>): SimulationResult {
  const cfg = normalizeUpkeepConfig(config);
  const todayFees: Record<string, number> = {};
  const rows: SimulationRow[] = [];
  const perDay: number[] = Array.from({ length: 7 }, () => 0);
  const perDayFees: Record<string, number>[] = Array.from({ length: 7 }, () => ({}));

  for (const key of CATEGORY_KEYS as CategoryKey[]) {
    const c = cfg.categories[key];
    const ratio = Math.max(0, Math.min(1, Number(ratios?.[key] ?? 0)));
    const billable = isDailyBilled(c.mode);
    const todayFee = billable ? categoryFee(c.baseFee, ratio, cfg.escalation, 1) : 0;
    todayFees[key] = todayFee;
    let sevenDayFee = 0;
    for (let d = 1; d <= 7; d++) {
      const f = billable ? categoryFee(c.baseFee, ratio, cfg.escalation, d) : 0;
      sevenDayFee += f;
      perDayFees[d - 1][key] = f;
    }
    rows.push({ category: key, mode: c.mode, ratio, todayFee, sevenDayFee });
  }

  const cappedToday = applyDailyCap(todayFees, cfg.dailyCapPoints);
  let sevenTotal = 0;
  for (let d = 0; d < 7; d++) {
    const capped = applyDailyCap(perDayFees[d], cfg.dailyCapPoints);
    perDay[d] = capped.total;
    sevenTotal += capped.total;
  }

  const billableKeys = (CATEGORY_KEYS as CategoryKey[]).filter((k) => isDailyBilled(cfg.categories[k].mode));
  const allMet = billableKeys.length > 0 && billableKeys.every((k) => (ratios?.[k] ?? 0) >= 1);

  return {
    rows,
    todayTotal: Object.values(todayFees).reduce((a, b) => a + b, 0),
    todayCapped: cappedToday.total,
    sevenDayTotal: sevenTotal,
    allMet,
    netToday: cappedToday.total - (allMet ? cfg.allMetBonus : 0),
  };
}

// ---------------- 文案 ----------------
export const UPKEEP_TEXT = {
  graceBadge: (left: number) => `宽限期 · 仅展示不扣费（剩 ${left} 天）`,
  estimate: "预计，今晚结算",
  allMet: "今日全维达成",
  catchUpTitle: (days: number, points: number) => `补算了 ${days} 天维持费，共 −${points} 分`,
  catchUpComfort: "你的熟练度和等级一分没少。",
  exemptionLeft: (n: number) => `使用豁免（剩 ${n}）`,
  exemptionNone: "本周豁免已用完",
  weeklyHint: "按周结算，周日晚统一判定",
  offHint: "只统计，不计费",
};
