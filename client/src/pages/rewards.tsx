import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import type { Profile } from "@/lib/types";
import type { Reward, Redemption } from "@shared/schema";
import { EmptyState, Num, PageHeader, SkeletonBlock } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Coins, Plus, Gift, Trash2, Pencil, History } from "lucide-react";

const emptyForm = { name: "", description: "", cost: 200, emoji: "🎁", stock: -1, tag: "休闲" };

export default function RewardsPage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const { data: profile } = useQuery<Profile>({ queryKey: ["/api/profile", userId] });
  const { data: rewards, isLoading } = useQuery<Reward[]>({ queryKey: ["/api/rewards", userId] });
  const { data: history } = useQuery<Redemption[]>({ queryKey: ["/api/redemptions", userId] });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Reward | null>(null);
  const [form, setForm] = useState(emptyForm);
  const points = profile?.user.points ?? 0;

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }
  function openEdit(r: Reward) {
    setEditing(r);
    setForm({ name: r.name, description: r.description, cost: r.cost, emoji: r.emoji, stock: r.stock, tag: r.tag });
    setDialogOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (editing) await apiRequest("PATCH", `/api/rewards/${editing.id}`, { reward: form });
      else await apiRequest("POST", "/api/rewards", { reward: form });
    },
    onSuccess: () => {
      invalidateAll(userId);
      setDialogOpen(false);
      toast({ title: editing ? "奖励已更新" : "奖励已添加", description: form.name });
    },
    onError: (e: any) => toast({ title: "保存失败", description: clean(e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (r: Reward) => {
      await apiRequest("DELETE", `/api/rewards/${r.id}`);
    },
    onSuccess: () => invalidateAll(userId),
  });

  const redeem = useMutation({
    mutationFn: async (r: Reward) => {
      await apiRequest("POST", `/api/rewards/${r.id}/redeem`, {});
      return r;
    },
    onSuccess: (r) => {
      invalidateAll(userId);
      toast({ title: `已兑换 ${r.emoji} ${r.name}`, description: `扣除 ${r.cost} 积分，去好好享受。` });
    },
    onError: (e: any) => toast({ title: "兑换失败", description: clean(e), variant: "destructive" }),
  });

  return (
    <div>
      <PageHeader
        title="积分商城"
        desc="把积分换成真实的休息和奖励。兑换只扣积分，不影响等级和熟练度。"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="num gap-1 px-2.5 py-1 text-sm" data-testid="text-points-balance">
              <Coins className="h-3.5 w-3.5" />
              {points}
            </Badge>
            <Button onClick={openNew} data-testid="button-new-reward">
              <Plus className="mr-1 h-4 w-4" />
              添加奖励
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SkeletonBlock className="h-32 w-full" />
              <SkeletonBlock className="h-32 w-full" />
            </div>
          ) : (rewards ?? []).length === 0 ? (
            <EmptyState
              icon={Gift}
              title="奖励清单是空的"
              desc="设定一些你真心想要的小奖励：一部电影、一次骑行、一本闲书。有出口，坚持才有意义。"
              action={
                <Button onClick={openNew} data-testid="button-empty-add-reward">
                  <Plus className="mr-1 h-4 w-4" />
                  添加第一个奖励
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(rewards ?? []).map((r) => {
                const affordable = points >= r.cost && r.stock !== 0;
                return (
                  <div
                    key={r.id}
                    className="flex flex-col rounded-xl border border-card-border bg-card p-3.5"
                    data-testid={`card-reward-${r.id}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="text-2xl leading-none" aria-hidden>
                        {r.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-tight break-words">{r.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {r.tag}
                          </Badge>
                          {r.stock >= 0 && (
                            <span className="num text-[10px] text-muted-foreground">剩余 {r.stock}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {r.description && (
                      <p className="mt-2 text-xs text-muted-foreground leading-relaxed break-words">{r.description}</p>
                    )}
                    <div className="mt-auto pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="num text-sm font-semibold" style={{ color: "hsl(var(--cat-finance))" }}>
                          {r.cost} 分
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label="编辑奖励"
                            onClick={() => openEdit(r)}
                            data-testid={`button-edit-reward-${r.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label="删除奖励"
                            onClick={() => remove.mutate(r)}
                            data-testid={`button-delete-reward-${r.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="mt-2 w-full"
                        variant={affordable ? "default" : "secondary"}
                        disabled={!affordable || redeem.isPending}
                        onClick={() => redeem.mutate(r)}
                        data-testid={`button-redeem-${r.id}`}
                      >
                        {r.stock === 0 ? "已兑完" : affordable ? "兑换" : `还差 ${r.cost - points} 分`}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <History className="h-4 w-4 text-primary" />
              兑换记录
            </p>
            {(history ?? []).length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                还没有兑换过。攒到第一份奖励时，记得真的去兑现它。
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {(history ?? []).slice(0, 12).map((h) => (
                  <li key={h.id} className="flex items-start gap-2">
                    <span aria-hidden>{h.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{h.name}</span>
                      <span className="num block text-[10px] text-muted-foreground">
                        {new Date(h.createdAt).toLocaleDateString("zh-CN")} · -{h.cost} 分
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle className="text-xl">{editing ? "编辑奖励" : "添加奖励"}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              奖励定价建议：小休息 100–300 分，半天娱乐 500–1000 分，大件消费 3000 分以上。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="grid grid-cols-[4.5rem_1fr] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reward-emoji">图标</Label>
                <Input
                  id="reward-emoji"
                  value={form.emoji}
                  onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                  data-testid="input-reward-emoji"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reward-name">名称</Label>
                <Input
                  id="reward-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="看一部电影"
                  data-testid="input-reward-name"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reward-desc">说明</Label>
              <Textarea
                id="reward-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                data-testid="input-reward-desc"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reward-cost" className="block text-xs">
                  积分价格
                </Label>
                <Input
                  id="reward-cost"
                  type="number"
                  min={1}
                  className="num"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: Number(e.target.value) || 1 })}
                  data-testid="input-reward-cost"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reward-stock" className="block text-xs">
                  库存(-1无限)
                </Label>
                <Input
                  id="reward-stock"
                  type="number"
                  min={-1}
                  className="num"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
                  data-testid="input-reward-stock"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reward-tag" className="block text-xs">
                  标签
                </Label>
                <Input
                  id="reward-tag"
                  value={form.tag}
                  onChange={(e) => setForm({ ...form, tag: e.target.value })}
                  data-testid="input-reward-tag"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} data-testid="button-cancel-reward">
              取消
            </Button>
            <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()} data-testid="button-save-reward">
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function clean(e: any) {
  return String(e?.message ?? e).replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");
}
