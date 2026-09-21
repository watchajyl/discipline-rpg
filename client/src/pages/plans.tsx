import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/bits";
import { Sparkles, NotebookPen, ClipboardList, Loader2, Plus, CheckCircle2 } from "lucide-react";
import { categoryName, modeName, repeatName, metricName } from "@shared/gameRules";

type JournalEntry = {
  id: number;
  kind: "review" | "plan";
  period: "daily" | "weekly";
  periodKey: string;
  content: string;
  aiFeedback?: string;
  aiPlan?: string;
  createdAt: number;
  updatedAt?: number;
};

type AiReview = {
  feedback: string;
  tomorrowFocus: string;
  suggestedAdjustments: string;
  source: string;
  notice?: string;
};

type PlanTask = {
  title: string;
  category: string;
  mode: string;
  repeat: "none" | "daily" | "weekly";
  targetMetric: "checkin" | "count" | "blocks";
  targetAmount: number;
  priority: number;
  deadline: string;
  difficulty: number;
  xpPerUnit: number;
  pointsPerUnit: number;
  profPerUnit: number;
  unitName: string;
  reason: string;
};

type PlanResult = { summary: string; tasks: PlanTask[]; source: string; notice?: string };

function parseReview(raw?: string): AiReview | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AiReview;
  } catch {
    return null;
  }
}

function parsePlan(raw?: string): PlanResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlanResult;
  } catch {
    return null;
  }
}

function periodLabel(period: string) {
  return period === "weekly" ? "每周" : "每日";
}

