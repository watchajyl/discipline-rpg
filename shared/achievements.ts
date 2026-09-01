import { CATEGORIES, CategoryKey, categoryName } from "./gameRules";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export const RARITY_META: Record<Rarity, { name: string; reward: number; hsl: string }> = {
  common: { name: "普通", reward: 50, hsl: "215 14% 62%" },
  rare: { name: "稀有", reward: 150, hsl: "210 90% 62%" },
  epic: { name: "史诗", reward: 400, hsl: "272 70% 66%" },
  legendary: { name: "传说", reward: 1000, hsl: "40 92% 58%" },
};

export type AchievementTrigger =
  | { type: "proficiency"; category: CategoryKey; threshold: number }
  | { type: "focusHours"; hours: number }
  | { type: "streak"; periods: number }
  | { type: "tasksInOneDay"; count: number }
  | { type: "balancedWeek" }
  | { type: "level"; level: number }
  // ---- V2 每日维持机制新增触发器（追加，不影响既有 36 条） ----
  | { type: "upkeepAllMetStreak"; days: number }
  | { type: "upkeepZeroSpendStreak"; days: number }
  | { type: "upkeepPerfectWeekNoExemption" };

export type Achievement = {
  id: string;
  name: string;
  desc: string;
  icon: string; // lucide icon name
  rarity: Rarity;
  group: "proficiency" | "invest" | "persist" | "growth" | "upkeep";
  trigger: AchievementTrigger;
};

const PROF_TIERS: { threshold: number; tierName: string; rarity: Rarity }[] = [
  { threshold: 450, tierName: "熟练", rarity: "common" },
  { threshold: 1000, tierName: "精通", rarity: "rare" },
  { threshold: 3800, tierName: "大师", rarity: "epic" },
  { threshold: 10000, tierName: "泰斗", rarity: "legendary" },
];

const CATEGORY_ICONS: Record<CategoryKey, string> = {
  academic: "GraduationCap",
  language: "Languages",
  life: "Sprout",
  social: "Users",
  finance: "Coins",
};

// 1. 熟练度类：5 类 × 4 个关键阶位 = 20 条
const proficiencyAchievements: Achievement[] = CATEGORIES.flatMap((c) =>
  PROF_TIERS.map((t) => ({
    id: `prof_${c.key}_${t.threshold}`,
    name: `${c.name}·${t.tierName}`,
    desc: `${c.name}类累计熟练度达到 ${t.threshold}`,
    icon: CATEGORY_ICONS[c.key],
    rarity: t.rarity,
    group: "proficiency" as const,
    trigger: { type: "proficiency" as const, category: c.key, threshold: t.threshold },
  })),
);

// 2. 累计投入类：5 条
const investAchievements: Achievement[] = [
  { hours: 10, name: "初入书房", rarity: "common" as Rarity },
  { hours: 50, name: "案头有灯", rarity: "common" as Rarity },
  { hours: 100, name: "百时功成", rarity: "rare" as Rarity },
  { hours: 300, name: "三百时不辍", rarity: "epic" as Rarity },
  { hours: 1000, name: "千时之径", rarity: "legendary" as Rarity },
].map((x) => ({
  id: `focus_${x.hours}h`,
  name: x.name,
  desc: `累计专注时长达到 ${x.hours} 小时`,
  icon: "Hourglass",
  rarity: x.rarity,
  group: "invest" as const,
  trigger: { type: "focusHours" as const, hours: x.hours },
}));

