// ============================================================
// 自律成长系统 —— 全部可调数值集中于此
// ============================================================

export type CategoryKey = "academic" | "language" | "life" | "social" | "finance";
export type SettlementMode = "timer" | "milestone" | "habit" | "count";

export const CATEGORIES: {
  key: CategoryKey;
  name: string;
  icon: string;
  colorVar: string;
  hsl: string;
}[] = [
  { key: "academic", name: "学术", icon: "GraduationCap", colorVar: "--cat-academic", hsl: "232 70% 62%" },
  { key: "language", name: "外语技能", icon: "Languages", colorVar: "--cat-language", hsl: "172 62% 48%" },
  { key: "life", name: "生活", icon: "Sprout", colorVar: "--cat-life", hsl: "28 84% 58%" },
  { key: "social", name: "社交", icon: "Users", colorVar: "--cat-social", hsl: "340 72% 60%" },
  { key: "finance", name: "金钱", icon: "Coins", colorVar: "--cat-finance", hsl: "44 88% 56%" },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function categoryName(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.name ?? key;
}

export function categoryColor(key: string): string {
  return `hsl(var(${CATEGORIES.find((c) => c.key === key)?.colorVar ?? "--primary"}))`;
}

export const MODES: { key: SettlementMode; name: string; desc: string; icon: string }[] = [
  { key: "timer", name: "计时结算", desc: "按专注时长，每满一个专注块结算一份奖励", icon: "Timer" },
  { key: "milestone", name: "里程碑", desc: "拆成若干节点，按权重打勾结算", icon: "ListChecks" },
  { key: "habit", name: "周期打卡", desc: "每日／每周打卡，连续加成", icon: "CalendarCheck" },
  { key: "count", name: "数量计件", desc: "按完成数量线性折算奖励", icon: "Hash" },
];

export function modeName(key: string): string {
  return MODES.find((m) => m.key === key)?.name ?? key;
}

// ---------- 难度系数 ----------
export const DIFFICULTIES: { value: number; name: string; mul: number }[] = [
  { value: 1, name: "轻松", mul: 0.8 },
  { value: 2, name: "普通", mul: 1.0 },
  { value: 3, name: "进阶", mul: 1.3 },
  { value: 4, name: "硬核", mul: 1.6 },
];

export function difficultyMul(d: number): number {
  return DIFFICULTIES.find((x) => x.value === d)?.mul ?? 1.0;
}

export function difficultyName(d: number): string {
  return DIFFICULTIES.find((x) => x.value === d)?.name ?? "普通";
}

// ---------- streak 加成 ----------
export const STREAK_TIERS: { periods: number; mul: number }[] = [
  { periods: 30, mul: 1.6 },
  { periods: 14, mul: 1.4 },
  { periods: 7, mul: 1.25 },
  { periods: 3, mul: 1.1 },
];

/** streak 加成；capBoost=true 时上限提升至 1.8（成长树「稳态习惯」） */
export function streakMultiplier(streak: number, capBoost = false): number {
  let mul = 1;
  for (const t of STREAK_TIERS) {
    if (streak >= t.periods) {
      mul = t.mul;
      break;
    }
  }
  if (capBoost && streak >= 30) mul = 1.8;
  return mul;
}

// ---------- 收官奖励 ----------
export const FINISH_BONUS_RATE = 0.2;
export const FINISH_BONUS_RATE_BOOSTED = 0.35;

// ---------- 等级曲线 ----------
export function totalXpFor(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.5)) + 50 * (level - 1);
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < 200 && totalXpFor(level + 1) <= xp) level++;
  return level;
}

export const LEVEL_TITLES: { min: number; title: string }[] = [
  { min: 50, title: "立言者" },
  { min: 45, title: "化境" },
  { min: 40, title: "大宗师" },
  { min: 35, title: "宗师" },
  { min: 30, title: "卓越者" },
  { min: 25, title: "通达者" },
  { min: 20, title: "笃行者" },
  { min: 15, title: "精进者" },
  { min: 10, title: "践行者" },
  { min: 5, title: "见习者" },
  { min: 1, title: "初心者" },
];

