import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus, Trash2, Wand2, Loader2 } from "lucide-react";
import { CATEGORIES, MODES, DIFFICULTIES, categoryName, ruleSuggest } from "@shared/gameRules";
import type { TaskFull, Suggestion } from "@/lib/types";
import { Num } from "./bits";

type FormState = {
  title: string;
  category: string;
  mode: string;
  difficulty: number;
  xpPerUnit: number;
  pointsPerUnit: number;
  profPerUnit: number;
  notes: string;
  startDate: string;
  endDate: string;
  blockMinutes: number;
  dailyTargetBlocks: number;
  milestones: { id: string; title: string; weight: number; done: boolean }[];
  period: "daily" | "weekly";
  targetPerPeriod: number;
  unitName: string;
  targetCount: number;
};

function initial(task?: TaskFull | null): FormState {
  if (task) {
    return {
      title: task.title,
      category: task.category,
      mode: task.mode,
      difficulty: task.difficulty,
      xpPerUnit: task.xpPerUnit,
      pointsPerUnit: task.pointsPerUnit,
      profPerUnit: task.profPerUnit,
      notes: task.notes,
      startDate: task.startDate,
      endDate: task.endDate,
      blockMinutes: task.blockMinutes,
      dailyTargetBlocks: task.dailyTargetBlocks,
      milestones: task.milestones,
      period: task.period as "daily" | "weekly",
      targetPerPeriod: task.targetPerPeriod,
      unitName: task.unitName,
      targetCount: task.targetCount,
    };
  }
  const r = ruleSuggest("academic", "timer");
  return {
    title: "",
    category: "academic",
    mode: "timer",
    difficulty: 2,
    xpPerUnit: r.xpPerUnit,
    pointsPerUnit: r.pointsPerUnit,
    profPerUnit: r.profPerUnit,
    notes: "",
    startDate: "",
    endDate: "",
    blockMinutes: r.blockMinutes ?? 25,
    dailyTargetBlocks: r.dailyTargetBlocks ?? 2,
    milestones: [],
    period: "daily",
    targetPerPeriod: 1,
    unitName: "次",
    targetCount: 10,
  };
}