// 3. 坚持类：6 条
const persistAchievements: Achievement[] = [
  ...[
    { periods: 7, name: "七日不断", rarity: "common" as Rarity },
    { periods: 21, name: "习惯成形", rarity: "rare" as Rarity },
    { periods: 60, name: "六十期长跑", rarity: "epic" as Rarity },
    { periods: 100, name: "百期如一", rarity: "legendary" as Rarity },
  ].map((x) => ({
    id: `streak_${x.periods}`,
    name: x.name,
    desc: `任一任务连续打卡达到 ${x.periods} 期`,
    icon: "Flame",
    rarity: x.rarity,
    group: "persist" as const,
    trigger: { type: "streak" as const, periods: x.periods },
  })),
  {
    id: "day_five_tasks",
    name: "一日五事",
    desc: "单日完成 5 个不同任务的结算",
    icon: "ListChecks",
    rarity: "rare" as Rarity,
    group: "persist" as const,
    trigger: { type: "tasksInOneDay" as const, count: 5 },
  },
  {
    id: "balanced_week",
    name: "五维均衡",
    desc: "同一周内五大类别全部有产出",
    icon: "Radar",
    rarity: "epic" as Rarity,
    group: "persist" as const,
    trigger: { type: "balancedWeek" as const },
  },
];

// 4. 成长类：5 条
const growthAchievements: Achievement[] = [
  { level: 5, name: "见习者", rarity: "common" as Rarity },
  { level: 10, name: "践行者", rarity: "common" as Rarity },
  { level: 20, name: "笃行者", rarity: "rare" as Rarity },
  { level: 30, name: "卓越者", rarity: "epic" as Rarity },
  { level: 50, name: "立言者", rarity: "legendary" as Rarity },
].map((x) => ({
  id: `level_${x.level}`,
  name: `${x.name}之证`,
  desc: `全局等级达到 ${x.level} 级`,
  icon: "Trophy",
  rarity: x.rarity,
  group: "growth" as const,
  trigger: { type: "level" as const, level: x.level },
}));

// 5. 每日维持类（V2 新增，追加在原 36 条之后）：6 条
const upkeepAchievements: Achievement[] = [
  {
    id: "upkeep_allmet_3",
    name: "日拱一卒",
    desc: "连续 3 天全维达成",
    icon: "Footprints",
    rarity: "rare" as Rarity,
    group: "upkeep" as const,
    trigger: { type: "upkeepAllMetStreak" as const, days: 3 },
  },
  {
    id: "upkeep_allmet_7",
    name: "七日圆满",
    desc: "连续 7 天全维达成",
    icon: "CircleCheckBig",
    rarity: "epic" as Rarity,
    group: "upkeep" as const,
    trigger: { type: "upkeepAllMetStreak" as const, days: 7 },
  },
  {
    id: "upkeep_allmet_14",
    name: "半月无缺",
    desc: "连续 14 天全维达成",
    icon: "MoonStar",
    rarity: "epic" as Rarity,
    group: "upkeep" as const,
    trigger: { type: "upkeepAllMetStreak" as const, days: 14 },
  },
  {
    id: "upkeep_allmet_30",
    name: "月度圆满",
    desc: "连续 30 天全维达成",
    icon: "Gem",
    rarity: "legendary" as Rarity,
    group: "upkeep" as const,
    trigger: { type: "upkeepAllMetStreak" as const, days: 30 },
  },
  {
    id: "upkeep_zero_spend_week",
    name: "零支出周",
    desc: "连续 7 天维持费净支出为 0",
    icon: "PiggyBank",
    rarity: "rare" as Rarity,
    group: "upkeep" as const,
    trigger: { type: "upkeepZeroSpendStreak" as const, days: 7 },
  },
  {
    id: "upkeep_no_exemption_week",
    name: "无需豁免",
    desc: "某一整周未使用豁免格且全周全维达成",
    icon: "ShieldCheck",
    rarity: "epic" as Rarity,
    group: "upkeep" as const,
    trigger: { type: "upkeepPerfectWeekNoExemption" as const },
  },
];

export const ACHIEVEMENTS: Achievement[] = [
  ...proficiencyAchievements,
  ...investAchievements,
  ...persistAchievements,
  ...growthAchievements,
  ...upkeepAchievements,
];