export function levelTitle(level: number): string {
  return LEVEL_TITLES.find((t) => level >= t.min)?.title ?? "初心者";
}

export function levelProgress(xp: number) {
  const level = levelFromXp(xp);
  const cur = totalXpFor(level);
  const next = totalXpFor(level + 1);
  return {
    level,
    title: levelTitle(level),
    xpInLevel: xp - cur,
    xpForLevel: next - cur,
    nextLevelTotal: next,
    ratio: next > cur ? Math.min(1, (xp - cur) / (next - cur)) : 1,
  };
}

// ---------- 熟练度等阶 ----------
export const PROFICIENCY_TIERS = [0, 150, 450, 1000, 2000, 3800, 6500, 10000];
export const PROFICIENCY_TIER_NAMES = ["新手", "入门", "熟练", "精通", "专家", "大师", "权威", "泰斗"];

export function proficiencyTier(value: number) {
  let idx = 0;
  for (let i = 0; i < PROFICIENCY_TIERS.length; i++) {
    if (value >= PROFICIENCY_TIERS[i]) idx = i;
  }
  const floor = PROFICIENCY_TIERS[idx];
  const ceil = idx + 1 < PROFICIENCY_TIERS.length ? PROFICIENCY_TIERS[idx + 1] : null;
  return {
    index: idx,
    name: PROFICIENCY_TIER_NAMES[idx],
    floor,
    ceil,
    ratio: ceil === null ? 1 : Math.min(1, (value - floor) / (ceil - floor)),
    toNext: ceil === null ? 0 : ceil - value,
  };
}

// ---------- 成长树 ----------
export type SkillEffect =
  | "timerXp"      // 该类别 timer 任务经验 +10%
  | "pointsBoost"  // 该类别积分产出 +15%
  | "streakCap"    // streak 加成上限提升至 ×1.8
  | "profBoost"    // 该类别熟练度产出 +12%
  | "crossover"    // 当日若有其他类别产出，本类别经验 +8%
  | "summit";      // 该类别收官奖励 20% → 35%

export const SKILL_NODE_TEMPLATES: {
  slot: number;
  name: string;
  effect: SkillEffect;
  desc: string;
  profRequired: number;
  cost: number;
}[] = [
  { slot: 1, name: "专注延展", effect: "timerXp", desc: "该类别计时任务经验 +10%", profRequired: 150, cost: 200 },
  { slot: 2, name: "复利记账", effect: "pointsBoost", desc: "该类别积分产出 +15%", profRequired: 450, cost: 400 },
  { slot: 3, name: "稳态习惯", effect: "streakCap", desc: "该类别 streak 加成上限提升至 ×1.8", profRequired: 1000, cost: 700 },
  { slot: 4, name: "深度钻研", effect: "profBoost", desc: "该类别熟练度产出 +12%", profRequired: 2000, cost: 1200 },
  { slot: 5, name: "跨界联动", effect: "crossover", desc: "当日若有其他类别产出，本类别经验 +8%", profRequired: 3800, cost: 2000 },
  { slot: 6, name: "登峰", effect: "summit", desc: "该类别全部收官奖励由 20% 提升至 35%", profRequired: 6500, cost: 3200 },
];

export type SkillNode = {
  id: string;
  category: CategoryKey;
  slot: number;
  name: string;
  effect: SkillEffect;
  desc: string;
  profRequired: number;
  cost: number;
};

export const SKILL_NODES: SkillNode[] = CATEGORIES.flatMap((c) =>
  SKILL_NODE_TEMPLATES.map((t) => ({
    id: `${c.key}_${t.slot}`,
    category: c.key,
    slot: t.slot,
    name: t.name,
    effect: t.effect,
    desc: t.desc,
    profRequired: t.profRequired,
    cost: t.cost,
  })),
);

export function nodesForCategory(cat: CategoryKey): SkillNode[] {
  return SKILL_NODES.filter((n) => n.category === cat).sort((a, b) => a.slot - b.slot);
}

export type UnlockedEffects = {
  timerXp: boolean;
  pointsBoost: boolean;
  streakCap: boolean;
  profBoost: boolean;
  crossover: boolean;
  summit: boolean;
};

