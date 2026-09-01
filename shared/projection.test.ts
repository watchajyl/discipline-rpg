// 数值投影单元测试（SPEC-V2 1.4）
// 重点：确定性 + 「两台设备各结算一次，合并后等于两笔之和」
import { describe, expect, it } from "vitest";
import { projectState, type ProjectionLog } from "./projection";
import { RARITY_META, ACHIEVEMENTS } from "./achievements";
import { SKILL_NODES, levelFromXp } from "./gameRules";

const T0 = Date.parse("2026-08-01T00:00:00.000Z");

function log(over: Partial<ProjectionLog> = {}): ProjectionLog {
  return {
    uid: over.uid ?? `u${Math.random()}`,
    category: "academic",
    xp: 40,
    points: 25,
    prof: 30,
    createdAt: T0,
    ...over,
  };
}

describe("projectState 基础", () => {
  it("空事件流得到全零", () => {
    const s = projectState([], [], [], [], []);
    expect(s).toMatchObject({ xp: 0, points: 0, level: levelFromXp(0) });
    expect(s.proficiency.academic).toBe(0);
  });

  it("单笔计时结算 = 回归基准 +40 XP / +25 分 / +30 熟练度", () => {
    const s = projectState([log({ uid: "a" })], [], [], [], []);
    expect(s.xp).toBe(40);
    expect(s.points).toBe(25);
    expect(s.proficiency.academic).toBe(30);
  });

  it("与输入顺序无关（确定性）", () => {
    const logs = [
      log({ uid: "a", createdAt: T0 + 3000, xp: 12, points: 10, prof: 8 }),
      log({ uid: "b", createdAt: T0 + 1000, xp: 33, points: 25, prof: 20 }),
      log({ uid: "c", createdAt: T0 + 2000, xp: 25, points: 20, prof: 15 }),
    ];
    const a = projectState(logs, [], [], [], []);
    const b = projectState([...logs].reverse(), [], [], [], []);
    expect(a).toEqual(b);
    expect(a.xp).toBe(70);
    expect(a.points).toBe(55);
  });

  it("扣减不会让余额变负（逐步 0 截断）", () => {
    const s = projectState([log({ uid: "a", points: 25 })], [{ uid: "r", cost: 999, createdAt: T0 + 1000 }], [], [], []);
    expect(s.points).toBe(0);
  });
});

describe("两设备合并 = 两笔之和（SPEC-V2 1.4 关键项）", () => {
  const deviceA = [log({ uid: "A-1", createdAt: T0 + 1000, xp: 40, points: 25, prof: 30 })];
  const deviceB = [log({ uid: "B-1", createdAt: T0 + 2000, xp: 25, points: 20, prof: 15, category: "health" })];

  it("各自本地值", () => {
    expect(projectState(deviceA, [], [], [], []).points).toBe(25);
    expect(projectState(deviceB, [], [], [], []).points).toBe(20);
  });

  it("合并后 xp / points / 熟练度都等于两笔之和", () => {
    const merged = projectState([...deviceA, ...deviceB], [], [], [], []);
    expect(merged.xp).toBe(40 + 25);
    expect(merged.points).toBe(25 + 20);
    expect(merged.proficiency.academic).toBe(30);
    expect(merged.proficiency.health).toBe(15);
  });

  it("同一批日志重复合并（主键相同）也只算一次 —— 由调用方按 uid 去重后传入", () => {
    const dedup = new Map([...deviceA, ...deviceB, ...deviceA].map((l) => [l.uid!, l]));
    const merged = projectState([...dedup.values()], [], [], [], []);
    expect(merged.points).toBe(45);
  });
});

describe("points 公式各项", () => {
  it("成就奖励按稀有度计入", () => {
    const ach = ACHIEVEMENTS[0];
    const reward = RARITY_META[ach.rarity].reward;
    const s = projectState([], [], [], [], [{ achievementId: ach.id, unlockedAt: T0 + 5000 }]);
    expect(s.points).toBe(reward);
  });

  it("成长树解锁扣除节点成本", () => {
    const node = SKILL_NODES[0];
    const s = projectState(
      [log({ uid: "a", points: node.cost + 100 })],
      [],
      [],
      [{ nodeId: node.id, unlockedAt: T0 + 1000 }],
      [],
    );
    expect(s.points).toBe(100);
  });

  it("维持费扣除 + 全维达成奖励与连续台阶奖励计入", () => {
    const s = projectState(
      [log({ uid: "a", points: 500 })],
      [],
      [{ day: "2026-08-02", totalCharged: 60, bonusGranted: 30, streakBonus: 10, settledAt: T0 + 90_000 }],
      [],
      [],
    );
    expect(s.points).toBe(500 - 60 + 30 + 10);
  });

  it("完整公式：Σ结算 + Σ成就 + Σ全维奖励 − Σ兑换 − Σ维持费 − Σ解锁", () => {
    const ach = ACHIEVEMENTS[0];
    const achReward = RARITY_META[ach.rarity].reward;
    const node = SKILL_NODES[0];
    const s = projectState(
      [log({ uid: "a", points: 3000, xp: 3000, prof: 100 })],
      [{ uid: "r1", cost: 200, createdAt: T0 + 40_000 }],
      [{ day: "2026-08-02", totalCharged: 60, bonusGranted: 30, streakBonus: 0, settledAt: T0 + 20_000 }],
      [{ nodeId: node.id, unlockedAt: T0 + 30_000 }],
      [{ achievementId: ach.id, unlockedAt: T0 + 10_000 }],
    );
    expect(s.points).toBe(3000 + achReward + 30 - 200 - 60 - node.cost);
    expect(s.xp).toBe(3000);
    expect(s.level).toBe(levelFromXp(3000));
  });
});

describe("维持机制回归基准（不改动任何数值）", () => {
  it("比例计费与封顶后的净支出直接来自 upkeep_days 行，投影只做加减", () => {
    const days = [
      { day: "2026-08-01", totalCharged: 40, bonusGranted: 0, streakBonus: 0, settledAt: T0 + 1000 },
      { day: "2026-08-02", totalCharged: 80, bonusGranted: 0, streakBonus: 0, settledAt: T0 + 2000 },
      { day: "2026-08-03", totalCharged: 160, bonusGranted: 30, streakBonus: 20, settledAt: T0 + 3000 },
    ];
    const s = projectState([log({ uid: "a", points: 1000 })], [], days, [], []);
    expect(s.points).toBe(1000 - 40 - 80 - 160 + 30 + 20);
  });

  it("同一天重复出现（合并去重前）不应重复扣费 —— 由调用方按 (user, day) 去重", () => {
    const d = { day: "2026-08-01", totalCharged: 40, bonusGranted: 0, streakBonus: 0, settledAt: T0 + 1000 };
    const dedup = [...new Map([d, { ...d }].map((x) => [x.day, x])).values()];
    const s = projectState([log({ uid: "a", points: 1000 })], [], dedup, [], []);
    expect(s.points).toBe(960);
  });
});
