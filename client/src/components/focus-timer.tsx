import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Square, TimerReset, Gamepad2, BookOpen, AlertTriangle } from "lucide-react";
import type { TaskFull } from "@/lib/types";
import { cn } from "@/lib/utils";

type FocusView = {
  running: boolean;
  elapsedMs: number;
  kind: "focus" | "game";
  taskId: number | null;
  capMinutes: number;
};

function fmtClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function FocusTimer() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const { data: tasks } = useQuery<TaskFull[]>({ queryKey: ["/api/tasks", userId] });
  const active = (tasks ?? []).filter((t) => t.archived === 0);
  const { data: state } = useQuery<FocusView>({
    queryKey: ["/api/focus/state", userId],
    refetchInterval: 30_000,
  });
  const [taskId, setTaskId] = useState("");
  const [kind, setKind] = useState<"focus" | "game">("focus");
  const [capMinutes, setCapMinutes] = useState(60);
  const anchor = useRef({ elapsed: 0, at: Date.now(), running: false });
  const [, force] = useState(0);
  const warned = useRef(false);

  useEffect(() => {
    anchor.current = {
      elapsed: state?.elapsedMs ?? 0,
      at: Date.now(),
      running: !!state?.running,
    };
    force((n) => n + 1);
  }, [state?.elapsedMs, state?.running]);

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const elapsed =
    anchor.current.elapsed + (anchor.current.running ? Date.now() - anchor.current.at : 0);
  const activeKind = state?.kind ?? "focus";
  const activeCap = state?.capMinutes ?? capMinutes;
  const over = !!state?.running && activeKind === "game" && elapsed / 60000 > activeCap;

  useEffect(() => {
    if (over && !warned.current) {
      warned.current = true;
      toast({
        title: "娱乐超时提醒",
        description: `已超过 ${activeCap} 分钟上限，结束后会有温和扣分。`,
        variant: "destructive",
      });
    } else if (!over) {
      warned.current = false;
    }
  }, [over, activeCap, toast]);

  function invalidate() {
    invalidateAll(userId);
  }

  const start = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/focus/start", {
        kind,
        capMinutes,
        taskId: taskId || null,
      });
      return (await res.json()) as FocusView;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "无法开始计时", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const pause = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/focus/pause", {});
      return (await res.json()) as FocusView;
    },
    onSuccess: invalidate,
  });

  const abandon = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/focus/abandon", {});
      return await res.json();
    },
    onSuccess: (d: any) => {
      invalidate();
      if (d?.message) toast({ title: "已放弃", description: d.message });
    },
  });

  const stop = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/focus/stop", { taskId: taskId || null });
      return await res.json();
    },
    onSuccess: (d: any) => {
      invalidate();
      if (d?.message) toast({ title: "本次计时", description: d.message });
    },
    onError: (e: any) => toast({ title: "结束失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const running = !!state?.running;
  const hasSession = !!state && (state.running || state.elapsedMs > 0);

  return (
    <section
      className="mb-4 rounded-xl border border-card-border bg-card p-4 shadow-sm"
      data-testid="card-focus-timer"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <TimerReset className="h-4 w-4 text-primary" />
            专注计时器
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            可选关联任务；结束后自动推进计时任务进度，或给非计时任务记一笔努力奖励。
          </p>
        </div>
        <Badge
          variant={activeKind === "game" ? "secondary" : "default"}
          className="text-[11px]"
          data-testid="badge-focus-kind"
        >
          {activeKind === "game" ? <Gamepad2 className="mr-1 h-3 w-3" /> : <BookOpen className="mr-1 h-3 w-3" />}
          {activeKind === "game" ? "游戏 / 娱乐" : "专注"}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="min-w-[7rem]">
          <p
            className={cn(
              "num text-3xl font-bold tabular-nums",
              over ? "text-destructive" : "text-foreground",
            )}
            data-testid="text-focus-clock"
          >
            {fmtClock(elapsed)}
          </p>
          {activeKind === "game" && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              上限 <span className="num">{activeCap}</span> 分钟
            </p>
          )}
        </div>

        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-[11px]">关联任务</Label>
            <Select
              value={taskId}
              onValueChange={(v) => setTaskId(v)}
              disabled={running || kind === "game"}
            >
              <SelectTrigger data-testid="select-focus-task" className="h-9">
                <SelectValue placeholder="不关联任务" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">不关联任务（自由专注）</SelectItem>
                {active.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">类型</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as "focus" | "game")}
              disabled={running}
            >
              <SelectTrigger data-testid="select-focus-kind" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="focus">专注 / 学习</SelectItem>
                <SelectItem value="game">游戏 / 娱乐</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">娱乐上限（分钟）</Label>
            <Input
              type="number"
              min={10}
              max={600}
              className="num h-9"
              value={capMinutes}
              disabled={running || kind !== "game"}
              onChange={(e) => setCapMinutes(Number(e.target.value) || 60)}
              data-testid="input-focus-cap"
            />
          </div>
        </div>
      </div>

      {over && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          已超上限，请尽快收手；超时部分会在结束时温和扣分。
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!running ? (
          <Button
            size="sm"
            disabled={start.isPending}
            onClick={() => start.mutate()}
            data-testid="button-focus-start"
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            {hasSession ? "继续" : "开始"}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={pause.isPending} onClick={() => pause.mutate()} data-testid="button-focus-pause">
            <Pause className="mr-1 h-3.5 w-3.5" />
            暂停
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!hasSession || stop.isPending}
          onClick={() => stop.mutate()}
          data-testid="button-focus-stop"
        >
          <Square className="mr-1 h-3.5 w-3.5" />
          结束并记录
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!hasSession || abandon.isPending}
          onClick={() => abandon.mutate()}
          data-testid="button-focus-abandon"
        >
          放弃
        </Button>
      </div>
    </section>
  );
}
