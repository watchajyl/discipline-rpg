import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApp, invalidateAll } from "@/lib/app-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Profile, TaskFull } from "@/lib/types";
import { Bar, CategoryChip, EmptyState, Num, PageHeader, Ring, SkeletonBlock, catColor, formatMinutes } from "@/components/bits";
import { TaskCard } from "@/components/task-card";
import { TaskFormSheet } from "@/components/task-form";
import { UpkeepCard } from "@/components/upkeep-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Flame,
  Trophy,
  Sparkles,
  ListTodo,
  Clock,
  Coins,
  AlertCircle,
  Download,
  X,
} from "lucide-react";
import { CATEGORIES, MOTIVATION, categoryName, dateKey, levelTitle, proficiencyTier } from "@shared/gameRules";
import { ACHIEVEMENTS, RARITY_META, achievementById } from "@shared/achievements";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import * as Icons from "lucide-react";

export default function TodayPage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { data: profile, isLoading: pLoading } = useQuery<Profile>({ queryKey: ["/api/profile", userId] });
  const { data: tasks, isLoading: tLoading } = useQuery<TaskFull[]>({ queryKey: ["/api/tasks", userId] });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskFull | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [backupHidden, setBackupHidden] = useState(false);
  const { toast } = useToast();

  const doExport = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", `/api/export/${userId}`);
      return await res.json();
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `discipline-rpg-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      invalidateAll(userId);
      toast({ title: "已导出 JSON 备份" });
    },
    onError: () => toast({ title: "导出失败", variant: "destructive" }),
  });

  const active = useMemo(() => (tasks ?? []).filter((t) => t.archived === 0), [tasks]);

  const atRisk = useMemo(
    () =>
      active.filter(
        (t) => t.mode === "habit" && t.effectiveStreak >= 3 && t.periodCheckins < t.targetPerPeriod,
      ),
    [active],
  );

  const grouped = useMemo(() => {
    const map: Record<string, TaskFull[]> = {};
    for (const c of CATEGORIES) map[c.key] = [];
    for (const t of active) map[t.category]?.push(t);
    return map;
  }, [active]);

  const topStreaks = useMemo(
    () =>
      active
        .filter((t) => t.mode === "habit")
        .sort((a, b) => b.effectiveStreak - a.effectiveStreak)
        .slice(0, 3),
    [active],
  );

  const recentAchievements = (profile?.unlockedAchievements ?? []).slice(-4).reverse();

  const motivation = !active.length
    ? MOTIVATION.empty
    : (profile?.today.settlements ?? 0) === 0
      ? MOTIVATION.noneToday
      : (profile?.today.settlements ?? 0) >= 3
        ? MOTIVATION.strong(profile!.today.settlements)
        : MOTIVATION.started(profile!.today.settlements);

  return (
    <div>
      <PageHeader
        title="今日面板"
        desc={`${new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })} · ${motivation}`}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="button-new-task"
          >
            <Plus className="mr-1 h-4 w-4" />
            新建任务
          </Button>
        }
      />

      {/* 今日维持（V2） */}
      <UpkeepCard />

      {/* 备份提醒 */}
      {profile?.backup?.due && !backupHidden && (
        <div
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-chart-4/40 bg-chart-4/10 p-3.5"
          data-testid="card-backup-reminder"
        >
          <Download className="h-4 w-4 shrink-0 text-chart-4" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed">建议导出一份备份，数据只保存在本浏览器中</p>
          <Button
            size="sm"
            onClick={() => doExport.mutate()}
            disabled={doExport.isPending}
            data-testid="button-backup-now"
          >
            立即导出
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            aria-label="稍后提醒"
            data-testid="button-dismiss-backup"
            onClick={() => setBackupHidden(true)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* 状态面板 */}
      {pLoading || !profile ? (
        <SkeletonBlock className="h-40 w-full" />
      ) : (
        <section className="rounded-2xl border border-card-border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-3.5">
              <Ring ratio={profile.ratio} size={82} stroke={7} label="等级进度">
                <span className="num text-lg font-bold leading-none" data-testid="text-level">
                  {profile.level}
                </span>
                <span className="mt-0.5 text-[10px] text-muted-foreground">LEVEL</span>
              </Ring>
              <div className="min-w-0">
                <p className="text-base font-bold leading-tight" data-testid="text-level-title">
                  {profile.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Num className="text-foreground">{profile.xpInLevel}</Num> /{" "}
                  <Num>{profile.xpForLevel}</Num> XP 到 Lv.
                  <Num>{profile.level + 1}</Num> {levelTitle(profile.level + 1)}
                </p>
                <div className="mt-2 w-40 max-w-full">
                  <Bar ratio={profile.ratio} height={6} />
                </div>
              </div>
            </div>

            <div className="flex flex-1 flex-wrap items-center gap-4">
              <div className="rounded-xl border border-border bg-background/60 px-3.5 py-2.5">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Coins className="h-3.5 w-3.5 text-cat-finance" />
                  可用积分
                </p>
                <p className="num mt-0.5 text-lg font-bold" data-testid="text-points">
                  {profile.user.points}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background/60 px-3.5 py-2.5">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  累计专注
                </p>
                <p className="num mt-0.5 text-lg font-bold">
                  {(profile.snapshot.totalFocusMinutes / 60).toFixed(1)}
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">小时</span>
                </p>
              </div>
            </div>
          </div>

          {/* 五类熟练度小环 */}
          <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-border/70 pt-4 sm:grid-cols-3 lg:grid-cols-5">
            {CATEGORIES.map((c) => {
              const value = profile.proficiency[c.key] ?? 0;
              const tier = proficiencyTier(value);
              return (
                <div
                  key={c.key}
                  className="flex items-center gap-2.5 rounded-xl border border-border bg-background/50 px-2.5 py-2"
                  data-testid={`card-prof-${c.key}`}
                >
                  <Ring ratio={tier.ratio} size={42} stroke={4} color={`hsl(var(${c.colorVar}))`}>
                    <span className="num text-[10px] font-bold leading-none">{tier.index + 1}</span>
                  </Ring>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{c.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {tier.name} · <Num>{value}</Num>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 回归卡片 */}
      {profile && profile.inactiveDays >= 3 && (
        <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-4">
          <p className="text-sm font-semibold text-warn">欢迎回来</p>
          <p className="mt-1 text-sm leading-relaxed">
            已经 <Num>{profile.inactiveDays}</Num> 天没有产出了，你的{profile.topProfCategoryName}熟练度还在等着往上走。
            先做一件最小的事就行。
          </p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-5">
          {/* 即将断签 */}
          {atRisk.length > 0 && (
            <section>
              <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-warn">
                <AlertCircle className="h-4 w-4" />
                即将断签（{atRisk.length}）
              </h2>
              <div className="space-y-3">
                {atRisk.map((t) => (
                  <div key={t.id} className="rounded-xl ring-1 ring-warn/40">
                    <TaskCard task={t} onEdit={(x) => { setEditing(x); setFormOpen(true); }} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 今日待办 */}
          <section>
            <h2 className="mb-2.5 text-sm font-semibold">今日待办</h2>
            {tLoading ? (
              <div className="space-y-3">
                <SkeletonBlock className="h-32 w-full" />
                <SkeletonBlock className="h-32 w-full" />
              </div>
            ) : active.length === 0 ? (
              <EmptyState
                icon={ListTodo}
                title="还没有任务"
                desc="先立一件今天就能做的小事：一个 25 分钟专注块、一次打卡，或者一个可以勾掉的里程碑节点。"
                action={
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setFormOpen(true);
                    }}
                    data-testid="button-empty-create"
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    创建第一个任务
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {CATEGORIES.filter((c) => grouped[c.key].length > 0).map((c) => {
                  const isCollapsed = collapsed[c.key];
                  return (
                    <div key={c.key}>
                      <button
                        className="mb-2 flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover-elevate"
                        onClick={() => setCollapsed((s) => ({ ...s, [c.key]: !s[c.key] }))}
                        data-testid={`button-collapse-${c.key}`}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                        <CategoryChip cat={c.key} />
                        <span className="num text-xs text-muted-foreground">{grouped[c.key].length}</span>
                      </button>
                      {!isCollapsed && (
                        <div className="space-y-3">
                          {grouped[c.key].map((t) => (
                            <TaskCard
                              key={t.id}
                              task={t}
                              onEdit={(x) => {
                                setEditing(x);
                                setFormOpen(true);
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* 右侧栏 */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-card-border bg-card p-4">
            <p className="text-sm font-semibold">今日战绩</p>
            <dl className="mt-3 space-y-2.5">
              <Stat label="获得经验" value={`${profile?.today.xp ?? 0}`} suffix="XP" testId="text-today-xp" />
              <Stat label="获得积分" value={`${profile?.today.points ?? 0}`} suffix="分" testId="text-today-points" />
              <Stat
                label="专注时长"
                value={formatMinutes(profile?.today.minutes ?? 0)}
                testId="text-today-minutes"
              />
              <Stat label="结算次数" value={`${profile?.today.settlements ?? 0}`} suffix="次" testId="text-today-settlements" />
            </dl>
            {(profile?.today.categories.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/70 pt-3">
                {profile!.today.categories.map((c) => (
                  <CategoryChip key={c} cat={c} />
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-card-border bg-card p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Flame className="h-4 w-4 text-cat-life" />
              连续最长
            </p>
            {topStreaks.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                还没有打卡类任务。周期打卡最容易积累连续加成，最高可到 ×1.6。
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {topStreaks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs">{t.title}</span>
                    <Badge variant="secondary" className="num shrink-0 text-[11px]">
                      {t.effectiveStreak} {t.period === "weekly" ? "周" : "天"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-card-border bg-card p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Trophy className="h-4 w-4 text-cat-finance" />
              最近解锁
            </p>
            {recentAchievements.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                还没有解锁成就。共 <Num>{ACHIEVEMENTS.length}</Num> 条等着被点亮。
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {recentAchievements.map((id) => {
                  const a = achievementById(id);
                  if (!a) return null;
                  const Icon = (Icons as any)[a.icon] ?? Sparkles;
                  const rarity = RARITY_META[a.rarity];
                  return (
                    <li key={id} className="flex items-center gap-2">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                        style={{ background: `hsl(${rarity.hsl} / 0.16)`, color: `hsl(${rarity.hsl})` }}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{a.name}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{rarity.name}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              href="/achievements"
              className="mt-3 block text-xs text-primary underline-offset-4 hover:underline"
              data-testid="link-all-achievements"
            >
              查看全部成就 →
            </Link>
          </div>
        </aside>
      </div>

      <TaskFormSheet open={formOpen} onOpenChange={setFormOpen} task={editing} />
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  testId,
}: {
  label: string;
  value: string;
  suffix?: string;
  testId?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="num text-sm font-semibold" data-testid={testId}>
        {value}
        {suffix && <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{suffix}</span>}
      </dd>
    </div>
  );
}
