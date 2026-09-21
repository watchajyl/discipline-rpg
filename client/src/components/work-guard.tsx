import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import { HeartPulse, AlertTriangle, ShieldCheck } from "lucide-react";
import { Num } from "./bits";
import { cn } from "@/lib/utils";

type WorkLimits = {
  sleepMinutes: number;
  cap: number;
  todayMinutes: number;
  over: boolean;
  reason: string;
};

export function WorkGuardBanner() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { data } = useQuery<WorkLimits>({ queryKey: ["/api/focus/limits", userId] });
  if (!data) return null;
  const ratio = data.cap > 0 ? data.todayMinutes / data.cap : 0;
  return (
    <section
      className={cn(
        "mb-4 rounded-xl border p-4 shadow-sm",
        data.over ? "border-red-500/60 bg-red-500/10" : ratio >= 0.8 ? "border-orange-400/60 bg-orange-400/10" : "border-card-border bg-card",
      )}
      data-testid="card-work-guard"
    >
      <div className="flex flex-wrap items-start gap-3">
        {data.over ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        ) : ratio >= 0.8 ? (
          <HeartPulse className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
        ) : (
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", data.over ? "text-red-600" : "text-foreground")}>
            {data.over
              ? "今日专注已超建议值：强烈建议停止工作学习"
              : `今日健康专注额度：${data.cap} 分钟`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{data.reason}</p>
          <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", data.over ? "bg-red-500" : ratio >= 0.8 ? "bg-orange-400" : "bg-success")}
              style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            已专注 <Num>{data.todayMinutes}</Num> / <Num>{data.cap}</Num> 分钟
            {data.over ? "，之后新增时间块与番茄钟产出降为 20%" : data.cap - data.todayMinutes > 0 ? `，还可投入 ${data.cap - data.todayMinutes} 分钟` : ""}
          </p>
        </div>
      </div>
    </section>
  );
}
