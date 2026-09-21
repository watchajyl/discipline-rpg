import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/bits";
import {
  Send,
  Bot,
  CircleHelp,
  ListChecks,
  RotateCcw,
  CheckCircle2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { categoryName, modeName, repeatName, metricName } from "@shared/gameRules";
import { cn } from "@/lib/utils";

type PlannerTask = {
  title: string;
  category: string;
  mode: string;
  repeat: "none" | "daily" | "weekly";
  targetMetric: "checkin" | "count" | "blocks";
  targetAmount: number;
  priority: number;
  deadline?: string;
  difficulty: number;
  xpPerUnit: number;
  pointsPerUnit: number;
  profPerUnit: number;
  unitName: string;
};

type PlannerMessage = {
  role: "user" | "assistant";
  content: string;
  action?: "ask" | "plan" | "blocked" | "done";
  question?: string;
  options?: string[];
  plan?: { summary: string; tasks: PlannerTask[] };
  createdAt: number;
};

type PlannerState = {
  messages: PlannerMessage[];
  askCount: number;
  configured: boolean;
};

export default function PlannerPage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery<PlannerState>({ queryKey: ["/api/planner/state", userId] });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.messages.length]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/planner/state", userId] });
  }

  const send = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", "/api/planner/send", { content });
      return await res.json();
    },
    onSuccess: (d: any) => {
      refresh();
      if (!d?.configured) {
        toast({ title: "需要 AI 配置", description: d?.message?.content });
      }
    },
    onError: (e: any) => toast({ title: "发送失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const reset = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/planner/reset", {});
    },
    onSuccess: () => {
      refresh();
      setInput("");
    },
  });

  const confirm = useMutation({
    mutationFn: async (tasks: PlannerTask[]) => {
      const res = await apiRequest("POST", "/api/planner/confirm", { tasks });
      return await res.json();
    },
    onSuccess: (d: any) => {
      invalidateAll(userId);
      refresh();
      toast({
        title: "任务已创建",
        description: `已创建 ${d?.created?.length ?? 0} 个任务：${(d?.created ?? []).join("、")}`,
      });
    },
    onError: (e: any) => toast({ title: "创建失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const messages = data?.messages ?? [];
  const configured = data?.configured ?? false;

  function submit(text?: string) {
    const value = (text ?? input).trim();
    if (!value || send.isPending) return;
    setInput("");
    send.mutate(value);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <PageHeader
        title="智能规划"
        desc="像聊天一样说出你的目标；AI 会先澄清不清楚的地方，再帮你把最终方案设成具体任务。"
      />

      {!configured && (
        <div className="mb-4 rounded-xl border border-chart-4/40 bg-chart-4/10 p-3 text-xs leading-relaxed text-foreground">
          当前还没配置 AI 接口。先去「设置」里填写接口地址、模型和 API Key，再回来开始规划。
        </div>
      )}

      <div className="mb-3 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={messages.length === 0 || reset.isPending}
          onClick={() => reset.mutate()}
          data-testid="button-planner-reset"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          重新开始
        </Button>
      </div>

      <div className="flex min-h-[52vh] flex-col overflow-hidden rounded-xl border border-card-border bg-card shadow-sm">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 scroll-thin">
          {messages.length === 0 && (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-center">
              <Sparkles className="h-7 w-7 text-primary" />
              <p className="text-sm font-medium">从一句话开始</p>
              <p className="max-w-sm text-xs text-muted-foreground leading-relaxed">
                例如：我想每天背单词、周末完成论文第三章，并准备下周组会。
              </p>
            </div>
          )}

          {messages.map((m, i) => {
            const isUser = m.role === "user";
            const isPlan = m.action === "plan" && m.plan;
            const isAsk = m.action === "ask";
            return (
              <div key={i} className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}>
                {!isUser && (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Bot className="h-4 w-4" />
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[82%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                    isUser ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>

                  {isAsk && (m.options?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(m.options ?? []).map((option) => (
                        <Button
                          key={option}
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={send.isPending}
                          onClick={() => submit(option)}
                          data-testid={`planner-option-${i}-${option}`}
                        >
                          {option}
                        </Button>
                      ))}
                    </div>
                  )}

                  {isPlan && m.plan && (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          <ListChecks className="mr-1 h-3 w-3" />
                          {m.plan.tasks.length} 个任务
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">{m.plan.summary}</span>
                      </div>
                      <ul className="space-y-1.5">
                        {m.plan.tasks.map((t, j) => (
                          <li key={j} className="rounded-lg bg-background/70 px-2.5 py-2 text-xs">
                            <p className="font-medium break-words">{t.title}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                              {categoryName(t.category)} · {modeName(t.mode)} · {repeatName(t.repeat)} ·{" "}
                              {metricName(t.targetMetric)} × {t.targetAmount}
                              {t.priority >= 3 ? " · 高优先级" : ""}
                              {t.deadline ? ` · 截止 ${t.deadline}` : ""}
                            </p>
                          </li>
                        ))}
                      </ul>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          disabled={confirm.isPending || send.isPending}
                          onClick={() => confirm.mutate(m.plan!.tasks)}
                          data-testid={`planner-confirm-${i}`}
                        >
                          {confirm.isPending ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          )}
                          确认并创建任务
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {send.isPending && (
            <div className="flex justify-start">
              <span className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在整理…
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border/70 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              className="min-h-[52px] max-h-32 flex-1 resize-none"
              placeholder="描述你的目标，或直接回答 AI 的问题…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              data-testid="input-planner"
            />
            <Button
              size="icon"
              className="h-[52px] w-[52px] shrink-0"
              disabled={!input.trim() || send.isPending}
              onClick={() => submit()}
              data-testid="button-planner-send"
            >
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
