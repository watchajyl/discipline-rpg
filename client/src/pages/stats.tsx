import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import type { Profile, StatsData } from "@/lib/types";
import type { Log } from "@shared/schema";
import { CategoryChip, EmptyState, Num, PageHeader, SkeletonBlock, catColor, formatMinutes } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CATEGORIES, categoryName, PROFICIENCY_TIERS } from "@shared/gameRules";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  block: "专注块",
  manual: "手动补记",
  milestone: "里程碑",
  milestone_undo: "撤销里程碑",
  checkin: "打卡",
  makeup: "补签",
  count: "计数",
  finish: "收官奖励",
};

export default function StatsPage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { data: stats, isLoading } = useQuery<StatsData>({ queryKey: ["/api/stats", userId] });
  const { data: profile } = useQuery<Profile>({ queryKey: ["/api/profile", userId] });
  const { data: logs } = useQuery<Log[]>({ queryKey: ["/api/logs", userId] });
  const [range, setRange] = useState<7 | 14 | 30>(30);

  const daily = useMemo(() => (stats?.daily ?? []).slice(-range), [stats, range]);
  const hasData = (stats?.totals.settlements ?? 0) > 0;

  const radarData = useMemo(
    () =>
      CATEGORIES.map((c) => {
        const value = profile?.proficiency[c.key] ?? 0;
        return { category: c.name, value, display: value };
      }),
    [profile],
  );

  const maxHeat = Math.max(1, ...(stats?.heatmap ?? []).map((h) => h.xp));

  if (isLoading || !stats) {
    return (
      <div>
        <PageHeader title="数据统计" desc="过去 30 天的投入与产出。" />
        <div className="space-y-4">
          <SkeletonBlock className="h-28 w-full" />
          <SkeletonBlock className="h-72 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="数据统计"
        desc="趋势、结构与节奏。数据只统计真实结算记录，不做任何美化。"
        actions={
          <div className="flex gap-1.5">
            {([7, 14, 30] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                data-testid={`button-range-${r}`}
                className={cn(
                  "num rounded-full border px-2.5 py-1 text-xs transition-colors",
                  range === r
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover-elevate",
                )}
              >
                {r} 天
              </button>
            ))}
          </div>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="累计经验" value={stats.totals.xp} suffix="XP" testId="kpi-xp" />
        <Kpi label="累计积分" value={stats.totals.points} suffix="分" testId="kpi-points" />
        <Kpi label="累计专注" value={Number((stats.totals.minutes / 60).toFixed(1))} suffix="小时" testId="kpi-hours" />
        <Kpi label="结算次数" value={stats.totals.settlements} suffix="次" testId="kpi-settlements" />
        <Kpi label="活跃天数" value={stats.totals.activeDays} suffix="天" testId="kpi-active-days" />
      </div>

      {!hasData ? (
        <div className="mt-5">
          <EmptyState
            icon={BarChart3}
            title="还没有可统计的数据"
            desc="完成第一次结算后，这里会出现每日趋势、类别结构、熟练度雷达图和活跃热力图。"
          />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {/* 每日经验/积分趋势 */}
          <Panel title="每日经验与积分" hint={`最近 ${range} 天`}>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={daily} margin={{ top: 6, right: 8, left: -4, bottom: 0 }}>
                <defs>
                  <linearGradient id="gxp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="gpt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--cat-finance))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--cat-finance))" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={46} />
                <RTooltip content={<ChartTip unitMap={{ xp: "XP", points: "分" }} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === "xp" ? "经验" : "积分")} />
                <Area type="monotone" dataKey="xp" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gxp)" animationDuration={700} />
                <Area type="monotone" dataKey="points" stroke="hsl(var(--cat-finance))" strokeWidth={2} fill="url(#gpt)" animationDuration={700} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {/* 类别结构 */}
            <Panel title="类别投入结构" hint="按累计经验">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.byCategory} margin={{ top: 6, right: 8, left: -4, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="category"
                    tickFormatter={(v) => categoryName(v)}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={46} />
                  <RTooltip content={<ChartTip unitMap={{ xp: "XP", minutes: "分钟" }} nameFormatter={categoryName} />} />
                  <Bar dataKey="xp" radius={[4, 4, 0, 0]} animationDuration={700}>
                    {stats.byCategory.map((c) => (
                      <Cell key={c.category} fill={catColor(c.category)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ul className="mt-3 flex flex-wrap gap-2">
                {stats.byCategory.map((c) => (
                  <li key={c.category} className="flex items-center gap-1.5">
                    <CategoryChip cat={c.category} />
                    <span className="num text-[11px] text-muted-foreground">{formatMinutes(c.minutes)}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            {/* 熟练度雷达 */}
            <Panel title="熟练度分布" hint="五类均衡度">
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Radar
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.28}
                    strokeWidth={2}
                    animationDuration={700}
                  />
                  <RTooltip content={<ChartTip unitMap={{ value: "熟练度" }} />} />
                </RadarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => {
                  const tier = profile?.proficiencyTiers?.[c.key];
                  return (
                    <Badge key={c.key} variant="outline" className="text-[10px]">
                      {c.name} {tier?.name ?? "新手"}
                    </Badge>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* 周专注时长 */}
          <Panel title="每周专注时长" hint="最近 12 周">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.weekly} margin={{ top: 6, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={46} />
                <RTooltip content={<ChartTip unitMap={{ minutes: "分钟", xp: "XP" }} />} />
                <Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          {/* 热力图 */}
          <Panel title="活跃热力图" hint="最近 90 天，颜色越亮当日经验越高">
            <div className="overflow-x-auto scroll-thin pb-1">
              <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
                {stats.heatmap.map((h) => {
                  const intensity = h.xp === 0 ? 0 : 0.18 + 0.82 * (h.xp / maxHeat);
                  return (
                    <span
                      key={h.day}
                      title={`${h.day} · ${h.xp} XP · ${h.count} 次结算`}
                      className="h-3.5 w-3.5 rounded-[3px]"
                      style={{
                        background:
                          h.xp === 0
                            ? "hsl(var(--muted))"
                            : `color-mix(in srgb, hsl(var(--primary)) ${Math.round(intensity * 100)}%, transparent)`,
                      }}
                      data-testid={`heat-${h.day}`}
                    />
                  );
                })}
              </div>
            </div>
          </Panel>

          {/* 每日维持费用（V2） */}
          <Panel
            title="每日维持费"
            hint={`最近 30 天 · 累计 −${stats.upkeepTotals?.charged ?? 0} 分`}
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.upkeepDaily ?? []} margin={{ top: 6, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={40} />
                <RTooltip content={<ChartTip unitMap={{ charged: "分维持费", bonus: "分奖励" }} />} />
                <Bar dataKey="charged" radius={[4, 4, 0, 0]} animationDuration={700} data-testid="bar-upkeep-fee">
                  {(stats.upkeepDaily ?? []).map((d) => (
                    <Cell
                      key={d.day}
                      fill={d.estimated ? "hsl(var(--warn) / 0.45)" : d.charged > 0 ? "hsl(var(--warn))" : "hsl(var(--success))"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-warn" />已结算的维持费
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-warn/45" />今日预估（今晚结算）
              </span>
              <span>全维达成 {stats.upkeepTotals?.allMetDays ?? 0} 天 · 累计奖励回补 +{stats.upkeepTotals?.bonus ?? 0} 分 · 净支出 {(stats.upkeepTotals?.net ?? 0) >= 0 ? "−" : "+"}{Math.abs(stats.upkeepTotals?.net ?? 0)} 分</span>
            </p>
          </Panel>

          {/* 达标度热力图（V2） */}
          <Panel title="达标度热力图" hint="最近 30 天 × 5 类别">
            <div className="overflow-x-auto scroll-thin pb-1">
              <div className="w-max">
                <div className="flex">
                  <div className="w-16 shrink-0" />
                  {(stats.upkeepHeatmap ?? []).map((d, i) => (
                    <span
                      key={d.day}
                      className="num w-4 shrink-0 text-center text-[9px] text-muted-foreground"
                    >
                      {i % 5 === 0 ? d.label.split("/")[1] : ""}
                    </span>
                  ))}
                </div>
                {CATEGORIES.map((c) => (
                  <div key={c.key} className="flex items-center">
                    <span className="w-16 shrink-0 truncate pr-1.5 text-[10px] text-muted-foreground" title={c.name}>
                      {c.name}
                    </span>
                    {(stats.upkeepHeatmap ?? []).map((d) => {
                      const cell = d.cells.find((x) => x.category === c.key);
                      const ratio = cell?.ratio ?? -1;
                      const bg =
                        ratio < 0
                          ? "hsl(var(--muted) / 0.5)"
                          : ratio >= 1
                            ? "hsl(var(--success))"
                            : `color-mix(in srgb, ${catColor(c.key)} ${Math.round(18 + 62 * ratio)}%, transparent)`;
                      return (
                        <span
                          key={d.day + c.key}
                          className={cn("m-[1px] h-3.5 w-3.5 shrink-0 rounded-[3px]", d.estimated && "ring-1 ring-warn/60")}
                          style={{ background: bg }}
                          title={`${d.day} · ${c.name} · ${ratio < 0 ? "无记录" : `达标度 ${Math.round(ratio * 100)}%`}${d.estimated ? "（今日预估）" : ""}`}
                          data-testid={`upkeep-heat-${c.key}-${d.day}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-success" />达标度 100%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-muted/50" />尚未结算
              </span>
              <span>颜色越深达标度越高 · 描边格为今日预估</span>
            </p>
          </Panel>

          {/* 日志 */}
          <Panel title="结算流水" hint="最近 200 条">
            {(logs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无记录。</p>
            ) : (
              <div className="max-h-80 overflow-y-auto scroll-thin">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-2 font-medium">日期</th>
                      <th className="py-2 pr-2 font-medium">任务</th>
                      <th className="py-2 pr-2 font-medium">类型</th>
                      <th className="py-2 pr-2 text-right font-medium">经验</th>
                      <th className="py-2 pr-2 text-right font-medium">积分</th>
                      <th className="py-2 text-right font-medium">时长</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(logs ?? []).map((l) => (
                      <tr key={l.id} className="border-b border-border/50" data-testid={`row-log-${l.id}`}>
                        <td className="num py-1.5 pr-2 whitespace-nowrap text-muted-foreground">{l.day.slice(5)}</td>
                        <td className="max-w-[10rem] truncate py-1.5 pr-2">{l.taskTitle}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground">
                          {KIND_LABEL[l.kind] ?? l.kind}
                        </td>
                        <td className="num py-1.5 pr-2 text-right">{l.xp > 0 ? `+${l.xp}` : l.xp}</td>
                        <td className="num py-1.5 pr-2 text-right">{l.points > 0 ? `+${l.points}` : l.points}</td>
                        <td className="num py-1.5 text-right text-muted-foreground">{l.minutes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, suffix, testId }: { label: string; value: number; suffix?: string; testId: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-3.5" data-testid={testId}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="num mt-1 text-lg font-bold leading-none">
        {value}
        {suffix && <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{suffix}</span>}
      </p>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function ChartTip({
  active,
  payload,
  label,
  unitMap,
  nameFormatter,
}: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-2 shadow-md">
      <p className="text-[11px] font-medium">{nameFormatter ? nameFormatter(label) : label}</p>
      <ul className="mt-1 space-y-0.5">
        {payload.map((p: any) => (
          <li key={p.dataKey} className="num flex items-center gap-1.5 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
            {p.value} {unitMap?.[p.dataKey] ?? ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