export function TaskFormSheet({
  open,
  onOpenChange,
  task,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task?: TaskFull | null;
}) {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(initial(task));
  const [goal, setGoal] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial(task));
      setSuggestion(null);
      setGoal("");
    }
  }, [open, task?.id]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const suggest = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/suggest", {
        title: form.title,
        category: form.category,
        mode: form.mode,
        goal,
      });
      return (await res.json()) as Suggestion;
    },
    onSuccess: (data) => {
      setSuggestion(data);
      if (data.notice) toast({ title: "建议已生成", description: data.notice });
    },
    onError: (e: any) => toast({ title: "建议获取失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        milestones: form.milestones.map((m, i) => ({
          id: m.id || `m${i + 1}`,
          title: m.title,
          weight: Number(m.weight) || 1,
          done: m.done ?? false,
        })),
      };
      if (task) {
        await apiRequest("PATCH", `/api/tasks/${task.id}`, { task: payload });
      } else {
        await apiRequest("POST", "/api/tasks", { task: payload });
      }
    },
    onSuccess: () => {
      invalidateAll(userId);
      toast({ title: task ? "任务已更新" : "任务已创建", description: form.title });
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({
        title: "保存失败",
        description: String(e?.message ?? e).replace(/^\d+:\s*/, ""),
        variant: "destructive",
      }),
  });

  function applyAll() {
    if (!suggestion) return;
    setForm((f) => ({
      ...f,
      difficulty: suggestion.difficulty ?? f.difficulty,
      xpPerUnit: suggestion.xpPerUnit ?? f.xpPerUnit,
      pointsPerUnit: suggestion.pointsPerUnit ?? f.pointsPerUnit,
      profPerUnit: suggestion.profPerUnit ?? f.profPerUnit,
      blockMinutes: suggestion.blockMinutes ?? f.blockMinutes,
      dailyTargetBlocks: suggestion.dailyTargetBlocks ?? f.dailyTargetBlocks,
      period: (suggestion.period as any) ?? f.period,
      targetPerPeriod: suggestion.targetPerPeriod ?? f.targetPerPeriod,
      targetCount: suggestion.targetCount ?? f.targetCount,
      unitName: suggestion.unitName ?? f.unitName,
      milestones:
        f.mode === "milestone" && suggestion.milestones?.length
          ? suggestion.milestones.map((t, i) => ({ id: `m${i + 1}`, title: t, weight: 1, done: false }))
          : f.milestones,
    }));
    toast({ title: "已全部采纳", description: "所有字段仍可继续手改。" });
  }

  const fieldRows: { label: string; key: keyof FormState; value?: number | string }[] = suggestion
    ? [
        { label: "难度", key: "difficulty", value: suggestion.difficulty },
        { label: "单份经验", key: "xpPerUnit", value: suggestion.xpPerUnit },
        { label: "单份积分", key: "pointsPerUnit", value: suggestion.pointsPerUnit },
        { label: "单份熟练度", key: "profPerUnit", value: suggestion.profPerUnit },
        ...(form.mode === "timer"
          ? ([
              { label: "专注块分钟", key: "blockMinutes" as const, value: suggestion.blockMinutes },
              { label: "每日目标块", key: "dailyTargetBlocks" as const, value: suggestion.dailyTargetBlocks },
            ] as any)
          : []),
        ...(form.mode === "habit"
          ? ([
              { label: "周期", key: "period" as const, value: suggestion.period },
              { label: "每周期次数", key: "targetPerPeriod" as const, value: suggestion.targetPerPeriod },
            ] as any)
          : []),
        ...(form.mode === "count"
          ? ([
              { label: "单位名称", key: "unitName" as const, value: suggestion.unitName },
              { label: "目标数量", key: "targetCount" as const, value: suggestion.targetCount },
            ] as any)
          : []),
      ].filter((r) => r.value !== undefined && r.value !== null)
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto scroll-thin sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-xl">{task ? "编辑任务" : "新建任务"}</SheetTitle>
          <SheetDescription className="leading-relaxed">
            先选类别与结算模式，再用 AI 建议给出参数起点，所有数值都可以手改。
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5 pb-6">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">任务标题</Label>
            <Input
              id="task-title"
              value={form.title}
              placeholder="例如：博士论文第三章写作"
              onChange={(e) => set("title", e.target.value)}
              data-testid="input-task-title"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>类别</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger data-testid="select-task-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>结算模式</Label>
              <Select value={form.mode} onValueChange={(v) => set("mode", v)} disabled={!!task}>
                <SelectTrigger data-testid="select-task-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {MODES.find((m) => m.key === form.mode)?.desc}
            {task ? "（已创建的任务不可更换模式）" : ""}
          </p>

          {/* AI 建议 */}
          <div className="rounded-xl border border-border bg-muted/40 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI 参数建议
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                  {user?.aiConfigured
                    ? "已配置 API Key，将调用你的模型生成个性化规划。"
                    : "当前使用内置规则，配置 API Key 可获得个性化深度规划。"}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={suggest.isPending}
                onClick={() => suggest.mutate()}
                data-testid="button-ai-suggest"
              >
                {suggest.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                )}
                获取建议
              </Button>
            </div>
            <Textarea
              className="mt-2.5 min-h-[64px]"
              placeholder="简要描述你的目标，例如：三个月内完成第三章并投出去"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              data-testid="input-ai-goal"
            />
            {suggestion && (
              <div className="mt-3 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={suggestion.source === "ai" ? "default" : "secondary"} className="text-[11px]">
                    {suggestion.source === "ai" ? "模型生成" : "内置规则"}
                  </Badge>
                  <Button size="sm" variant="outline" onClick={applyAll} data-testid="button-apply-all">
                    全部采纳
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{suggestion.reason}</p>
                <ul className="space-y-1">
                  {fieldRows.map((r) => (
                    <li
                      key={String(r.key)}
                      className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5"
                    >
                      <span className="text-xs text-muted-foreground">{r.label}</span>
                      <span className="flex items-center gap-2">
                        <Num className="text-xs font-semibold">
                          {r.key === "period" ? (r.value === "weekly" ? "每周" : "每日") : String(r.value)}
                        </Num>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => set(r.key, r.value as any)}
                          data-testid={`button-adopt-${String(r.key)}`}
                        >
                          采纳
                        </Button>
                      </span>
                    </li>
                  ))}
                  {form.mode === "milestone" && suggestion.milestones?.length > 0 && (
                    <li className="rounded-md bg-background/70 px-2 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">里程碑拆解建议</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() =>
                            set(
                              "milestones",
                              suggestion.milestones.map((t, i) => ({
                                id: `m${i + 1}`,
                                title: t,
                                weight: 1,
                                done: false,
                              })),
                            )
                          }
                          data-testid="button-adopt-milestones"
                        >
                          采纳
                        </Button>
                      </div>
                      <ul className="mt-1 space-y-0.5 text-xs leading-relaxed">
                        {suggestion.milestones.map((m, i) => (
                          <li key={i} className="text-muted-foreground break-words">
                            {i + 1}. {m}
                          </li>
                        ))}
                      </ul>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* 模式专属字段 */}
          {form.mode === "timer" && (
            <div className="grid grid-cols-2 gap-3">
              <NumField label="专注块分钟" value={form.blockMinutes} onChange={(v) => set("blockMinutes", v)} testId="input-block-minutes" />
              <NumField label="每日目标块数" value={form.dailyTargetBlocks} onChange={(v) => set("dailyTargetBlocks", v)} testId="input-daily-blocks" />
            </div>
          )}

          {form.mode === "habit" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>打卡周期</Label>
                <Select value={form.period} onValueChange={(v) => set("period", v as any)}>
                  <SelectTrigger data-testid="select-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">每日</SelectItem>
                    <SelectItem value="weekly">每周</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumField label="每周期次数" value={form.targetPerPeriod} onChange={(v) => set("targetPerPeriod", v)} testId="input-target-per-period" />
            </div>
          )}

          {form.mode === "count" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="unit-name">单位名称</Label>
                <Input
                  id="unit-name"
                  value={form.unitName}
                  onChange={(e) => set("unitName", e.target.value)}
                  placeholder="个单词 / 份简历"
                  data-testid="input-unit-name"
                />
              </div>
              <NumField label="目标数量" value={form.targetCount} onChange={(v) => set("targetCount", v)} testId="input-target-count" />
            </div>
          )}

          {form.mode === "milestone" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>里程碑节点</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    set("milestones", [
                      ...form.milestones,
                      { id: `m${form.milestones.length + 1}_${Date.now()}`, title: "", weight: 1, done: false },
                    ])
                  }
                  data-testid="button-add-milestone"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  添加节点
                </Button>
              </div>
              {form.milestones.length === 0 && (
                <p className="text-xs text-muted-foreground">还没有节点，可先获取 AI 建议再采纳拆解。</p>
              )}
              <ul className="space-y-2">
                {form.milestones.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <Input
                      value={m.title}
                      placeholder={`节点 ${i + 1}`}
                      onChange={(e) => {
                        const next = [...form.milestones];
                        next[i] = { ...m, title: e.target.value };
                        set("milestones", next);
                      }}
                      data-testid={`input-milestone-${i}`}
                    />
                    <Input
                      type="number"
                      min={1}
                      className="num w-16 shrink-0"
                      value={m.weight}
                      onChange={(e) => {
                        const next = [...form.milestones];
                        next[i] = { ...m, weight: Number(e.target.value) || 1 };
                        set("milestones", next);
                      }}
                      data-testid={`input-milestone-weight-${i}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0"
                      aria-label="删除节点"
                      onClick={() => set("milestones", form.milestones.filter((_, idx) => idx !== i))}
                      data-testid={`button-remove-milestone-${i}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">右侧数字为权重，勾选该节点将按权重占比发放总奖励。</p>
            </div>
          )}

          {/* 通用数值 */}
          <div className="space-y-1.5">
            <Label>难度系数</Label>
            <Select value={String(form.difficulty)} onValueChange={(v) => set("difficulty", Number(v))}>
              <SelectTrigger data-testid="select-difficulty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIFFICULTIES.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.name} ×{d.mul}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <NumField label="单份经验" value={form.xpPerUnit} onChange={(v) => set("xpPerUnit", v)} testId="input-xp-per-unit" />
            <NumField label="单份积分" value={form.pointsPerUnit} onChange={(v) => set("pointsPerUnit", v)} testId="input-points-per-unit" />
            <NumField label="单份熟练" value={form.profPerUnit} onChange={(v) => set("profPerUnit", v)} testId="input-prof-per-unit" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start-date">开始日期</Label>
              <Input
                id="start-date"
                type="date"
                className="num"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-date">截止日期</Label>
              <Input
                id="end-date"
                type="date"
                className="num"
                value={form.endDate}
                onChange={(e) => set("endDate", e.target.value)}
                data-testid="input-end-date"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-notes">备注</Label>
            <Textarea
              id="task-notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="补充说明、执行要点等"
              data-testid="input-task-notes"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              className="flex-1"
              disabled={!form.title.trim() || save.isPending}
              onClick={() => save.mutate()}
              data-testid="button-save-task"
            >
              {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {task ? "保存修改" : "创建任务"}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-task">
              取消
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            当前配置：{categoryName(form.category)} · 单份 <Num>{form.xpPerUnit}</Num> XP
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NumField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  testId: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={testId} className="block text-xs leading-tight">
        {label}
      </Label>
      <Input
        id={testId}
        type="number"
        min={0}
        className="num"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        data-testid={testId}
      />
    </div>
  );
}