export default function PlansPage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const { data: journals, isLoading } = useQuery<JournalEntry[]>({ queryKey: ["/api/journals", userId] });
  const [tab, setTab] = useState<"review" | "plan">("review");
  const [period, setPeriod] = useState<"daily" | "weekly">("daily");
  const [content, setContent] = useState("");

  function invalidate() {
    invalidateAll(userId);
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/journals", { kind: tab, period, content });
      return (await res.json()) as JournalEntry;
    },
    onSuccess: () => {
      invalidate();
      setContent("");
      toast({ title: tab === "review" ? "复盘已保存" : "规划已保存" });
    },
    onError: (e: any) => toast({ title: "保存失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const review = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/journals/${id}/ai-review`, {});
      return (await res.json()) as AiReview;
    },
    onSuccess: (data) => {
      invalidate();
      if (data.notice) toast({ title: "复盘完成", description: data.notice });
    },
    onError: (e: any) => toast({ title: "复盘失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const decompose = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/journals/${id}/ai-decompose`, {});
      return (await res.json()) as PlanResult;
    },
    onSuccess: (data) => {
      invalidate();
      if (data.notice) toast({ title: "拆解完成", description: data.notice });
    },
    onError: (e: any) => toast({ title: "拆解失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const createTask = useMutation({
    mutationFn: async (t: PlanTask) => {
      const payload = {
        title: t.title,
        category: t.category,
        mode: t.mode,
        difficulty: t.difficulty || 2,
        xpPerUnit: t.xpPerUnit || 20,
        pointsPerUnit: t.pointsPerUnit || 15,
        profPerUnit: t.profPerUnit || 15,
        milestones: [],
        period: t.repeat === "weekly" ? "weekly" : "daily",
        targetPerPeriod: t.targetMetric === "checkin" ? t.targetAmount : 1,
        blockMinutes: 25,
        dailyTargetBlocks: 2,
        unitName: t.unitName || "次",
        targetCount: t.targetMetric === "count" ? t.targetAmount : 10,
        repeat: t.repeat,
        targetMetric: t.targetMetric,
        targetAmount: t.targetAmount || 1,
        finishOnTarget: t.repeat === "none" ? 1 : 0,
        priority: t.priority ?? 2,
        deadline: t.deadline || "",
      };
      const res = await apiRequest("POST", "/api/tasks", { task: payload });
      return await res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "任务已创建" });
    },
    onError: (e: any) => toast({ title: "创建失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const entries = (journals ?? []).filter((j) => j.kind === tab);
  const reviewEntries = (journals ?? []).filter((j) => j.kind === "review");
  const planEntries = (journals ?? []).filter((j) => j.kind === "plan");

  return (
    <div>
      <PageHeader
        title="复盘与规划"
        desc="用文本记下今天／这周做了什么，或写下未来打算；AI 帮你复盘、排优先级并拆成可执行任务。"
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(["review", "plan"] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={tab === k ? "default" : "outline"}
            onClick={() => setTab(k)}
            data-testid={`tab-${k}`}
          >
            {k === "review" ? <NotebookPen className="mr-1 h-3.5 w-3.5" /> : <ClipboardList className="mr-1 h-3.5 w-3.5" />}
            {k === "review" ? `复盘（${reviewEntries.length}）` : `未来规划（${planEntries.length}）`}
          </Button>
        ))}
      </div>

      <section className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:max-w-[10rem]">
            <Label>周期</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as "daily" | "weekly")}>
              <SelectTrigger data-testid="select-journal-period" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">每日</SelectItem>
                <SelectItem value="weekly">每周</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="journal-content">{tab === "review" ? "今天／这周做了什么" : "未来打算做什么、想怎么拆"}</Label>
            <Textarea
              id="journal-content"
              className="min-h-[96px]"
              placeholder={
                tab === "review"
                  ? "完成了什么、花了多久、卡在哪里、明天想调整什么…"
                  : "写下目标、截止时间和你初步的拆解想法，AI 会帮你排优先级…"
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              data-testid="input-journal-content"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!content.trim() || save.isPending}
                onClick={() => save.mutate()}
                data-testid="button-save-journal"
              >
                {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                保存
              </Button>
            </div>
          </div>
        </div>
      </section>

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">正在载入记录…</p>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={tab === "review" ? NotebookPen : ClipboardList}
          title={tab === "review" ? "还没有复盘记录" : "还没有规划记录"}
          desc="保存一条记录后，AI 会基于它和你的任务、流水给出反馈或拆解。"
        />
      ) : (
        <div className="mt-4 space-y-4">
          {entries.map((entry) => {
            const aiReview = parseReview(entry.aiFeedback);
            const aiPlan = parsePlan(entry.aiPlan);
            return (
              <article
                key={entry.id}
                className="rounded-xl border border-card-border bg-card p-4 shadow-sm"
                data-testid={`journal-${entry.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-[11px]">
                        {periodLabel(entry.period)} · {entry.periodKey}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed break-words">{entry.content}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={review.isPending || decompose.isPending}
                    onClick={() =>
                      tab === "review" ? review.mutate(entry.id) : decompose.mutate(entry.id)
                    }
                    data-testid={`button-ai-${tab}-${entry.id}`}
                  >
                    {review.isPending || decompose.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1 h-3.5 w-3.5" />
                    )}
                    {tab === "review" ? "AI 复盘" : "AI 拆解"}
                  </Button>
                </div>

                {tab === "review" && aiReview && (
                  <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {aiReview.source === "ai" ? "AI 复盘" : "内置模板"}
                      </Badge>
                      {aiReview.notice && <span className="text-muted-foreground">{aiReview.notice}</span>}
                    </div>
                    <p className="mt-2">{aiReview.feedback}</p>
                    <p className="mt-2 text-success">明日重点：{aiReview.tomorrowFocus}</p>
                    <p className="mt-1 text-muted-foreground">调整建议：{aiReview.suggestedAdjustments}</p>
                  </div>
                )}

                {tab === "plan" && aiPlan && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {aiPlan.source === "ai" ? "AI 拆解" : "文本拆解"}
                      </Badge>
                      {aiPlan.notice && <span className="text-xs text-muted-foreground">{aiPlan.notice}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{aiPlan.summary}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={createTask.isPending}
                        onClick={() => aiPlan.tasks.forEach((t) => createTask.mutate(t))}
                        data-testid={`button-create-all-${entry.id}`}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        全部创建
                      </Button>
                    </div>
                    <ul className="space-y-1.5">
                      {aiPlan.tasks.map((t, i) => (
                        <li
                          key={i}
                          className="flex flex-wrap items-center gap-2 rounded-lg bg-background/60 px-2.5 py-2"
                        >
                          <span className="min-w-0 flex-1 text-xs leading-relaxed break-words">
                            {t.title}
                            <span className="ml-2 text-muted-foreground">
                              {categoryName(t.category)} · {modeName(t.mode)} · {repeatName(t.repeat)} · {metricName(t.targetMetric)}
                              {t.priority >= 3 ? ` · 高优先级` : ""}
                              {t.deadline ? ` · 截止 ${t.deadline}` : ""}
                            </span>
                            {t.reason && <span className="ml-2 text-muted-foreground/80">{t.reason}</span>}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            disabled={createTask.isPending}
                            onClick={() => createTask.mutate(t)}
                            data-testid={`button-create-task-${entry.id}-${i}`}
                          >
                            {createTask.isPending ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                            )}
                            创建任务
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