/** V1 原始 36 条的数量，回归验证用 */
export const V1_ACHIEVEMENT_COUNT =
  proficiencyAchievements.length + investAchievements.length + persistAchievements.length + growthAchievements.length;

export const ACHIEVEMENT_GROUPS: { key: Achievement["group"]; name: string }[] = [
  { key: "proficiency", name: "熟练度" },
  { key: "invest", name: "累计投入" },
  { key: "persist", name: "坚持" },
  { key: "growth", name: "成长" },
  { key: "upkeep", name: "每日维持" },
];

export type AchievementSnapshot = {
  level: number;
  proficiency: Record<string, number>;
  totalFocusMinutes: number;
  maxStreak: number;
  maxTasksInOneDay: number;
  balancedWeek: boolean;
  // ---- V2 每日维持机制（可选，缺省视为 0/false，不影响既有成就判定） ----
  upkeepBestAllMetStreak?: number;
  upkeepBestZeroSpendStreak?: number;
  upkeepPerfectWeekNoExemption?: boolean;
};

/** 返回成就的当前进度 {current, target}（target 为 1 时表示布尔型） */
export function achievementProgress(a: Achievement, s: AchievementSnapshot): { current: number; target: number; label: string } {
  switch (a.trigger.type) {
    case "proficiency": {
      const cur = s.proficiency[a.trigger.category] ?? 0;
      return { current: Math.min(cur, a.trigger.threshold), target: a.trigger.threshold, label: `${Math.min(cur, a.trigger.threshold)} / ${a.trigger.threshold} 熟练度` };
    }
    case "focusHours": {
      const cur = s.totalFocusMinutes / 60;
      return { current: Math.min(cur, a.trigger.hours), target: a.trigger.hours, label: `${cur.toFixed(1)} / ${a.trigger.hours} 小时` };
    }
    case "streak":
      return { current: Math.min(s.maxStreak, a.trigger.periods), target: a.trigger.periods, label: `${Math.min(s.maxStreak, a.trigger.periods)} / ${a.trigger.periods} 期` };
    case "tasksInOneDay":
      return { current: Math.min(s.maxTasksInOneDay, a.trigger.count), target: a.trigger.count, label: `${Math.min(s.maxTasksInOneDay, a.trigger.count)} / ${a.trigger.count} 个任务` };
    case "balancedWeek":
      return { current: s.balancedWeek ? 1 : 0, target: 1, label: s.balancedWeek ? "已达成" : "本周尚未覆盖五类" };
    case "level":
      return { current: Math.min(s.level, a.trigger.level), target: a.trigger.level, label: `Lv.${Math.min(s.level, a.trigger.level)} / Lv.${a.trigger.level}` };
    case "upkeepAllMetStreak": {
      const cur = Math.min(s.upkeepBestAllMetStreak ?? 0, a.trigger.days);
      return { current: cur, target: a.trigger.days, label: `${cur} / ${a.trigger.days} 天全维达成` };
    }
    case "upkeepZeroSpendStreak": {
      const cur = Math.min(s.upkeepBestZeroSpendStreak ?? 0, a.trigger.days);
      return { current: cur, target: a.trigger.days, label: `${cur} / ${a.trigger.days} 天净支出为 0` };
    }
    case "upkeepPerfectWeekNoExemption":
      return {
        current: s.upkeepPerfectWeekNoExemption ? 1 : 0,
        target: 1,
        label: s.upkeepPerfectWeekNoExemption ? "已达成" : "尚未有全周无豁免的满勤周",
      };
  }
}

export function isAchieved(a: Achievement, s: AchievementSnapshot): boolean {
  const p = achievementProgress(a, s);
  return p.current >= p.target;
}

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

export function achievementCategoryLabel(a: Achievement): string {
  if (a.trigger.type === "proficiency") return categoryName(a.trigger.category);
  return a.group === "upkeep" ? "每日维持" : "全局";
}
