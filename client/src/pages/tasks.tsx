import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import type { TaskFull } from "@/lib/types";
import { CategoryChip, EmptyState, ModeChip, Num, PageHeader, SkeletonBlock } from "@/components/bits";
import { TaskCard } from "@/components/task-card";
import { TaskFormSheet } from "@/components/task-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, Archive, ArchiveRestore, Trash2, ListTodo, Pencil } from "lucide-react";
import { CATEGORIES, MODES, difficultyName } from "@shared/gameRules";
import { cn } from "@/lib/utils";

export default function TasksPage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const { data: tasks, isLoading } = useQuery<TaskFull[]>({ queryKey: ["/api/tasks", userId] });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [mode, setMode] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskFull | null>(null);
  const [deleting, setDeleting] = useState<TaskFull | null>(null);

  const archive = useMutation({
    mutationFn: async (t: TaskFull) => {
      await apiRequest("PATCH", `/api/tasks/${t.id}`, { archived: t.archived === 1 ? 0 : 1 });
    },
    onSuccess: () => invalidateAll(userId),
    onError: (e: any) => toast({ title: "操作失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (t: TaskFull) => {
      await apiRequest("DELETE", `/api/tasks/${t.id}`);
    },
    onSuccess: () => {
      invalidateAll(userId);
      toast({ title: "任务已删除", description: "历史记录仍保留在统计中。" });
      setDeleting(null);
    },
    onError: (e: any) => toast({ title: "删除失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    return (tasks ?? []).filter((t) => {
      if (showArchived ? t.archived !== 1 : t.archived === 1) return false;
      if (cat !== "all" && t.category !== cat) return false;
      if (mode !== "all" && t.mode !== mode) return false;
      if (q && !t.title.toLowerCase().includes(q.toLowerCase()) && !t.notes.includes(q)) return false;
      return true;
    });
  }, [tasks, q, cat, mode, showArchived]);

  const activeCount = (tasks ?? []).filter((t) => t.archived === 0).length;
  const archivedCount = (tasks ?? []).filter((t) => t.archived === 1).length;

  return (
    <div>
      <PageHeader
        title="任务管理"
        desc={`进行中 ${activeCount} 项 · 已归档 ${archivedCount} 项。归档后不再出现在今日面板，但历史数据保留。`}
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

      <div className="mb-4 space-y-3 rounded-xl border border-card-border bg-card p-3.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索任务标题或备注"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="input-search-task"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={cat === "all"} onClick={() => setCat("all")} testId="filter-cat-all">
            全部类别
          </FilterPill>
          {CATEGORIES.map((c) => (
            <FilterPill key={c.key} active={cat === c.key} onClick={() => setCat(c.key)} testId={`filter-cat-${c.key}`}>
              {c.name}
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={mode === "all"} onClick={() => setMode("all")} testId="filter-mode-all">
            全部模式
          </FilterPill>
          {MODES.map((m) => (
            <FilterPill key={m.key} active={mode === m.key} onClick={() => setMode(m.key)} testId={`filter-mode-${m.key}`}>
              {m.name}
            </FilterPill>
          ))}
          <span className="mx-1 hidden w-px self-stretch bg-border sm:block" />
          <FilterPill
            active={showArchived}
            onClick={() => setShowArchived((s) => !s)}
            testId="filter-archived"
          >
            {showArchived ? "查看进行中" : "查看已归档"}
          </FilterPill>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <SkeletonBlock className="h-32 w-full" />
          <SkeletonBlock className="h-32 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={showArchived ? "没有归档任务" : q || cat !== "all" || mode !== "all" ? "没有匹配的任务" : "还没有任务"}
          desc={
            showArchived
              ? "完成或暂时不做的任务可以归档，这里会留档，随时可以恢复。"
              : "把长期目标拆成四种可结算的形态：计时专注、里程碑、周期打卡、计数累计。"
          }
          action={
            !showArchived ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                data-testid="button-empty-create-task"
              >
                <Plus className="mr-1 h-4 w-4" />
                新建任务
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((t) =>
            showArchived ? (
              <div
                key={t.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-card-border bg-card p-3.5"
                data-testid={`card-archived-${t.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{t.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <CategoryChip cat={t.category} />
                    <ModeChip mode={t.mode} />
                    <Badge variant="outline" className="text-[11px]">
                      {difficultyName(t.difficulty)}
                    </Badge>
                    <span className="num text-[11px] text-muted-foreground">单份 {t.xpPerUnit} XP</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => archive.mutate(t)} data-testid={`button-restore-${t.id}`}>
                    <ArchiveRestore className="mr-1 h-3.5 w-3.5" />
                    恢复
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(t)} data-testid={`button-delete-${t.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <div key={t.id} className="space-y-0">
                <TaskCard
                  task={t}
                  onEdit={(x) => {
                    setEditing(x);
                    setFormOpen(true);
                  }}
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      setEditing(t);
                      setFormOpen(true);
                    }}
                    data-testid={`button-edit-${t.id}`}
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => archive.mutate(t)}
                    data-testid={`button-archive-${t.id}`}
                  >
                    <Archive className="mr-1 h-3 w-3" />
                    归档
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-destructive"
                    onClick={() => setDeleting(t)}
                    data-testid={`button-delete-${t.id}`}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    删除
                  </Button>
                </div>
              </div>
            ),
          )}
        </div>
      )}

      <TaskFormSheet open={formOpen} onOpenChange={setFormOpen} task={editing} />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">删除任务？</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              将删除「{deleting?.title}」及其计时状态。已获得的经验、积分与熟练度不会被收回，历史日志仍保留在统计中。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting)}
              data-testid="button-confirm-delete"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterPill({
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
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover-elevate",
      )}
    >
      {children}
    </button>
  );
}
