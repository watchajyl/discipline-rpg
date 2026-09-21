import { describe, expect, it } from "vitest";
import { recommendedWorkMinutes, sleepDurationMinutes, sleepScore, timeToMinutes } from "./sleep";

describe("V0.2 sleep scoring", () => {
  it("parses times and handles crossing midnight", () => {
    expect(timeToMinutes("23:30")).toBe(1410);
    expect(sleepDurationMinutes("23:30", "07:30")).toBe(480);
  });

  it("rewards sleep close to the ideal duration", () => {
    const s = sleepScore({
      sleepTime: "23:00",
      wakeTime: "06:30",
      idealBedtime: "23:00",
      idealSleepHours: 7.5,
    });
    expect(s.minutes).toBe(450);
    expect(s.xp).toBeGreaterThan(0);
    expect(s.points).toBeGreaterThan(0);
  });

  it("gently deducts for severely insufficient sleep", () => {
    const s = sleepScore({
      sleepTime: "01:00",
      wakeTime: "06:00",
      idealBedtime: "23:00",
      idealSleepHours: 7.5,
    });
    expect(s.points).toBeLessThan(0);
  });

  it("adds a small bedtime-late deduction", () => {
    const late = sleepScore({
      sleepTime: "01:00",
      wakeTime: "08:30",
      idealBedtime: "23:00",
      idealSleepHours: 7.5,
    });
    const onTime = sleepScore({
      sleepTime: "23:00",
      wakeTime: "06:30",
      idealBedtime: "23:00",
      idealSleepHours: 7.5,
    });
    expect(late.points).toBeLessThan(onTime.points);
  });

  it("returns zero for invalid input", () => {
    const s = sleepScore({
      sleepTime: "abc",
      wakeTime: "07:00",
      idealBedtime: "23:00",
      idealSleepHours: 7.5,
    });
    expect(s).toMatchObject({ xp: 0, points: 0, prof: 0, minutes: 0 });
  });

  it("recommends shorter workdays after short sleep", () => {
    expect(recommendedWorkMinutes(6 * 60)).toBe(360);
    expect(recommendedWorkMinutes(8 * 60)).toBe(480);
    expect(recommendedWorkMinutes(4 * 60)).toBe(240);
    expect(recommendedWorkMinutes(0)).toBe(480);
  });
});
