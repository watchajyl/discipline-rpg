import type { Task, Milestone } from "@shared/schema";

export type TaskFull = Omit<Task, "milestones"> & {
  milestones: Milestone[];
  effectiveStreak: number;
  periodCheckins: number;
  todayBlocks: number;
  todayXp: number;
  timer: { running: boolean; elapsedMs: number; startedAt: number; accumulatedMs: number } | null;
};

export type Profile = {
  user: {
    id: number;
    username: string;
    displayName: string;
    xp: number;
    points: number;
    theme: string;
    aiConfigured: boolean;
    hasKey?: boolean;
    aiBaseUrl: string;
    aiModel: string;
    aiKeyMasked: string;
    securityQuestion: string;
  };
  level: number;
  title: string;
  xpInLevel: number;
  xpForLevel: number;
  ratio: number;
  nextLevelTotal: number;
  proficiency: Record<string, number>;
  proficiencyTiers: Record<string, { index: number; name: string; floor: number; ceil: number | null; ratio: number; toNext: number }>;
  unlockedNodes: string[];
  unlockedAchievements: string[];
  today: { xp: number; points: number; minutes: number; settlements: number; categories: string[] };
  snapshot: {
    level: number;
    proficiency: Record<string, number>;
    totalFocusMinutes: number;
    maxStreak: number;
    maxTasksInOneDay: number;
    balancedWeek: boolean;
  };
  inactiveDays: number;
  topProfCategory: string;
  topProfCategoryName: string;
  backup: {
    lastBackupAt: number | null;
    daysSince: number | null;
    settlements: number;
    due: boolean;
  };
};

export type SettleResult = {
  ok: boolean;
  gained: { xp: number; points: number; prof: number; minutes: number };
  streak?: number;
  streakMul?: number;
  finishBonus?: { xp: number; points: number; prof: number } | null;
  levelUp?: { from: number; to: number; title: string } | null;
  newAchievements: string[];
  message?: string;
  blocks?: number;
};

export type StatsData = {
  daily: { day: string; label: string; xp: number; points: number; minutes: number }[];
  weekly: { week: string; label: string; minutes: number; xp: number }[];
  byCategory: { category: string; xp: number; minutes: number; prof: number; tier: string }[];
  heatmap: { day: string; xp: number; count: number }[];
  totals: { xp: number; points: number; minutes: number; settlements: number; activeDays: number };
};

export type Suggestion = {
  blockMinutes?: number;
  dailyTargetBlocks?: number;
  period?: "daily" | "weekly";
  targetPerPeriod?: number;
  targetCount?: number;
  unitName?: string;
  difficulty: number;
  xpPerUnit: number;
  pointsPerUnit: number;
  profPerUnit: number;
  milestones: string[];
  reason: string;
  source: "ai" | "rule";
  notice?: string;
};
