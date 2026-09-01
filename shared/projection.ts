// ============================================================
// 数值投影（SPEC-V2 1.4）
//
// xp / points / proficiency / level 全部视为「由日志派生的投影」。
// 本文件是一个**纯函数**：给定同一批事件（顺序无关，函数内部会按事件时间
// 稳定排序），任何设备都会算出完全相同的结果。多设备合并后本地重算一次，
// 即可保证最终一致。
//
// 本文件不引入任何新的数值规则，只是把 localdb 里「一边写日志一边加减」
// 的既有逻辑，改写成「按同样顺序重放同一批日志」。因此结算数值与 V1 完全一致，
// shared/gameRules.ts 一行未动。
// ============================================================

import { CATEGORY_KEYS, levelFromXp, SKILL_NODES } from "./gameRules";
import { ACHIEVEMENTS, RARITY_META } from "./achievements";

export type ProjectionLog = {
  /** 稳定主键（uuid），用于去重与排序兜底 */
  uid?: string;
  category: string;
  xp: number;
  points: number;
  prof: number;
  createdAt: number;
};

export type ProjectionRedemption = { uid?: string; cost: number; createdAt: number };
export type ProjectionAchievement = { achievementId: string; unlockedAt: number };
export type ProjectionSkillNode = { nodeId: string; unlockedAt: number };
export type ProjectionUpkeepDay = {
  day: string;
  totalCharged: number;
  bonusGranted: number;
  streakBonus: number;
  settledAt: number;
};

export type ProjectedState = {
  xp: number;
  points: number;
  proficiency: Record<string, number>;
  level: number;
};

type Event = {
  at: number;
  /** 同一毫秒内的稳定次序：日志 → 维持结算 → 成就 → 成长树 → 兑换（与 localdb 增量写入顺序一致） */
  rank: number;
  key: string;
  apply: (s: { xp: number; points: number; prof: Record<string, number> }) => void;
};

const RANK = { log: 0, upkeep: 1, achievement: 2, node: 3, redemption: 4 } as const;

const clamp0 = (n: number) => (n > 0 ? n : 0);

/**
 * 纯函数：由事件流重算 xp / points / proficiency / level。
 *
 * points = Σ 结算积分 + Σ 成就奖励 + Σ 全维达成奖励（含连续台阶）
 *          − Σ 兑换消耗 − Σ 维持费 − Σ 成长树解锁消耗
 *
 * 与 localdb 增量写入逐步等价：每一步都在 0 处截断（余额永不为负）。
 */
export function projectState(
  logs: ProjectionLog[],
  redemptions: ProjectionRedemption[],
  upkeepDays: ProjectionUpkeepDay[],
  unlockedNodes: ProjectionSkillNode[],
  achievements: ProjectionAchievement[],
): ProjectedState {
  const events: Event[] = [];

  for (const l of logs) {
    events.push({
      at: l.createdAt,
      rank: RANK.log,
      key: `log:${l.uid ?? ""}:${l.createdAt}:${l.xp}:${l.points}:${l.prof}`,
      apply: (s) => {
        s.xp = clamp0(s.xp + l.xp);
        s.points = clamp0(s.points + l.points);
        s.prof[l.category] = clamp0((s.prof[l.category] ?? 0) + l.prof);
      },
    });
  }

  for (const a of achievements) {
    const meta = ACHIEVEMENTS.find((x) => x.id === a.achievementId);
    const reward = meta ? RARITY_META[meta.rarity].reward : 0;
    events.push({
      at: a.unlockedAt,
      rank: RANK.achievement,
      key: `ach:${a.achievementId}`,
      apply: (s) => {
        s.points = clamp0(s.points + reward);
      },
    });
  }

  for (const n of unlockedNodes) {
    const node = SKILL_NODES.find((x) => x.id === n.nodeId);
    const cost = node ? node.cost : 0;
    events.push({
      at: n.unlockedAt,
      rank: RANK.node,
      key: `node:${n.nodeId}`,
      apply: (s) => {
        s.points = clamp0(s.points - cost);
      },
    });
  }

  for (const r of redemptions) {
    events.push({
      at: r.createdAt,
      rank: RANK.redemption,
      key: `red:${r.uid ?? ""}:${r.createdAt}:${r.cost}`,
      apply: (s) => {
        s.points = clamp0(s.points - r.cost);
      },
    });
  }

  for (const u of upkeepDays) {
    events.push({
      at: u.settledAt,
      rank: RANK.upkeep,
      key: `upkeep:${u.day}`,
      apply: (s) => {
        s.points = clamp0(s.points - u.totalCharged);
        s.points = s.points + u.bonusGranted + u.streakBonus;
      },
    });
  }

  events.sort((a, b) => a.at - b.at || a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const state = { xp: 0, points: 0, prof: {} as Record<string, number> };
  for (const c of CATEGORY_KEYS) state.prof[c] = 0;
  for (const e of events) e.apply(state);

  return {
    xp: state.xp,
    points: state.points,
    proficiency: state.prof,
    level: levelFromXp(state.xp),
  };
}
