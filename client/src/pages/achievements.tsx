import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import type { Profile } from "@/lib/types";
import { Bar, Num, PageHeader, SkeletonBlock } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import * as Icons from "lucide-react";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_GROUPS,
  RARITY_META,
  achievementProgress,
  type Achievement,
} from "@shared/achievements";
import { cn } from "@/lib/utils";

const GROUP_DESC: Record<string, string> = {
  proficiency: "五大类别熟练度层级突破",
  invest: "累计专注时长里程碑",
  persist: "连续打卡与均衡投入",
  growth: "等级成长节点",
};

const FILTERS = [
  { key: "all", name: "全部" },
  { key: "unlocked", name: "已解锁" },
  { key: "locked", name: "未解锁" },
] as const;

export default function AchievementsPage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { data: profile, isLoading } = useQuery<Profile>({ queryKey: ["/api/profile", userId] });
  const [filter, setFilter] = useState<"all" | "unlocked" | "locked">("all");
  const [rarity, setRarity] = useState<string>("all");

  const unlocked = new Set(profile?.unlockedAchievements ?? []);
  const total = ACHIEVEMENTS.length;
  const done = ACHIEVEMENTS.filter((a) => unlocked.has(a.id)).length;

  const rarityStats = useMemo(() => {
    return (Object.keys(RARITY_META) as (keyof typeof RARITY_META)[]).map((r) => ({
      key: r,
      meta: RARITY_META[r],
      total: ACHIEVEMENTS.filter((a) => a.rarity === r).length,
      done: ACHIEVEMENTS.filter((a) => a.rarity === r && unlocked.has(a.id)).length,
    }));
  }, [profile]);

  function visible(list: Achievement[]) {
    return list.filter((a) => {
      const isDone = unlocked.has(a.id);
      if (filter === "unlocked" && !isDone) return false;
      if (filter === "locked" && isDone) return false;
      if (rarity !== "all" && a.rarity !== rarity) return false;
      return true;
    });
  }

  return (
    <div>
      <PageHeader
        title="成就墙"
        desc={`已点亮 ${done} / ${total} 条成就。解锁成就会按稀有度直接发放积分奖励。`}
      />

      {isLoading || !profile ? (
        <SkeletonBlock className="h-24 w-full" />
      ) : (
        <section className="rounded-2xl border border-card-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="num text-2xl font-bold leading-none" data-testid="text-achievement-count">
                {done}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ {total}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">总完成度 {Math.round((done / total) * 100)}%</p>
            </div>
            <div className="w-full max-w-xs">
              <Bar ratio={done / total} height={8} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/70 pt-4 sm:grid-cols-4">
            {rarityStats.map((r) => (
              <div key={r.key} className="rounded-lg border border-border bg-background/50 px-2.5 py-2">
                <p className="flex items-center gap-1.5 text-[11px]" style={{ color: `hsl(${r.meta.hsl})` }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${r.meta.hsl})` }} />
                  {r.meta.name}
                </p>
                <p className="num mt-0.5 text-sm font-semibold">
                  {r.done}
                  <span className="text-xs font-normal text-muted-foreground"> / {r.total}</span>
                </p>
                <p className="text-[10px] text-muted-foreground">
                  奖励 <Num>{r.meta.reward}</Num> 积分
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Pill key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)} testId={`filter-${f.key}`}>
            {f.name}
          </Pill>
        ))}
        <span className="mx-1 hidden w-px self-stretch bg-border sm:block" />
        <Pill active={rarity === "all"} onClick={() => setRarity("all")} testId="filter-rarity-all">
          全部稀有度
        </Pill>
        {(Object.keys(RARITY_META) as (keyof typeof RARITY_META)[]).map((r) => (
          <Pill key={r} active={rarity === r} onClick={() => setRarity(r)} testId={`filter-rarity-${r}`}>
            {RARITY_META[r].name}
          </Pill>
        ))}
      </div>

      <div className="mt-5 space-y-7">
        {ACHIEVEMENT_GROUPS.map((g) => {
          const list = visible(ACHIEVEMENTS.filter((a) => a.group === g.key));
          if (list.length === 0) return null;
          return (
            <section key={g.key}>
              <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
                <h2 className="text-sm font-semibold">{g.name}</h2>
                <span className="text-xs text-muted-foreground">
                  {GROUP_DESC[g.key]} · 共 {ACHIEVEMENTS.filter((a) => a.group === g.key).length} 条
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((a) => (
                  <AchievementCard
                    key={a.id}
                    a={a}
                    unlocked={unlocked.has(a.id)}
                    progress={
                      profile
                        ? achievementProgress(a, profile.snapshot as any)
                        : { current: 0, target: 1, label: "" }
                    }
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function AchievementCard({
  a,
  unlocked,
  progress,
}: {
  a: Achievement;
  unlocked: boolean;
  progress: { current: number; target: number; label: string };
}) {
  const Icon = (Icons as any)[a.icon] ?? Icons.Award;
  const meta = RARITY_META[a.rarity];
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-shadow",
        unlocked ? "bg-card shadow-sm" : "border-border/70 bg-card/50",
      )}
      style={unlocked ? { borderColor: `hsl(${meta.hsl} / 0.45)` } : undefined}
      data-testid={`card-achievement-${a.id}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={
            unlocked
              ? { background: `hsl(${meta.hsl} / 0.16)`, color: `hsl(${meta.hsl})` }
              : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
          }
        >
          {unlocked ? <Icon className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={cn("text-sm font-semibold leading-tight", !unlocked && "text-muted-foreground")}>{a.name}</p>
            <Badge
              variant="outline"
              className="shrink-0 text-[10px]"
              style={{ color: `hsl(${meta.hsl})`, borderColor: `hsl(${meta.hsl} / 0.4)` }}
            >
              {meta.name}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed break-words">{a.desc}</p>
          <div className="mt-2 flex items-center gap-2">
            <Bar
              ratio={unlocked ? 1 : progress.target > 0 ? progress.current / progress.target : 0}
              height={5}
              color={unlocked ? `hsl(${meta.hsl})` : "hsl(var(--primary))"}
            />
            <span className="num shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
              {progress.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground hover-elevate",
      )}
    >
      {children}
    </button>
  );
}
