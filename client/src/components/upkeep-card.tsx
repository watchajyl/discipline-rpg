// 今日面板顶部「今日维持」卡片 + 长期未打开的温和补算汇总卡
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApp, invalidateAll } from "@/lib/app-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { UpkeepData } from "@/lib/types";
import { Num, Ring, SkeletonBlock, catColor } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES, categoryName } from "@shared/gameRules";
import { UPKEEP_TEXT, upkeepModeName } from "@shared/upkeep";
import { CheckCircle2, ChevronDown, ChevronRight, ShieldHalf, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

function pct(r: number) {
  return `${Math.round(Math.max(0, Math.min(1, r)) * 100)}%`;
}

/** 补算汇总卡：长期未打开后温和告知，可展开逐日明细 */
export function UpkeepCatchUpCard({ data }: { data: UpkeepData }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const c = data.catchUp;
  if (!c || hidden || c.days < data.summaryMinDays) return null;
  return (
    <div
      className="mb-4 rounded-xl border border-warn/40 bg-warn/10 p-3.5"
      data-testid="card-upkeep-catchup"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <ShieldHalf className="h-4 w-4 shrink-0 text-warn" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed" data-testid="text-upkeep-catchup-summary">
          {UPKEEP_TEXT.catchUpTitle(c.days, c.charged)} · {UPKEEP_TEXT.catchUpComfort}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setOpen((v) => !v)}
          data-testid="button-upkeep-catchup-detail"
        >
          {open ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
          逐日明细
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          aria-label="知道了"
          onClick={() => setHidden(true)}
          data-testid="button-upkeep-catchup-dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {open && (
        <ul className="mt-2.5 grid gap-1 border-t border-warn/25 pt-2.5 sm:grid-cols-2" data-testid="list-upkeep-catchup-days">
          {c.rows.map((r) => (
            <li key={r.day} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="num">{r.day}</span>
              <span className={cn("num", r.charged > 0 ? "text-warn" : "text-success")}>
                {r.charged > 0 ? `−${r.charged}` : r.allMet ? "全维达成" : "0"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UpkeepCard() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const [detailOpen, setDetailOpen] = useState(false);
  // 每次进入/刷新今日面板都跑一次跨日补算：按 (userId, day) 主键去重，天然幂等
  const { data, isLoading } = useQuery<UpkeepData>({
    queryKey: ["/api/upkeep", userId],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/upkeep/catchup");
      return (await res.json()) as UpkeepData;
    },
  });

  const exempt = useMutation({
    mutationFn: async (category: string) => {
      const res = await apiRequest("POST", "/api/upkeep/exempt", { category });
      return (await res.json()) as UpkeepData;
    },
    onSuccess: (d) => {
      invalidateAll(userId);
      toast({ title: `已使用豁免格，本周还剩 ${d.exemptions.left} 个` });
    },
    onError: (e: any) => toast({ title: e?.message || "豁免失败", variant: "destructive" }),
  });

  if (isLoading || !data) return <SkeletonBlock className="mb-4 h-44 w-full" />;
  if (!data.config.enabled) return null;

  const est = data.estimate;
  const bonusTotal = est.bonus + est.streakBonus;

  return (
    <>
      <UpkeepCatchUpCard data={data} />
      <section
        className={cn(
          "mb-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5",
          est.allMet ? "border-success/40" : "border-card-border",
        )}
        data-testid="card-upkeep-today"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold">
              <ShieldHalf className="h-4 w-4 text-warn" />
              今日维持
              {est.grace ? (
                <Badge variant="outline" className="border-primary/40 text-[10px] font-normal text-primary" data-testid="badge-upkeep-grace">
                  {UPKEEP_TEXT.graceBadge(est.graceDaysLeft)}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-warn/40 text-[10px] font-normal text-warn" data-testid="badge-upkeep-estimate">
                  {UPKEEP_TEXT.estimate}
                </Badge>
              )}
              {est.allMet && (
                <Badge className="bg-success/15 text-[10px] font-normal text-success hover:bg-success/15" data-testid="badge-upkeep-allmet">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {UPKEEP_TEXT.allMet}
                </Badge>
              )}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground" data-testid="text-upkeep-net">
              今日维持 <span className={cn("num", est.totalDue > 0 ? "text-warn" : "")}>{est.totalDue > 0 ? `−${est.totalDue}` : "0"}</span>
              {bonusTotal > 0 && (
                <>
                  {" · "}已抵扣 <span className="num text-success">−{bonusTotal}</span>
                </>
              )}
              {" · "}
              <span className="font-semibold text-foreground">
                净支出 <span className="num">{est.netSpend > 0 ? `−${est.netSpend}` : est.netSpend < 0 ? `+${-est.netSpend}` : "0"}</span>
              </span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              连续全维达成 <Num className="text-foreground">{est.allMetStreak}</Num> 天
              {data.nextMilestone && (
                <>
                  {" · "}再坚持 <Num className="text-foreground">{data.nextMilestone.days - est.allMetStreak}</Num> 天可得{" "}
                  <Num className="text-success">+{data.nextMilestone.bonus}</Num>
                </>
              )}
              {est.capped && <> · 已触发每日封顶 {data.config.dailyCapPoints} 分</>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">本周豁免格</p>
            <p className="num mt-0.5 text-lg font-bold" data-testid="text-upkeep-exemptions-left">
              {data.exemptions.left}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">/ {data.exemptions.total}</span>
            </p>
          </div>
        </div>

        {/* 五类别达标度环 */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-border/70 pt-4 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((c) => {
            const row = est.perCategory[c.key];
            if (!row) return null;
            const met = row.ratio >= 1;
            const off = row.mode === "off";
            const color = off ? "hsl(var(--muted-foreground))" : met ? "hsl(var(--success))" : catColor(c.key);
            const canExempt =
              !off && !row.exempted && !met && data.exemptions.left > 0 && !est.grace;
            return (
              <div
                key={c.key}
                className="flex flex-col items-center rounded-xl border border-border bg-background/60 p-2.5 text-center"
                data-testid={`card-upkeep-cat-${c.key}`}
              >
                <Ring ratio={off ? 0 : row.ratio} size={54} stroke={5} color={color} label={`${c.name}达标度`}>
                  <span className="num text-[11px] font-bold leading-none" data-testid={`text-upkeep-ratio-${c.key}`}>
                    {off ? "—" : pct(row.ratio)}
                  </span>
                </Ring>
                <p className="mt-1.5 truncate text-[11px] font-semibold" title={c.name}>
                  {c.name}
                </p>
                <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{upkeepModeName(row.mode)}</p>
                <div className="mt-1 min-h-[16px]">
                  {row.exempted ? (
                    <span className="text-[10px] font-semibold text-primary" data-testid={`text-upkeep-exempt-${c.key}`}>
                      已豁免
                    </span>
                  ) : off ? (
                    <span className="text-[10px] text-muted-foreground">不计费</span>
                  ) : row.due > 0 ? (
                    <span className="num text-[11px] font-semibold text-warn" data-testid={`text-upkeep-fee-${c.key}`}>
                      −{row.due}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-success" data-testid={`text-upkeep-fee-${c.key}`}>
                      {met ? "已达标" : "0"}
                    </span>
                  )}
                </div>
                {canExempt && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1.5 h-6 w-full px-1 text-[10px]"
                    disabled={exempt.isPending}
                    onClick={() => exempt.mutate(c.key)}
                    data-testid={`button-upkeep-exempt-${c.key}`}
                  >
                    {UPKEEP_TEXT.exemptionLeft(data.exemptions.left)}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* 门槛达成明细 */}
        <button
          type="button"
          className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground hover-elevate rounded-md px-1 py-0.5"
          onClick={() => setDetailOpen((v) => !v)}
          data-testid="button-upkeep-detail-toggle"
        >
          {detailOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          门槛达成明细
        </button>
        {detailOpen && (
          <ul className="mt-2 grid gap-1.5 border-t border-border/70 pt-2.5 sm:grid-cols-2" data-testid="list-upkeep-detail">
            {CATEGORIES.map((c) => {
              const row = est.perCategory[c.key];
              if (!row) return null;
              return (
                <li key={c.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-relaxed">
                  <span className="font-semibold" style={{ color: catColor(c.key) }}>
                    {c.name}
                  </span>
                  {row.parts.length === 0 ? (
                    <span className="text-muted-foreground">未设门槛，不计费</span>
                  ) : (
                    row.parts.map((p) => (
                      <span key={p.key} className="text-muted-foreground">
                        {p.label}{" "}
                        <Num className={p.ratio >= 1 ? "text-success" : "text-foreground"}>{p.current}</Num>
                        <span className="num"> / {p.target}</span>
                        {p.unit}
                      </span>
                    ))
                  )}
                  {row.missStreak > 0 && !row.exempted && (
                    <span className="text-warn">连续未达标 {row.missStreak} 天（×{
                      data.config.escalation[Math.min(row.missStreak, data.config.escalation.length) - 1]
                    }）</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {data.exemptions.left === 0 && !est.grace && (
          <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-warn" />
            {UPKEEP_TEXT.exemptionNone}，下周一恢复 {data.config.weeklyExemptions} 个
          </p>
        )}
      </section>
    </>
  );
}

/** 统计页与设置页复用：类别名 */
export { categoryName };
