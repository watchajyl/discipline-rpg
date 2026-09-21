import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Moon, AlarmClock, Save, Loader2, BedDouble } from "lucide-react";
import { dateKey } from "@shared/gameRules";
import { timeToMinutes } from "@shared/sleep";
import { Num } from "./bits";

type SleepRecord = {
  id: number;
  day: string;
  sleepTime: string;
  wakeTime: string;
  durationMinutes: number;
  xp: number;
  points: number;
  prof: number;
  createdAt: number;
};

type SleepState = {
  settings: { idealBedtime: string; idealSleepHours: number };
  records: SleepRecord[];
};

function yesterday(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

export function SleepCard() {
  const { user } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const { data } = useQuery<SleepState>({ queryKey: ["/api/sleep/state", userId] });
  const [bedtime, setBedtime] = useState("23:00");
  const [hours, setHours] = useState(7.5);
  const [day, setDay] = useState(yesterday());
  const [sleepTime, setSleepTime] = useState("23:30");
  const [wakeTime, setWakeTime] = useState("07:30");
  const [inWindow, setInWindow] = useState(false);

  useEffect(() => {
    if (data?.settings) {
      setBedtime(data.settings.idealBedtime || "23:00");
      setHours(data.settings.idealSleepHours || 7.5);
    }
  }, [data?.settings]);

  useEffect(() => {
    const check = () => {
      const s = data?.settings;
      if (!s) return;
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const bed = timeToMinutes(s.idealBedtime);
      const within = Number.isFinite(bed) && nowMin >= bed && nowMin <= bed + 60;
      setInWindow(within);
      const key = `sleep-reminder-${dateKey()}`;
      if (within && localStorage.getItem(key) !== "1") {
        localStorage.setItem(key, "1");
        toast({
          title: "该睡觉了",
          description: `已经到你的理想入睡时间 ${s.idealBedtime}，放下屏幕，睡个好觉。`,
        });
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [data?.settings, toast]);

  function invalidate() {
    invalidateAll(userId);
  }

  const saveSettings = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/sleep/settings", { idealBedtime: bedtime, idealSleepHours: hours });
      return await res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "理想睡眠已保存", description: `入睡提醒时间：${bedtime}` });
    },
    onError: (e: any) => toast({ title: "保存失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const saveRecord = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sleep/record", { day, sleepTime, wakeTime });
      return await res.json();
    },
    onSuccess: (d: any) => {
      invalidate();
      if (d?.score?.reason) toast({ title: "睡眠已记录", description: d.score.reason });
    },
    onError: (e: any) => toast({ title: "记录失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const records = data?.records ?? [];

  return (
    <section className="rounded-xl border border-card-border bg-card p-4 shadow-sm" data-testid="card-sleep">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Moon className="h-4 w-4 text-cat-life" />
            睡眠打卡
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            记录入睡与起床时间，按理想时长与入睡时间给经验/积分，积分永不为负。
          </p>
        </div>
        <Badge variant="outline" className="text-[11px]" data-testid="badge-sleep-settings">
          <AlarmClock className="mr-1 h-3 w-3" />
          提醒 {data?.settings?.idealBedtime ?? bedtime}
        </Badge>
      </div>

      {inWindow && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-chart-4/40 bg-chart-4/10 px-3 py-2 text-xs text-foreground">
          <BedDouble className="h-4 w-4 shrink-0 text-chart-4" />
          现在到了你的理想入睡时间，准备休息吧。
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="ideal-bedtime" className="text-[11px]">
            理想入睡时间
          </Label>
          <Input
            id="ideal-bedtime"
            type="time"
            className="h-9"
            value={bedtime}
            onChange={(e) => setBedtime(e.target.value)}
            data-testid="input-ideal-bedtime"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ideal-hours" className="text-[11px]">
            理想时长（小时）
          </Label>
          <Input
            id="ideal-hours"
            type="number"
            min={4}
            max={12}
            step={0.5}
            className="num h-9"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) || 7.5)}
            data-testid="input-ideal-hours"
          />
        </div>
        <div className="sm:flex sm:items-end">
          <Button
            size="sm"
            variant="secondary"
            disabled={saveSettings.isPending}
            onClick={() => saveSettings.mutate()}
            data-testid="button-save-sleep-settings"
          >
            {saveSettings.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            保存设置
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="sleep-day" className="text-[11px]">
            记录日期
          </Label>
          <Input
            id="sleep-day"
            type="date"
            className="num h-9"
            max={dateKey()}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            data-testid="input-sleep-day"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sleep-time" className="text-[11px]">
            入睡时间
          </Label>
          <Input
            id="sleep-time"
            type="time"
            className="h-9"
            value={sleepTime}
            onChange={(e) => setSleepTime(e.target.value)}
            data-testid="input-sleep-time"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wake-time" className="text-[11px]">
            起床时间
          </Label>
          <Input
            id="wake-time"
            type="time"
            className="h-9"
            value={wakeTime}
            onChange={(e) => setWakeTime(e.target.value)}
            data-testid="input-wake-time"
          />
        </div>
        <div className="sm:flex sm:items-end">
          <Button
            size="sm"
            disabled={saveRecord.isPending || !sleepTime || !wakeTime}
            onClick={() => saveRecord.mutate()}
            data-testid="button-save-sleep"
          >
            {saveRecord.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            记录并结算
          </Button>
        </div>
      </div>

      {records.length > 0 && (
        <div className="mt-4 border-t border-border/70 pt-3">
          <p className="text-[11px] font-semibold text-muted-foreground">最近记录</p>
          <ul className="mt-1.5 space-y-1">
            {records
              .slice(-7)
              .reverse()
              .map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="num">{r.day}</span>
                  <span className="num">{r.sleepTime} → {r.wakeTime}</span>
                  <span className="num">{(r.durationMinutes / 60).toFixed(1)} 小时</span>
                  <span className={r.points >= 0 ? "text-success" : "text-destructive"}>
                    {r.points >= 0 ? "+" : ""}
                    <Num>{r.points}</Num> 分
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
