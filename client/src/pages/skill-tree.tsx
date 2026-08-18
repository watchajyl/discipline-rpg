import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import type { Profile } from "@/lib/types";
import { Bar, CategoryChip, Num, PageHeader, SkeletonBlock, catColor } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, Lock, Sparkles, Coins } from "lucide-react";
import { CATEGORIES, SKILL_NODES, nodesForCategory, type SkillNode } from "@shared/gameRules";
import { cn } from "@/lib/utils";

export default function SkillTreePage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const { data: profile, isLoading } = useQuery<Profile>({ queryKey: ["/api/profile", userId] });
  const [selected, setSelected] = useState<SkillNode | null>(null);

  const unlock = useMutation({
    mutationFn: async (nodeId: string) => {
      await apiRequest("POST", "/api/skill-tree/unlock", { nodeId });
    },
    onSuccess: (_d, nodeId) => {
      const node = SKILL_NODES.find((n) => n.id === nodeId);
      invalidateAll(userId);
      toast({ title: `已解锁「${node?.name}」`, description: node?.desc });
    },
    onError: (e: any) =>
      toast({
        title: "无法解锁",
        description: String(e?.message ?? e).replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""),
        variant: "destructive",
      }),
  });

  const unlocked = new Set(profile?.unlockedNodes ?? []);
  const points = profile?.user.points ?? 0;

  function state(node: SkillNode): "unlocked" | "available" | "locked" {
    if (unlocked.has(node.id)) return "unlocked";
    const prev = SKILL_NODES.find((n) => n.category === node.category && n.slot === node.slot - 1);
    const prof = profile?.proficiency[node.category] ?? 0;
    const prevOk = !prev || unlocked.has(prev.id);
    if (prevOk && prof >= node.profRequired && points >= node.cost) return "available";
    return "locked";
  }

  function reason(node: SkillNode): string {
    const prev = SKILL_NODES.find((n) => n.category === node.category && n.slot === node.slot - 1);
    const prof = profile?.proficiency[node.category] ?? 0;
    if (prev && !unlocked.has(prev.id)) return `需要先解锁「${prev.name}」`;
    if (prof < node.profRequired) return `熟练度 ${prof} / ${node.profRequired}`;
    if (points < node.cost) return `积分 ${points} / ${node.cost}`;
    return "可解锁";
  }

  if (isLoading || !profile) {
    return (
      <div>
        <PageHeader title="成长树" desc="用积分兑换永久加成。" />
        <SkeletonBlock className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="成长树"
        desc={`五条分支共 ${SKILL_NODES.length} 个节点，已解锁 ${unlocked.size} 个。节点效果永久生效，需按顺序解锁并满足该类别熟练度门槛。`}
        actions={
          <Badge variant="secondary" className="num gap-1 px-2.5 py-1 text-sm">
            <Coins className="h-3.5 w-3.5" />
            {points}
          </Badge>
        }
      />

      {/* 桌面：径向布局 */}
      <div className="hidden overflow-x-auto rounded-2xl border border-card-border bg-card p-4 lg:block">
        <RadialTree
          profile={profile}
          state={state}
          reason={reason}
          onSelect={setSelected}
          selected={selected}
        />
      </div>

      {/* 移动：竖向列表 */}
      <div className="space-y-5 lg:hidden">
        {CATEGORIES.map((c) => {
          const prof = profile.proficiency[c.key] ?? 0;
          return (
            <section key={c.key} className="rounded-xl border border-card-border bg-card p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CategoryChip cat={c.key} />
                <span className="num text-xs text-muted-foreground">熟练度 {prof}</span>
              </div>
              <ul className="mt-3 space-y-2">
                {nodesForCategory(c.key).map((n) => {
                  const st = state(n);
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "rounded-lg border p-2.5",
                        st === "unlocked" ? "bg-background/60" : "border-border/70 bg-background/30",
                      )}
                      style={st === "unlocked" ? { borderColor: catColor(c.key) } : undefined}
                      data-testid={`node-mobile-${n.id}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px]"
                          style={
                            st === "unlocked"
                              ? { background: catColor(c.key), color: "hsl(var(--background))" }
                              : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
                          }
                        >
                          {st === "unlocked" ? <Check className="h-3.5 w-3.5" /> : <span className="num">{n.slot}</span>}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-tight">{n.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed break-words">{n.desc}</p>
                          <p className="num mt-1 text-[11px] text-muted-foreground">
                            需 {n.profRequired} 熟练度 · {n.cost} 积分
                          </p>
                        </div>
                      </div>
                      {st !== "unlocked" && (
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">{reason(n)}</span>
                          <Button
                            size="sm"
                            className="h-7 px-2.5 text-[11px]"
                            disabled={st !== "available" || unlock.isPending}
                            onClick={() => unlock.mutate(n.id)}
                            data-testid={`button-unlock-mobile-${n.id}`}
                          >
                            解锁
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {/* 选中节点详情（桌面） */}
      {selected && (
        <div className="mt-4 hidden rounded-xl border border-card-border bg-card p-4 lg:block">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CategoryChip cat={selected.category} />
                <p className="text-sm font-semibold">{selected.name}</p>
                <Badge variant="outline" className="num text-[11px]">
                  第 {selected.slot} 层
                </Badge>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{selected.desc}</p>
              <p className="num mt-1.5 text-xs text-muted-foreground">
                门槛 {selected.profRequired} 熟练度 · 花费 {selected.cost} 积分 · {reason(selected)}
              </p>
            </div>
            {state(selected) === "unlocked" ? (
              <Badge className="gap-1">
                <Check className="h-3.5 w-3.5" />
                已解锁
              </Badge>
            ) : (
              <Button
                disabled={state(selected) !== "available" || unlock.isPending}
                onClick={() => unlock.mutate(selected.id)}
                data-testid={`button-unlock-${selected.id}`}
              >
                <Sparkles className="mr-1 h-4 w-4" />
                花 {selected.cost} 积分解锁
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RadialTree({
  profile,
  state,
  reason,
  onSelect,
  selected,
}: {
  profile: Profile;
  state: (n: SkillNode) => "unlocked" | "available" | "locked";
  reason: (n: SkillNode) => string;
  onSelect: (n: SkillNode) => void;
  selected: SkillNode | null;
}) {
  const size = 720;
  const cx = size / 2;
  const cy = size / 2;
  const startR = 78;
  const stepR = 44;
  const labelR = startR + stepR * 5 + 40;

  return (
    <svg
      viewBox={`-80 -16 ${size + 160} ${size + 32}`}
      className="mx-auto h-auto w-full max-w-[800px]"
      role="img"
      aria-label="成长树"
    >
      {/* 中心 */}
      <circle cx={cx} cy={cy} r={54} fill="hsl(var(--muted))" opacity="0.55" />
      <circle cx={cx} cy={cy} r={54} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" opacity="0.5" />
      <text x={cx} y={cy - 6} textAnchor="middle" className="fill-foreground text-[13px] font-bold">
        Lv.{profile.level}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted-foreground text-[11px]">
        {profile.title}
      </text>

      {CATEGORIES.map((c, ci) => {
        const angle = (-90 + ci * 72) * (Math.PI / 180);
        const nodes = nodesForCategory(c.key);
        const color = catColor(c.key);
        const lx = cx + Math.cos(angle) * labelR;
        const ly = cy + Math.sin(angle) * labelR;
        return (
          <g key={c.key}>
            {/* 分支线 */}
            <line
              x1={cx + Math.cos(angle) * 54}
              y1={cy + Math.sin(angle) * 54}
              x2={cx + Math.cos(angle) * (startR + stepR * 5)}
              y2={cy + Math.sin(angle) * (startR + stepR * 5)}
              stroke={color}
              strokeWidth="1.2"
              opacity="0.28"
            />
            <text
              x={lx}
              y={ly + (Math.sin(angle) < -0.5 ? -4 : Math.sin(angle) > 0.5 ? 14 : 4)}
              textAnchor={Math.abs(Math.cos(angle)) < 0.2 ? "middle" : Math.cos(angle) > 0 ? "start" : "end"}
              className="text-[12px] font-semibold"
              fill={color}
            >
              {c.name}
            </text>
            {nodes.map((n, i) => {
              const r = startR + stepR * i;
              const x = cx + Math.cos(angle) * r;
              const y = cy + Math.sin(angle) * r;
              const st = state(n);
              const isSel = selected?.id === n.id;
              return (
                <Tooltip key={n.id}>
                  <TooltipTrigger asChild>
                    <g
                      className="cursor-pointer"
                      onClick={() => onSelect(n)}
                      data-testid={`node-${n.id}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${c.name} ${n.name}`}
                    >
                      {isSel && <circle cx={x} cy={y} r={20} fill={color} opacity="0.18" />}
                      <circle
                        cx={x}
                        cy={y}
                        r={14}
                        fill={st === "unlocked" ? color : "hsl(var(--card))"}
                        stroke={st === "locked" ? "hsl(var(--border))" : color}
                        strokeWidth={st === "available" ? 2 : 1.2}
                        strokeDasharray={st === "available" ? "3 2" : undefined}
                      />
                      {st === "unlocked" ? (
                        <text
                          x={x}
                          y={y + 4}
                          textAnchor="middle"
                          className="text-[11px] font-bold"
                          fill="hsl(var(--background))"
                        >
                          ✓
                        </text>
                      ) : (
                        <text
                          x={x}
                          y={y + 4}
                          textAnchor="middle"
                          className="text-[10px]"
                          fill={st === "available" ? color : "hsl(var(--muted-foreground))"}
                        >
                          {n.slot}
                        </text>
                      )}
                    </g>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56">
                    <p className="text-xs font-semibold">{n.name}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed">{n.desc}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{reason(n)}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
