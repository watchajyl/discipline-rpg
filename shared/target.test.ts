import { describe, expect, it } from "vitest";
import { normalizeTaskTarget, ruleTargetFor, urgencyMultiplier } from "./gameRules";

describe("V3 flexible task targets", () => {
  it("keeps legacy timer tasks as daily block targets", () => {
    const t = normalizeTaskTarget({ mode: "timer", dailyTargetBlocks: 3 });
    expect(t).toEqual({ repeat: "daily", metric: "blocks", amount: 3, unitName: "块" });
  });

  it("keeps legacy habit tasks as periodic check-ins", () => {
    const t = normalizeTaskTarget({ mode: "habit", period: "weekly", targetPerPeriod: 2 });
    expect(t.repeat).toBe("weekly");
    expect(t.metric).toBe("checkin");
    expect(t.amount).toBe(2);
  });

  it("keeps legacy count tasks as one-shot totals", () => {
    const t = normalizeTaskTarget({ mode: "count", targetCount: 50, unitName: "个单词" });
    expect(t).toEqual({ repeat: "none", metric: "count", amount: 50, unitName: "个单词" });
  });

  it("honors explicit V3 fields over legacy fields", () => {
    const t = normalizeTaskTarget({
      mode: "habit",
      period: "daily",
      targetPerPeriod: 1,
      repeat: "weekly",
      targetMetric: "blocks",
      targetAmount: 4,
    });
    expect(t.repeat).toBe("weekly");
    expect(t.metric).toBe("blocks");
    expect(t.amount).toBe(4);
  });

  it("provides rule defaults for every shape", () => {
    expect(ruleTargetFor("academic", "timer")).toMatchObject({ repeat: "daily", metric: "blocks" });
    expect(ruleTargetFor("language", "habit")).toMatchObject({ repeat: "daily", metric: "checkin" });
    expect(ruleTargetFor("academic", "count")).toMatchObject({ repeat: "none", metric: "count" });
    expect(ruleTargetFor("social", "milestone")).toMatchObject({ repeat: "none", metric: "checkin" });
  });

  it("gives urgency bonus near deadline and none when overdue", () => {
    expect(urgencyMultiplier(undefined, 2, "2026-09-02")).toBe(1);
    expect(urgencyMultiplier("2026-09-05", 4, "2026-09-02")).toBe(1.3);
    expect(urgencyMultiplier("2026-09-07", 2, "2026-09-02")).toBe(1.15);
    expect(urgencyMultiplier("2026-09-01", 4, "2026-09-02")).toBe(1);
  });
});