export function effectsFor(unlockedNodeIds: string[], cat: string): UnlockedEffects {
  const set = new Set(unlockedNodeIds);
  const has = (effect: SkillEffect) =>
    SKILL_NODES.some((n) => n.category === cat && n.effect === effect && set.has(n.id));
  return {
    timerXp: has("timerXp"),
    pointsBoost: has("pointsBoost"),
    streakCap: has("streakCap"),
    profBoost: has("profBoost"),
    crossover: has("crossover"),
    summit: has("summit"),
  };
}

// ---------- 单次结算计算 ----------
export type SettleInput = {
  xpPerUnit: number;
  pointsPerUnit: number;
  profPerUnit: number;
  difficulty: number;
  ratio: number;          // 完成比例 / 份数
  mode: SettlementMode;
  streak?: number;        // habit 模式
  effects?: UnlockedEffects;
  crossCategoryToday?: boolean;
};

export type SettleResult = { xp: number; points: number; prof: number; streakMul: number };

export function computeSettlement(input: SettleInput): SettleResult {
  const eff = input.effects;
  const diff = difficultyMul(input.difficulty);
  const streakMul =
    input.mode === "habit" ? streakMultiplier(input.streak ?? 0, !!eff?.streakCap) : 1;

  let xpMul = 1;
  if (eff?.timerXp && input.mode === "timer") xpMul *= 1.1;
  if (eff?.crossover && input.crossCategoryToday) xpMul *= 1.08;
  const ptsMul = eff?.pointsBoost ? 1.15 : 1;
  const profMul = eff?.profBoost ? 1.12 : 1;

  return {
    xp: Math.round(input.xpPerUnit * diff * streakMul * input.ratio * xpMul),
    points: Math.round(input.pointsPerUnit * diff * streakMul * input.ratio * ptsMul),
    prof: Math.round(input.profPerUnit * diff * input.ratio * profMul),
    streakMul,
  };
}

// ---------- 内置规则引擎（无 API Key 时的建议） ----------
export const RULE_DEFAULTS: Record<string, { blockMinutes?: number; dailyTargetBlocks?: number; period?: "daily" | "weekly"; targetPerPeriod?: number; targetCount?: number; unitName?: string; xpPerUnit: number; pointsPerUnit: number; profPerUnit: number }> = {
  academic_timer: { blockMinutes: 50, dailyTargetBlocks: 3, xpPerUnit: 40, pointsPerUnit: 25, profPerUnit: 30 },
  language_timer: { blockMinutes: 25, dailyTargetBlocks: 2, xpPerUnit: 20, pointsPerUnit: 15, profPerUnit: 18 },
  life_timer: { blockMinutes: 25, dailyTargetBlocks: 1, xpPerUnit: 15, pointsPerUnit: 12, profPerUnit: 12 },
  social_timer: { blockMinutes: 30, dailyTargetBlocks: 1, xpPerUnit: 25, pointsPerUnit: 20, profPerUnit: 18 },
  finance_timer: { blockMinutes: 25, dailyTargetBlocks: 1, xpPerUnit: 22, pointsPerUnit: 20, profPerUnit: 16 },

  academic_habit: { period: "daily", targetPerPeriod: 1, xpPerUnit: 35, pointsPerUnit: 22, profPerUnit: 26 },
  language_habit: { period: "daily", targetPerPeriod: 1, xpPerUnit: 18, pointsPerUnit: 14, profPerUnit: 16 },
  life_habit: { period: "daily", targetPerPeriod: 1, xpPerUnit: 15, pointsPerUnit: 12, profPerUnit: 10 },
  social_habit: { period: "weekly", targetPerPeriod: 2, xpPerUnit: 28, pointsPerUnit: 22, profPerUnit: 20 },
  finance_habit: { period: "weekly", targetPerPeriod: 1, xpPerUnit: 25, pointsPerUnit: 20, profPerUnit: 18 },

  academic_count: { unitName: "篇文献", targetCount: 20, xpPerUnit: 35, pointsPerUnit: 25, profPerUnit: 28 },
  language_count: { unitName: "个单词", targetCount: 50, xpPerUnit: 2, pointsPerUnit: 1, profPerUnit: 2 },
  life_count: { unitName: "次", targetCount: 10, xpPerUnit: 12, pointsPerUnit: 10, profPerUnit: 8 },
  social_count: { unitName: "次交流", targetCount: 5, xpPerUnit: 30, pointsPerUnit: 25, profPerUnit: 20 },
  finance_count: { unitName: "笔记账", targetCount: 30, xpPerUnit: 10, pointsPerUnit: 10, profPerUnit: 8 },

  academic_milestone: { xpPerUnit: 300, pointsPerUnit: 200, profPerUnit: 240 },
  language_milestone: { xpPerUnit: 150, pointsPerUnit: 100, profPerUnit: 120 },
  life_milestone: { xpPerUnit: 100, pointsPerUnit: 80, profPerUnit: 70 },
  social_milestone: { xpPerUnit: 160, pointsPerUnit: 130, profPerUnit: 110 },
  finance_milestone: { xpPerUnit: 180, pointsPerUnit: 150, profPerUnit: 120 },
};

