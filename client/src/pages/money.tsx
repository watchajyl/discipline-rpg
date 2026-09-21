import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, Num } from "@/components/bits";
import { Wallet, Plus, Trash2, Loader2, PiggyBank } from "lucide-react";
import type { TaskFull } from "@/lib/types";
import { dateKey } from "@shared/gameRules";

type Expense = {
  id: number;
  day: string;
  category: "food" | "life" | "fun" | "study";
  amountCents: number;
  note: string;
  createdAt: number;
};

type ExpenseState = {
  today: { day: string; totalCents: number; budgetCents: number | null; met: boolean };
  budgetTask: TaskFull | null;
  recent: Expense[];
  byCategory: { key: string; totalCents: number }[];
};

const CATS = [
  { key: "food", name: "饮食", cls: "text-cat-life" },
  { key: "life", name: "生活", cls: "text-cat-finance" },
  { key: "fun", name: "娱乐", cls: "text-cat-social" },
  { key: "study", name: "工作学习", cls: "text-cat-academic" },
] as const;

export default function MoneyPage() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const { data } = useQuery<ExpenseState>({ queryKey: ["/api/expenses/state", userId] });
  const [budget, setBudget] = useState("100");
  const [category, setCategory] = useState<Expense["category"]>("food");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(dateKey());

  useEffect(() => {
    if (data?.today?.budgetCents != null) {
      setBudget((data.today.budgetCents / 100).toFixed(0));
    }
  }, [data?.today?.budgetCents]);

  function invalidate() {
    invalidateAll(userId);
  }

  const saveBudget = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/expenses/budget", { amount: Number(budget) });
      return await res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "每日预算已保存", description: `预算：${Number(budget) || 100} 元/天` });
    },
    onError: (e: any) => toast({ title: "保存失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const add = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/expenses", {
        day,
        category,
        amount: Number(amount),
        note,
      });
      return await res.json();
    },
    onSuccess: (d: any) => {
      invalidate();
      setAmount("");
      setNote("");
      if (d?.message) toast({ title: "已记录开销", description: d.message });
    },
    onError: (e: any) => toast({ title: "记录失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/expenses/${id}`);
      return await res.json();
    },
    onSuccess: () => invalidate(),
  });

  const today = data?.today ?? { day, totalCents: 0, budgetCents: null, met: false };
  const remaining = today.budgetCents != null ? today.budgetCents - today.totalCents : null;
  const recent = data?.recent ?? [];

  return (
    <div>
      <PageHeader
        title="开销记账"
        desc="每天手动记下每一笔开销，自动关联每日预算任务；控制在预算内即视为当日任务完成。"
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <PiggyBank className="h-4 w-4 text-cat-finance" />
            今日已花
          </p>
          <p className="mt-2 num text-2xl font-bold">
            <Num>{(today.totalCents / 100).toFixed(2)}</Num> 元
          </p>
          {today.budgetCents != null && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              预算 <Num>{(today.budgetCents / 100).toFixed(0)}</Num> 元
            </p>
          )}
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">今日预算状态</p>
          <div className="mt-2 flex items-center gap-2">
            {today.budgetCents == null ? (
              <Badge variant="outline" className="text-[11px]">
                未设置
              </Badge>
            ) : today.met ? (
              <Badge className="text-[11px]">已达标</Badge>
            ) : (
              <Badge variant="destructive" className="text-[11px]">
                已超支
              </Badge>
            )}
            {remaining != null && (
              <span className={`text-[11px] ${remaining >= 0 ? "text-success" : "text-destructive"}`}>
                剩余 <Num>{(remaining / 100).toFixed(2)}</Num> 元
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">每日预算（元）</p>
          <div className="mt-2 flex gap-2">
            <Input
              type="number"
              min={1}
              className="num h-9"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              data-testid="input-budget"
            />
            <Button size="sm" variant="secondary" disabled={saveBudget.isPending} onClick={() => saveBudget.mutate()} data-testid="button-save-budget">
              {saveBudget.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              保存
            </Button>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-[11px]">日期</Label>
            <Input type="date" max={dateKey()} className="num h-10" value={day} onChange={(e) => setDay(e.target.value)} data-testid="input-expense-day" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">类别</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Expense["category"])}>
              <SelectTrigger data-testid="select-expense-category" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATS.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">金额（元）</Label>
            <Input type="number" min={0.01} step={0.01} className="num h-10" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12.50" data-testid="input-expense-amount" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">备注</Label>
            <Input className="h-10" value={note} onChange={(e) => setNote(e.target.value)} placeholder="午餐 / 地铁 / 买书" data-testid="input-expense-note" />
          </div>
          <div className="sm:flex sm:items-end">
            <Button className="w-full sm:w-auto" disabled={!amount || add.isPending} onClick={() => add.mutate()} data-testid="button-add-expense">
              {add.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              记一笔
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(data?.byCategory ?? []).map((c) => {
            const meta = CATS.find((x) => x.key === c.key);
            return (
              <Badge key={c.key} variant="outline" className="text-[11px]">
                <span className={meta?.cls}>{meta?.name}</span>
                <span className="num ml-1.5">{(c.totalCents / 100).toFixed(2)} 元</span>
              </Badge>
            );
          })}
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-card-border bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold text-muted-foreground">最近开销</p>
        {recent.length === 0 ? (
          <EmptyState icon={Wallet} title="还没有开销记录" desc="记下第一笔开销后，系统会自动创建每日预算任务。" />
        ) : (
          <ul className="mt-2 space-y-1.5">
            {recent.slice(0, 15).map((e) => {
              const meta = CATS.find((x) => x.key === e.category);
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-background/60 px-2.5 py-2 text-xs">
                  <span className="num text-muted-foreground">{e.day}</span>
                  <span className={meta?.cls}>{meta?.name}</span>
                  <span className="num font-semibold">{(e.amountCents / 100).toFixed(2)} 元</span>
                  {e.note && <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.note}</span>}
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="删除" onClick={() => remove.mutate(e.id)} data-testid={`button-delete-expense-${e.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
