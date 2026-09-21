import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import type { TaskFull } from "@/lib/types";
import { PageHeader, EmptyState } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarDays, Flag, NotebookPen } from "lucide-react";
import { dateKey, weekKey } from "@shared/gameRules";
import { cn } from "@/lib/utils";

type JournalEntry = {
  id: number;
  kind: "review" | "plan";
  period: "daily" | "weekly";
  periodKey: string;
  content: string;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function priorityCls(p: number | undefined): string {
  if ((p ?? 0) >= 4) return "border-red-500 bg-red-500/10 text-red-500";
  if ((p ?? 0) === 3) return "border-orange-400 bg-orange-400/10 text-orange-500";
  return "border-border bg-muted/50 text-muted-foreground";
}

export default function SchedulePage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const { data: tasks } = useQuery<TaskFull[]>({ queryKey: ["/api/tasks", userId] });
  const { data: journals } = useQuery<JournalEntry[]>({ queryKey: ["/api/journals", userId] });

  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const activeTasks = (tasks ?? []).filter((t) => t.archived !== 1);
  const plans = (journals ?? []).filter((j) => j.kind === "plan");

  function tasksOn(day: string) {
    return activeTasks.filter((t) => t.deadline === day || t.endDate === day);
  }

  function plansOn(day: string) {
    const wk = weekKey(new Date(day + "T12:00:00"));
    const isMonday = new Date(day + "T12:00:00").getDay() === 1;
    return plans.filter(
      (p) => (p.period === "daily" && p.periodKey === day) || (p.period === "weekly" && p.periodKey === wk && isMonday),
    );
  }

  function move(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  const upcoming = activeTasks
    .filter((t) => t.deadline || t.endDate)
    .sort((a, b) => (a.deadline || a.endDate || "").localeCompare(b.deadline || b.endDate || ""))
    .slice(0, 8);

  return (
    <div>
      <PageHeader
        title="日程表"
        desc="把带截止日期的任务、复盘规划里的安排和 DDL 放进日历，按优先级着色。"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => move(-1)} data-testid="button-prev-month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[7rem] text-center text-sm font-semibold">
            {year} 年 {month + 1} 月
          </span>
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => move(1)} data-testid="button-next-month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const n = new Date();
            setYear(n.getFullYear());
            setMonth(n.getMonth());
          }}
          data-testid="button-today"
        >
          回到今天
        </Button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-card-border bg-card p-2 shadow-sm">
        <div className="grid min-w-[720px] grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1 text-center text-[11px] font-semibold text-muted-foreground">
              周{w}
            </div>
          ))}
          {cells.map((d, i) => {
            if (d == null) return <div key={i} className="min-h-[92px] rounded-lg bg-muted/30" />;
            const day = fmt(new Date(year, month, d));
            const dayTasks = tasksOn(day);
            const dayPlans = plansOn(day);
            const isToday = day === dateKey();
            return (
              <div
                key={i}
                className={cn(
                  "min-h-[92px] rounded-lg border p-1.5",
                  isToday ? "border-primary/60 bg-primary/5" : "border-border/60 bg-background/60",
                )}
                data-testid={`day-${day}`}
              >
                <p className={cn("text-right text-[11px]", isToday ? "font-bold text-primary" : "text-muted-foreground")}>
                  {d}
                </p>
                <div className="mt-1 space-y-1">
                  {dayTasks.slice(0, 3).map((t) => (
                    <div
                      key={t.id}
                      className={cn("truncate rounded border-l-2 px-1.5 py-0.5 text-[10px] leading-tight", priorityCls(t.priority))}
                      title={`${t.title}${t.deadline ? ` · 截止 ${t.deadline}` : ""}`}
                    >
                      <Flag className="mr-0.5 inline h-2.5 w-2.5" />
                      {t.title}
                    </div>
                  ))}
                  {dayPlans.slice(0, 2).map((p) => (
                    <div
                      key={p.id}
                      className="truncate rounded border-l-2 border-primary/50 bg-primary/5 px-1.5 py-0.5 text-[10px] leading-tight text-primary"
                      title={p.content}
                    >
                      <NotebookPen className="mr-0.5 inline h-2.5 w-2.5" />
                      规划：{p.content}
                    </div>
                  ))}
                  {dayTasks.length + dayPlans.length > 5 && (
                    <p className="text-[9px] text-muted-foreground">+{dayTasks.length + dayPlans.length - 5} 项</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="mt-4 rounded-xl border border-card-border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">即将到来的 DDL</p>
          <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {upcoming.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <span className={cn("h-3 w-1 shrink-0 rounded", (t.priority ?? 0) >= 3 ? "bg-red-500" : "bg-muted-foreground/40")} />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="num text-muted-foreground">{t.deadline || t.endDate}</span>
                {(t.priority ?? 0) >= 3 && <span className="text-[10px] text-red-500">高优</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeTasks.length === 0 && plans.length === 0 && (
        <div className="mt-4">
          <EmptyState icon={CalendarDays} title="还没有日程" desc="给任务设置截止日期，或在复盘规划页写下计划，就会出现在日历里。" />
        </div>
      )}
    </div>
  );
}
