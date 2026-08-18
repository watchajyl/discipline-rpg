import { z } from "zod";

// ============================================================
// 纯客户端数据模型（原 Drizzle/SQLite 表结构 → TypeScript 类型）
// 字段与旧后端完全一致，导出的备份 JSON 保持兼容。
// ============================================================

export type User = {
  id: number;
  username: string;
  password: string;           // PBKDF2: pbkdf2$210000$salt$hash
  displayName: string;
  securityQuestion: string;
  securityAnswer: string;     // PBKDF2 hash
  xp: number;
  points: number;
  theme: string;
  aiBaseUrl: string;
  aiApiKey: string;           // AES-256-GCM 加密后的密文
  aiModel: string;
  createdAt: number;
};

export type Session = {
  token: string;
  userId: number;
  expiresAt: number;
  createdAt: number;
};

export type Task = {
  id: number;
  userId: number;
  title: string;
  category: string;
  mode: string;
  difficulty: number;
  xpPerUnit: number;
  pointsPerUnit: number;
  profPerUnit: number;
  notes: string;
  startDate: string;
  endDate: string;
  archived: number;
  blockMinutes: number;
  dailyTargetBlocks: number;
  milestones: string;         // JSON [{id,title,weight,done}]
  finishBonusGranted: number;
  period: string;
  targetPerPeriod: number;
  streak: number;
  bestStreak: number;
  lastPeriodKey: string;
  unitName: string;
  targetCount: number;
  currentCount: number;
  createdAt: number;
};

export type Log = {
  id: number;
  userId: number;
  taskId: number;
  taskTitle: string;
  category: string;
  mode: string;
  kind: string;               // block | manual | milestone | milestone_undo | checkin | makeup | count | finish
  day: string;                // YYYY-MM-DD
  xp: number;
  points: number;
  prof: number;
  minutes: number;
  ratio: number;
  note: string;
  createdAt: number;
};

export type ProficiencyRow = { id: number; userId: number; category: string; value: number };
export type UnlockedAchievementRow = { id: number; userId: number; achievementId: string; unlockedAt: number };
export type SkillNodeRow = { id: number; userId: number; nodeId: string; unlockedAt: number };

export type Reward = {
  id: number;
  userId: number;
  name: string;
  description: string;
  cost: number;
  emoji: string;
  stock: number;              // -1 = 无限
  tag: string;
  createdAt: number;
};

export type Redemption = {
  id: number;
  userId: number;
  rewardId: number;
  name: string;
  emoji: string;
  cost: number;
  createdAt: number;
};

export type Timer = {
  id: number;
  userId: number;
  taskId: number;
  startedAt: number;          // 本次运行开始时间戳；暂停时为 0
  accumulatedMs: number;
  running: number;
  updatedAt: number;
};

// ---------------- Zod ----------------
export const milestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  weight: z.number(),
  done: z.boolean(),
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const registerSchema = z.object({
  username: z.string().min(2, "用户名至少 2 个字符").max(24),
  password: z.string().min(6, "密码至少 6 位"),
  displayName: z.string().max(24).optional(),
  securityQuestion: z.string().min(2, "请填写安全问题"),
  securityAnswer: z.string().min(1, "请填写答案"),
});

export const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

export const resetSchema = z.object({
  username: z.string().min(1),
  answer: z.string().min(1),
  newPassword: z.string().min(6, "新密码至少 6 位"),
});

export const insertTaskSchema = z.object({
  title: z.string().min(1, "请填写任务标题").max(60),
  category: z.enum(["academic", "language", "life", "social", "finance"]),
  mode: z.enum(["timer", "milestone", "habit", "count"]),
  difficulty: z.number().int().min(1).max(4).default(2),
  xpPerUnit: z.number().int().min(0).max(100000).default(20),
  pointsPerUnit: z.number().int().min(0).max(100000).default(15),
  profPerUnit: z.number().int().min(0).max(100000).default(15),
  notes: z.string().max(1000).default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  blockMinutes: z.number().int().min(1).max(600).default(25),
  dailyTargetBlocks: z.number().int().min(1).max(48).default(2),
  milestones: z.array(milestoneSchema).default([]),
  period: z.enum(["daily", "weekly"]).default("daily"),
  targetPerPeriod: z.number().int().min(1).max(100).default(1),
  unitName: z.string().max(20).default("次"),
  targetCount: z.number().int().min(1).max(1000000).default(10),
});
export type InsertTask = z.infer<typeof insertTaskSchema>;

export const insertRewardSchema = z.object({
  name: z.string().min(1, "请填写奖励名称").max(40),
  description: z.string().max(200).default(""),
  cost: z.number().int().min(1).max(1000000),
  emoji: z.string().max(8).default("🎁"),
  stock: z.number().int().min(-1).max(9999).default(-1),
  tag: z.string().max(12).default("休闲"),
});
export type InsertReward = z.infer<typeof insertRewardSchema>;


// 前端使用的任务视图（milestones 已解析）
export type TaskView = Omit<Task, "milestones"> & { milestones: Milestone[] };

export type ProfileResponse = {
  user: {
    id: number;
    username: string;
    displayName: string;
    xp: number;
    points: number;
    theme: string;
    aiConfigured: boolean;
    aiBaseUrl: string;
    aiModel: string;
    aiKeyMasked: string;
    hasKey?: boolean;
  };
  level: number;
  levelTitle: string;
  xpInLevel: number;
  xpForLevel: number;
  ratio: number;
  proficiency: Record<string, number>;
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
};

export type SettleResponse = {
  gained: { xp: number; points: number; prof: number; minutes: number };
  streak?: number;
  streakMul?: number;
  finishBonus?: { xp: number; points: number; prof: number } | null;
  levelUp?: { from: number; to: number; title: string } | null;
  newAchievements: string[];
  message?: string;
};
