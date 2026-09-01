// 设置页「每日维持」分区：五类别完整配置 + 全局参数 + 恢复推荐默认值 + 强度模拟器
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invalidateAll, useApp } from "@/lib/app-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { UpkeepData } from "@/lib/types";
import { Num } from "@/components/bits";
import { catColor } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES } from "@shared/gameRules";
import {
  UPKEEP_DEFAULT_CONFIG,
  UPKEEP_LIMITS,
  UPKEEP_MODES,
  normalizeUpkeepConfig,
  simulateUpkeep,
  type UpkeepConfig,
} from "@shared/upkeep";
import { Loader2, RotateCcw, ShieldHalf, SlidersHorizontal } from "lucide-react";

function NumField({
  label,
  value,
  min,
  max,
  suffix,
  testId,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  testId: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground" htmlFor={testId}>
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={testId}
          data-testid={testId}
          type="number"
          className="num h-8 text-xs"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="shrink-0 text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function UpkeepSettingsSection() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const { data } = useQuery<UpkeepData>({ queryKey: ["/api/upkeep", userId] });
  const [draft, setDraft] = useState<UpkeepConfig | null>(null);
  const [sim, setSim] = useState<Record<string, number>>(() =>
    Object.fromEntries(CATEGORIES.map((c) => [c.key, 0])),
  );

  useEffect(() => {
    if (data?.config && !draft) setDraft(normalizeUpkeepConfig(data.config));
  }, [data?.config, draft]);

  const save = useMutation({
    mutationFn: async (payload: { config?: UpkeepConfig; reset?: boolean }) => {
      const res = await apiRequest("PATCH", "/api/upkeep/config", payload);
      return (await res.json()) as UpkeepData;
    },
    onSuccess: (d) => {
      setDraft(normalizeUpkeepConfig(d.config));
      invalidateAll(userId);
      toast({ title: "维持配置已保存" });
    },
    onError: (e: any) => toast({ title: e?.message || "保存失败", variant: "destructive" }),
  });

  const cfg = draft;
  const dirty = useMemo(
    () => (cfg && data?.config ? JSON.stringify(cfg) !== JSON.stringify(normalizeUpkeepConfig(data.config)) : false),
    [cfg, data?.config],
  );

  const simulation = useMemo(() => (cfg ? simulateUpkeep(cfg, sim) : null), [cfg, sim]);

  if (!cfg) return null;

  const setCat = (key: string, patch: any) =>
    setDraft({ ...cfg, categories: { ...cfg.categories, [key]: { ...(cfg.categories as any)[key], ...patch } } as any });

  return (
    <section className="rounded-2xl border border-card-border bg-card p-4 sm:p-5" data-testid="section-upkeep-settings">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ShieldHalf className="h-4 w-4 text-warn" />
        每日维持
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        按达标度比例收取维持费，做一半只扣一半。有每日封顶、积分不会为负、新账号宽限期与每周豁免格三重保护。
      </p>

      {/* 全局参数 */}
      <div className="rounded-xl border border-border bg-background/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold">启用每日维持</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">关闭后不再结算、不再扣费，历史记录保留</p>
          </div>
          <Switch
            checked={cfg.enabled}
            onCheckedChange={(v) => setDraft({ ...cfg, enabled: v })}
            data-testid="switch-upkeep-enabled"
            aria-label="启用每日维持"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField
            label="每日总额封顶"
            suffix="分"
            testId="input-upkeep-cap"
            value={cfg.dailyCapPoints}
            min={UPKEEP_LIMITS.dailyCapPoints.min}
            max={UPKEEP_LIMITS.dailyCapPoints.max}
            onChange={(v) => setDraft({ ...cfg, dailyCapPoints: v })}
          />
          <NumField
            label="全维达成奖励"
            suffix="分"
            testId="input-upkeep-bonus"
            value={cfg.allMetBonus}
            min={UPKEEP_LIMITS.allMetBonus.min}
            max={UPKEEP_LIMITS.allMetBonus.max}
            onChange={(v) => setDraft({ ...cfg, allMetBonus: v })}
          />
          <NumField
            label="每周豁免格"
            suffix="个"
            testId="input-upkeep-exemptions"
            value={cfg.weeklyExemptions}
            min={UPKEEP_LIMITS.weeklyExemptions.min}
            max={UPKEEP_LIMITS.weeklyExemptions.max}
            onChange={(v) => setDraft({ ...cfg, weeklyExemptions: v })}
          />
          <NumField
            label="新账号宽限期"
            suffix="天"
            testId="input-upkeep-grace"
            value={cfg.graceDays}
            min={UPKEEP_LIMITS.graceDays.min}
            max={UPKEEP_LIMITS.graceDays.max}
            onChange={(v) => setDraft({ ...cfg, graceDays: v })}
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground" htmlFor="input-upkeep-tz">
              结算时区
            </Label>
            <Input
              id="input-upkeep-tz"
              data-testid="input-upkeep-timezone"
              className="h-8 text-xs"
              value={cfg.timezone}
              onChange={(e) => setDraft({ ...cfg, timezone: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">连续未达标倍数</Label>
            <p className="num rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs" data-testid="text-upkeep-escalation">
              {cfg.escalation.join(" · ")}
            </p>
          </div>
        </div>
      </div>

      {/* 五类别配置 */}
      <div className="mt-3 space-y-2.5">
        {CATEGORIES.map((c) => {
          const cc = (cfg.categories as any)[c.key];
          const weekly = cc.mode === "weekly";
          const worstFee = cc.mode === "off" ? 0 : Math.round(cc.baseFee * cfg.escalation[0]);
          return (
            <div
              key={c.key}
              className="rounded-xl border border-border bg-background/60 p-3"
              data-testid={`card-upkeep-config-${c.key}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold" style={{ color: catColor(c.key) }}>
                  {c.name}
                </p>
                <Select value={cc.mode} onValueChange={(v) => setCat(c.key, { mode: v })}>
                  <SelectTrigger className="h-8 w-[9.5rem] text-xs" data-testid={`select-upkeep-mode-${c.key}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UPKEEP_MODES.map((m) => (
                      <SelectItem key={m.key} value={m.key} className="text-xs">
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {UPKEEP_MODES.find((m) => m.key === cc.mode)?.desc}
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <NumField
                  label="基准费用"
                  suffix="分"
                  testId={`input-upkeep-basefee-${c.key}`}
                  value={cc.baseFee}
                  min={UPKEEP_LIMITS.baseFee.min}
                  max={UPKEEP_LIMITS.baseFee.max}
                  onChange={(v) => setCat(c.key, { baseFee: v })}
                />
                {(["proficiency", "minutes", "count"] as const).map((k) => {
                  const labels = { proficiency: "熟练度门槛", minutes: "时长门槛", count: "结算次数门槛" } as const;
                  const units = { proficiency: "", minutes: "分钟", count: "次" } as const;
                  const field = weekly ? "weeklyTargets" : "targets";
                  return (
                    <NumField
                      key={k}
                      label={(weekly ? "每周" : "") + labels[k]}
                      suffix={units[k]}
                      testId={`input-upkeep-${weekly ? "weekly-" : ""}target-${k}-${c.key}`}
                      value={cc[field][k]}
                      min={UPKEEP_LIMITS.target.min}
                      max={UPKEEP_LIMITS.target.max}
                      onChange={(v) => setCat(c.key, { [field]: { ...cc[field], [k]: v } })}
                    />
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground" data-testid={`text-upkeep-worst-${c.key}`}>
                {cc.mode === "off" ? (
                  "只统计，不计费"
                ) : (
                  <>
                    若{weekly ? "本周" : "今天"}完全没做，将扣 <Num className="text-warn">{worstFee}</Num> 分
                    （连续未达标到第 {cfg.escalation.length} 天为{" "}
                    <Num className="text-warn">
                      {Math.round(cc.baseFee * cfg.escalation[cfg.escalation.length - 1])}
                    </Num>{" "}
                    分）
                  </>
                )}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ config: cfg })}
          data-testid="button-upkeep-save"
        >
          {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          保存配置
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={save.isPending}
          onClick={() => save.mutate({ reset: true })}
          data-testid="button-upkeep-reset"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          恢复推荐默认值
        </Button>
        {dirty && <span className="text-[11px] text-warn">有未保存的改动</span>}
      </div>

      {/* 强度模拟器 */}
      <div className="mt-4 rounded-xl border border-border bg-background/60 p-3" data-testid="card-upkeep-simulator">
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
          强度模拟器
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          拖动假想完成度，看看当日会扣多少、连续这样过 7 天会累计扣多少。只是推演，不会真的扣分。
        </p>
        <div className="mt-2.5 space-y-2.5">
          {CATEGORIES.map((c) => {
            const cc = (cfg.categories as any)[c.key];
            const row = simulation?.rows.find((r) => r.category === (c.key as any));
            return (
              <div key={c.key} className="grid grid-cols-[4.5rem_1fr_5.5rem] items-center gap-2.5">
                <span className="truncate text-[11px] font-semibold" style={{ color: catColor(c.key) }}>
                  {c.name}
                </span>
                <Slider
                  value={[Math.round((sim[c.key] ?? 0) * 100)]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(v) => setSim({ ...sim, [c.key]: (v[0] ?? 0) / 100 })}
                  aria-label={`${c.name}假想完成度`}
                  data-testid={`slider-upkeep-sim-${c.key}`}
                />
                <span className="num text-right text-[11px]" data-testid={`text-upkeep-sim-${c.key}`}>
                  {Math.round((sim[c.key] ?? 0) * 100)}% ·{" "}
                  <span className={row && row.todayFee > 0 ? "text-warn" : "text-success"}>
                    {cc.mode === "off" ? "—" : row && row.todayFee > 0 ? `−${row.todayFee}` : "0"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-border/70 pt-2.5 text-[11px]">
          <span className="text-muted-foreground">
            当日扣费{" "}
            <Num className={simulation && simulation.todayCapped > 0 ? "text-warn" : "text-success"} data-testid="text-upkeep-sim-today">
              {(simulation?.todayCapped ?? 0) > 0 ? `−${simulation?.todayCapped}` : "0"}
            </Num>{" "}
            分
          </span>
          <span className="text-muted-foreground">
            连续 7 天累计{" "}
            <Num className={simulation && simulation.sevenDayTotal > 0 ? "text-warn" : "text-success"} data-testid="text-upkeep-sim-seven">
              {(simulation?.sevenDayTotal ?? 0) > 0 ? `−${simulation?.sevenDayTotal}` : "0"}
            </Num>{" "}
            分
          </span>
          <span className="text-muted-foreground">
            全维达成{" "}
            <span className={simulation?.allMet ? "font-semibold text-success" : ""} data-testid="text-upkeep-sim-allmet">
              {simulation?.allMet ? `是，+${cfg.allMetBonus}` : "否"}
            </span>
          </span>
          <span className="text-muted-foreground">
            当日净支出{" "}
            <Num className="text-foreground" data-testid="text-upkeep-sim-net">
              {(simulation?.netToday ?? 0) > 0 ? `−${simulation?.netToday}` : (simulation?.netToday ?? 0) < 0 ? `+${-(simulation?.netToday ?? 0)}` : "0"}
            </Num>
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSim(Object.fromEntries(CATEGORIES.map((c) => [c.key, 0])))} data-testid="button-upkeep-sim-zero">
            全部 0%
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSim(Object.fromEntries(CATEGORIES.map((c) => [c.key, 0.5])))} data-testid="button-upkeep-sim-half">
            全部 50%
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSim(Object.fromEntries(CATEGORIES.map((c) => [c.key, 1])))} data-testid="button-upkeep-sim-full">
            全部 100%
          </Button>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        推荐默认值：学术 / 外语为「每日必做」，生活 / 社交 / 金钱为「每日关注」；每日封顶{" "}
        <Num>{UPKEEP_DEFAULT_CONFIG.dailyCapPoints}</Num> 分，宽限期 <Num>{UPKEEP_DEFAULT_CONFIG.graceDays}</Num> 天，
        每周 <Num>{UPKEEP_DEFAULT_CONFIG.weeklyExemptions}</Num> 个豁免格。
      </p>
    </section>
  );
}
