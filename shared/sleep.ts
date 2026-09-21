// ============================================================
// V0.2 睡眠结算（纯函数，无 UI 依赖）
// 温和鼓励：达标加分、轻微偏差不加不扣、严重不足小扣分，积分永不为负。
// ============================================================

export function timeToMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return Number.NaN;
  return h * 60 + min;
}

/** 入睡到起床的分钟数；跨零点自动加 24 小时 */
export function sleepDurationMinutes(sleepTime: string, wakeTime: string): number {
  const s = timeToMinutes(sleepTime);
  const w = timeToMinutes(wakeTime);
  if (Number.isNaN(s) || Number.isNaN(w)) return 0;
  const raw = w - s;
  return raw <= 0 ? raw + 1440 : raw;
}

export type SleepScore = {
  xp: number;
  points: number;
  prof: number;
  minutes: number;
  reason: string;
};

/** V0.3.1：超过当日建议专注时长后，新增时间块 / 番茄钟的产出倍率 */
export const OVERWORK_MULT = 0.2;

/** 按前一晚睡眠分钟数推算次日建议专注上限（分钟），上限 8 小时、下限 2 小时 */
export function recommendedWorkMinutes(sleepMinutes: number): number {
  if (sleepMinutes <= 0) return 480;
  const raw = Math.round((sleepMinutes / 480) * 480);
  return Math.max(120, Math.min(480, raw));
}

export function workLimitReason(sleepMinutes: number, todayMinutes: number, cap: number): string {
  if (sleepMinutes <= 0) {
    return "昨晚没有睡眠记录，按 8 小时睡眠的健康基准，今日建议专注上限为 8 小时。";
  }
  const hours = (sleepMinutes / 60).toFixed(1);
  const over = todayMinutes > cap;
  const base = `昨晚睡眠 ${hours} 小时，今日建议专注上限 ${cap} 分钟（${(cap / 60).toFixed(1)} 小时）`;
  if (over) {
    return `${base}。你已专注 ${todayMinutes} 分钟，超过建议值，强烈建议停止工作学习休息；之后新增时间块与番茄钟产出降为 20%。`;
  }
  return `${base}。当前已专注 ${todayMinutes} 分钟，${cap - todayMinutes > 0 ? `还可投入 ${cap - todayMinutes} 分钟` : "建议收尾休息"}。`;
}

export function sleepScore(opts: {
  sleepTime: string;
  wakeTime: string;
  idealBedtime: string;
  idealSleepHours: number;
}): SleepScore {
  const minutes = sleepDurationMinutes(opts.sleepTime, opts.wakeTime);
  if (minutes <= 0) {
    return { xp: 0, points: 0, prof: 0, minutes: 0, reason: "时间格式不正确，无法结算。" };
  }
  const idealMin = Math.max(240, Math.min(720, Math.round((opts.idealSleepHours || 7.5) * 60)));
  const diff = Math.abs(minutes - idealMin);

  let xp = 0;
  let points = 0;
  let prof = 0;
  let level = "";
  if (diff <= 30) {
    xp = 12;
    points = 10;
    prof = 8;
    level = "睡眠优秀";
  } else if (diff <= 60) {
    xp = 6;
    points = 5;
    prof = 4;
    level = "睡眠达标";
  } else if (diff <= 120) {
    level = "轻微偏差";
  } else {
    xp = -6;
    points = -5;
    level = "睡眠不足";
  }

  const idealBed = timeToMinutes(opts.idealBedtime);
  const sleepMin = timeToMinutes(opts.sleepTime);
  if (!Number.isNaN(idealBed) && !Number.isNaN(sleepMin)) {
    let late = sleepMin - idealBed;
    // 凌晨入睡时 sleepMin 会小于晚上理想时间，按“次日凌晨”折算
    if (late < -360) late += 1440;
    if (late <= 30) {
      xp += 2;
      points += 3;
      level = level || "按时入睡";
    } else if (late > 90) {
      xp -= 2;
      points -= 3;
      level = level ? `${level}·入睡偏晚` : "入睡偏晚";
    }
  }

  const hours = minutes / 60;
  return {
    xp,
    points,
    prof,
    minutes,
    reason: `${level}：睡了 ${hours.toFixed(1)} 小时（理想 ${(idealMin / 60).toFixed(1)} 小时），${
      points > 0 ? `+${points} 分` : points < 0 ? `${points} 分` : "积分无变化"
    }。`,
  };
}