export const MILESTONE_TEMPLATES: Record<CategoryKey, string[]> = {
  academic: ["确定选题与研究问题", "完成文献综述初稿", "整理数据与方法设计", "完成结果分析", "完成全文初稿", "修订并投稿"],
  language: ["制定学习路径", "完成基础词汇打底", "完成一轮语法梳理", "开始输出练习", "模拟测试一次", "达到目标水平"],
  life: ["列出待改善清单", "调整作息计划", "坚持一周", "复盘并微调", "坚持一个月"],
  social: ["列出想联系的人", "主动约一次交流", "完成一次深度对话", "建立定期联络节奏"],
  finance: ["梳理当前收支", "制定预算表", "记账满两周", "建立应急储备", "复盘并优化配置"],
};

export function ruleSuggest(category: string, mode: string) {
  const key = `${category}_${mode}`;
  const base = RULE_DEFAULTS[key] ?? { xpPerUnit: 20, pointsPerUnit: 15, profPerUnit: 15 };
  const milestones =
    mode === "milestone" ? (MILESTONE_TEMPLATES[category as CategoryKey] ?? []).slice(0, 5) : [];
  return {
    ...base,
    difficulty: 2,
    milestones,
    reason: `依据${categoryName(category)}类 + ${modeName(mode)}的内置调校参数给出的稳健起点，建议先跑一周再按实际投入微调。`,
    source: "rule" as const,
  };
}

// ---------- 日期工具 ----------
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function weekKey(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function periodKey(period: "daily" | "weekly", d: Date = new Date()): string {
  return period === "weekly" ? weekKey(d) : dateKey(d);
}

/** 判断 prevKey 是否为 curKey 的紧邻上一期 */
export function isConsecutivePeriod(period: "daily" | "weekly", prevKey: string, curKey: string): boolean {
  if (!prevKey) return false;
  if (period === "daily") {
    const prev = new Date(prevKey + "T00:00:00");
    const cur = new Date(curKey + "T00:00:00");
    return Math.round((cur.getTime() - prev.getTime()) / 86400000) === 1;
  }
  // weekly：用上一周的 weekKey 反推
  const now = new Date();
  for (let i = 0; i < 400; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    if (weekKey(d) === curKey) {
      const prevWeek = weekKey(new Date(d.getTime() - 7 * 86400000));
      return prevWeek === prevKey;
    }
  }
  return false;
}

export const REBOUND_MESSAGE = "从今天重新开始，前面积累的熟练度一分没少。";

export const MOTIVATION = {
  empty: "还没有任务。先立一件小事，今天就能拿到第一份经验。",
  noneToday: "今天还没开始，先来一个专注块？",
  started: (n: number) => `已完成 ${n} 项，保持住。`,
  strong: (n: number) => `今天已经结算 ${n} 次，状态很稳，收尾再补一项？`,
  comeback: (cat: string) => `欢迎回来，你的${cat}熟练度还在等着往上走。`,
};

export const MAKEUP_DAYS = 3; // 补签可回溯天数
export const DEFAULT_BLOCK_MINUTES = 25;
