import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useFeedback } from "./feedback";
import { useToast } from "@/hooks/use-toast";
import { Bar, CategoryChip, ModeChip, Num, catColor } from "./bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Flame } from "lucide-react";
import type { TaskFull, SettleResult } from "@/lib/types";
import {
  DIFFICULTIES,
  dateKey,
  difficultyName,
  streakMultiplier,
  MAKEUP_DAYS,
} from "@shared/gameRules";
import { cn } from "@/lib/utils";

function fmtClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function TaskCard({
  task,
  onEdit,
  compact = false,
}: {
  task: TaskFull;
  onEdit?: (t: TaskFull) => void;
  compact?: boolean;
}) {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { report } = useFeedback();
  const { toast } = useToast();

  const settle = useMutation({
    mutationFn: async (args: { url: string; body?: any }) => {
      const res = await apiRequest("POST", args.url, { ...(args.body ?? {}) });
      return (await res.json()) as SettleResult;
    },
    onSuccess: (data) => {
      report(data, task.title);
      invalidateAll(userId);
    },
    onError: (e: any) => {
      toast({
        title: "无法结算",
        description: String(e?.message ?? e).replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""),
        variant: "destructive",
      });
    },
  });

  const color = catColor(task.category);

  return (
    <div
      className="rounded-xl border border-card-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
      data-testid={`card-task-${task.id}`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-snug break-words" data-testid={`text-task-title-${task.id}`}>
            {task.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <CategoryChip cat={task.category} />
            <ModeChip mode={task.mode} />
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {difficultyName(task.difficulty)} ×{DIFFICULTIES.find((d) => d.value === task.difficulty)?.mul}
            </span>
            {task.archived === 1 && (
              <Badge variant="secondary" className="text-[11px]">
                已归档
              </Badge>
            )}
          </div>
        </div>
        {onEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => onEdit(task)}
            data-testid={`button-edit-task-${task.id}`}
          >
            编辑
          </Button>
        )}
      </div>

      {task.notes && !compact && (
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed break-words">{task.notes}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          单份产出 <Num className="text-foreground">{task.xpPerUnit}</Num> XP ·{" "}
          <Num className="text-foreground">{task.pointsPerUnit}</Num> 分 ·{" "}
          <Num className="text-foreground">{task.profPerUnit}</Num> 熟练
        </span>
        {task.todayXp > 0 && (
          <span className="text-success">
            今日已得 <Num>{task.todayXp}</Num> XP
          </span>
        )}
      </div>

      <div className="mt-3.5 border-t border-border/70 pt-3.5">
        {task.mode === "timer" && <TimerControls task={task} settle={settle} />}
        {task.mode === "milestone" && <MilestoneControls task={task} settle={settle} />}
        {task.mode === "habit" && <HabitControls task={task} settle={settle} />}
        {task.mode === "count" && <CountControls task={task} settle={settle} />}
      </div>
    </div>
  );
}

type SettleMutation = ReturnType<typeof useMutation<SettleResult, any, { url: string; body?: any }>>;

// ---------------- 计时 ----------------
function TimerControls({ task, settle }: { task: TaskFull; settle: any }) {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const blockMs = task.blockMinutes * 60 * 1000;
  const anchor = useRef<{ elapsed: number; at: number; running: boolean }>({
    elapsed: task.timer?.elapsedMs ?? 0,
    at: Date.now(),
    running: !!task.timer?.running,
  });
  const [, force] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMinutes, setManualMinutes] = useState(String(task.blockMinutes));
  const [manualDay, setManualDay] = useState(dateKey());
  const claiming = useRef(false);

  useEffect(() => {
    anchor.current = {
      elapsed: task.timer?.elapsedMs ?? 0,
      at: Date.now(),
      running: !!task.timer?.running,
    };
    claiming.current = false;
    force((n) => n + 1);
  }, [task.timer?.elapsedMs, task.timer?.running, task.id]);

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const elapsed =
    anchor.current.elapsed + (anchor.current.running ? Date.now() - anchor.current.at : 0);
  const inBlock = elapsed % blockMs;
  const readyBlocks = Math.floor(elapsed / blockMs);

  // 满一个块自动结算
  useEffect(() => {
    if (readyBlocks >= 1 && anchor.current.running && !claiming.current && !settle.isPending) {
      claiming.current = true;
      settle.mutate({ url: `/api/tasks/${task.id}/timer/claim` });
    }
  }, [readyBlocks, settle.isPending]);

  const timerActive = !!task.timer;
  const running = anchor.current.running;
  const remainMin = Math.max(0, Math.ceil((blockMs - inBlock) / 60000));

  const control = useMutation({
    mutationFn: async (action: string) => {
      const res = await apiRequest("POST", `/api/tasks/${task.id}/timer/${action}`, {});
      return await res.json();
    },
    onSuccess: () => invalidateAll(userId),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="num text-xl font-bold tabular-nums" data-testid={`text-timer-${task.id}`}>
            {fmtClock(timerActive ? inBlock : 0)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            / 每块 <Num>{task.blockMinutes}</Num> 分钟
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          今日 <Num className="text-foreground">{task.todayBlocks}</Num>/
          <Num>{task.dailyTargetBlocks}</Num> 块
        </span>
      </div>

      <Bar ratio={timerActive ? inBlock / blockMs : 0} color={catColor(task.category)} height={6} />
      <p className="text-[11px] text-muted-foreground">
        {timerActive
          ? `距离下一次结算还差 ${remainMin} 分钟，可拿 ${task.xpPerUnit} XP。`
          : `开始一个 ${task.blockMinutes} 分钟专注块即可结算一份奖励。`}
      </p>

      <div className="flex flex-wrap gap-2">
        {!running ? (
          <Button
            size="sm"
            onClick={() => control.mutate("start")}
            data-testid={`button-timer-start-${task.id}`}
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            {timerActive ? "继续" : "开始"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => control.mutate("pause")}
            data-testid={`button-timer-pause-${task.id}`}
          >
            <Pause className="mr-1 h-3.5 w-3.5" />
            暂停
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!timerActive}
          onClick={() => settle.mutate({ url: `/api/tasks/${task.id}/timer/complete` })}
          data-testid={`button-timer-complete-${task.id}`}
        >
          完成结算
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!timerActive}
          onClick={() => control.mutate("abandon")}
          data-testid={`button-timer-abandon-${task.id}`}
        >
          放弃
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setManualOpen((v) => !v)}
          data-testid={`button-manual-open-${task.id}`}
        >
          手动补记
        </Button>
      </div>

      {manualOpen && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            补记时长按 <Num>floor(分钟 / {task.blockMinutes})</Num> 结算，需填写日期。
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[7rem] flex-1">
              <label className="mb-1 block text-[11px] text-muted-foreground">分钟数</label>
              <Input
                type="number"
                min={1}
                value={manualMinutes}
                onChange={(e) => setManualMinutes(e.target.value)}
                className="num h-9"
                data-testid={`input-manual-minutes-${task.id}`}
              />
            </div>
            <div className="min-w-[9rem] flex-1">
              <label className="mb-1 block text-[11px] text-muted-foreground">日期</label>
              <Input
                type="date"
                value={manualDay}
                max={dateKey()}
                onChange={(e) => setManualDay(e.target.value)}
                className="num h-9"
                data-testid={`input-manual-day-${task.id}`}
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={() =>
              settle.mutate({
                url: `/api/tasks/${task.id}/manual-time`,
                body: { minutes: Number(manualMinutes) || 0, day: manualDay },
              })
            }
            data-testid={`button-manual-submit-${task.id}`}
          >
            提交补记
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------- 里程碑 ----------------
function MilestoneControls({ task, settle }: { task: TaskFull; settle: any }) {
  const total = task.milestones.reduce((a, m) => a + (m.weight || 1), 0) || 1;
  const doneWeight = task.milestones.filter((m) => m.done).reduce((a, m) => a + (m.weight || 1), 0);
  const nextNode = task.milestones.find((m) => !m.done);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          进度 <Num className="text-foreground">{task.milestones.filter((m) => m.done).length}</Num>/
          <Num>{task.milestones.length}</Num> 节点
        </span>
        <span>
          已释放 <Num className="text-foreground">{Math.round((doneWeight / total) * 100)}</Num>% 奖励
        </span>
      </div>
      <Bar ratio={doneWeight / total} color={catColor(task.category)} height={6} />
      <ul className="space-y-1.5">
        {task.milestones.map((m) => (
          <li key={m.id} className="flex items-start gap-2.5 rounded-lg px-1.5 py-1 hover-elevate">
            <Checkbox
              id={`ms-${task.id}-${m.id}`}
              checked={m.done}
              className="mt-0.5"
              data-testid={`checkbox-milestone-${task.id}-${m.id}`}
              onCheckedChange={(v) =>
                settle.mutate({
                  url: `/api/tasks/${task.id}/milestone`,
                  body: { milestoneId: m.id, done: !!v },
                })
              }
            />
            <label
              htmlFor={`ms-${task.id}-${m.id}`}
              className={cn(
                "min-w-0 flex-1 cursor-pointer text-sm leading-snug break-words",
                m.done && "text-muted-foreground line-through",
              )}
            >
              {m.title}
              <span className="num ml-1.5 text-[11px] text-muted-foreground">
                {Math.round(((m.weight || 1) / total) * 100)}%
              </span>
            </label>
          </li>
        ))}
      </ul>
      {task.milestones.length === 0 && (
        <p className="text-xs text-muted-foreground">还没有里程碑节点，点右上「编辑」补充拆解。</p>
      )}
      {nextNode && (
        <p className="text-[11px] text-muted-foreground">
          下一个节点「{nextNode.title}」可得约{" "}
          <Num className="text-foreground">
            {Math.round((task.xpPerUnit * (nextNode.weight || 1)) / total)}
          </Num>{" "}
          XP。
        </p>
      )}
      {!nextNode && task.milestones.length > 0 && (
        <p className="text-[11px] text-success">全部节点完成，已发放 20% 收官奖励。</p>
      )}
    </div>
  );
}

// ---------------- 打卡 ----------------
function HabitControls({ task, settle }: { task: TaskFull; settle: any }) {
  const [percent, setPercent] = useState(100);
  const [makeupOpen, setMakeupOpen] = useState(false);
  const [makeupDay, setMakeupDay] = useState(
    dateKey(new Date(Date.now() - 86400000)),
  );
  const mul = streakMultiplier(task.effectiveStreak);
  const minDay = dateKey(new Date(Date.now() - MAKEUP_DAYS * 86400000));
  const periodLabel = task.period === "weekly" ? "本周" : "今日";
  const doneThisPeriod = task.periodCheckins;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm">
          <Flame className={cn("h-4 w-4", task.effectiveStreak > 0 ? "text-cat-life" : "text-muted-foreground")} />
          <span>
            连续 <Num className="font-bold">{task.effectiveStreak}</Num> {task.period === "weekly" ? "周" : "天"}
          </span>
          {mul > 1 && (
            <Badge variant="secondary" className="num text-[11px]">
              加成 ×{mul}
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {periodLabel}已打 <Num className="text-foreground">{doneThisPeriod}</Num>/
          <Num>{task.targetPerPeriod}</Num> 次
        </span>
      </div>
      <Bar
        ratio={Math.min(1, doneThisPeriod / task.targetPerPeriod)}
        color={catColor(task.category)}
        height={6}
      />
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>本次完成度</span>
          <Num className="text-foreground" data-testid={`text-habit-percent-${task.id}`}>{percent}%</Num>
        </div>
        <Slider
          value={[percent]}
          min={10}
          max={100}
          step={10}
          onValueChange={(v) => setPercent(v[0])}
          data-testid={`slider-habit-${task.id}`}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        本次打卡预计 <Num className="text-foreground">{Math.round(task.xpPerUnit * (percent / 100) * mul)}</Num> XP
        {mul > 1 ? `（含连续加成 ×${mul}）` : ""}。断签不扣分，只会把连续数归零。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => settle.mutate({ url: `/api/tasks/${task.id}/checkin`, body: { percent } })}
          data-testid={`button-checkin-${task.id}`}
        >
          打卡
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setMakeupOpen((v) => !v)}
          data-testid={`button-makeup-open-${task.id}`}
        >
          补签
        </Button>
      </div>
      {makeupOpen && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            可为过去 {MAKEUP_DAYS} 天内的漏签补卡，补签不计入连续加成。
          </p>
          <Input
            type="date"
            value={makeupDay}
            min={minDay}
            max={dateKey(new Date(Date.now() - 86400000))}
            onChange={(e) => setMakeupDay(e.target.value)}
            className="num h-9 max-w-[11rem]"
            data-testid={`input-makeup-day-${task.id}`}
          />
          <Button
            size="sm"
            onClick={() =>
              settle.mutate({ url: `/api/tasks/${task.id}/checkin`, body: { percent, day: makeupDay } })
            }
            data-testid={`button-makeup-submit-${task.id}`}
          >
            提交补签
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------- 计件 ----------------
function CountControls({ task, settle }: { task: TaskFull; settle: any }) {
  const [custom, setCustom] = useState("5");
  const ratio = Math.min(1, task.currentCount / task.targetCount);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          已完成 <Num className="text-base font-bold text-foreground">{task.currentCount}</Num> /{" "}
          <Num>{task.targetCount}</Num> {task.unitName}
        </span>
        <span>
          单个 <Num className="text-foreground">{task.xpPerUnit}</Num> XP
        </span>
      </div>
      <Bar ratio={ratio} color={catColor(task.category)} height={6} />
      <p className="text-[11px] text-muted-foreground">
        {task.currentCount >= task.targetCount
          ? "目标已达成，收官奖励已发放，可继续累积。"
          : `距离目标还差 ${task.targetCount - task.currentCount} ${task.unitName}，达成再加 20% 收官奖励。`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => settle.mutate({ url: `/api/tasks/${task.id}/count`, body: { delta: 1 } })}
          data-testid={`button-count-plus1-${task.id}`}
        >
          +1 {task.unitName}
        </Button>
        <Input
          type="number"
          min={1}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="num h-9 w-20"
          data-testid={`input-count-custom-${task.id}`}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            settle.mutate({ url: `/api/tasks/${task.id}/count`, body: { delta: Number(custom) || 1 } })
          }
          data-testid={`button-count-custom-${task.id}`}
        >
          按数量记录
        </Button>
      </div>
    </div>
  );
}
