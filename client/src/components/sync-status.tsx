// 同步状态 UI（SPEC-V2 1.6）
import { useEffect, useState } from "react";
import { Check, CloudOff, HardDrive, RefreshCw, RotateCw, TriangleAlert } from "lucide-react";
import { getSyncStatus, statusLabel, subscribeSync, syncNow, type SyncStatus } from "@/lib/sync";
import { cn } from "@/lib/utils";

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => subscribeSync(setS), []);
  return s;
}

export function relativeTime(ms: number): string {
  if (!ms) return "还没有同步过";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const TONE: Record<SyncStatus["state"], string> = {
  local: "border-border bg-muted/60 text-muted-foreground",
  idle: "border-primary/30 bg-primary/10 text-primary",
  syncing: "border-border bg-muted/60 text-muted-foreground",
  offline: "border-chart-4/40 bg-chart-4/10 text-chart-4",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

function Icon({ state }: { state: SyncStatus["state"] }) {
  if (state === "local") return <HardDrive className="h-3.5 w-3.5 shrink-0" />;
  if (state === "syncing") return <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />;
  if (state === "offline") return <CloudOff className="h-3.5 w-3.5 shrink-0" />;
  if (state === "error") return <TriangleAlert className="h-3.5 w-3.5 shrink-0" />;
  return <Check className="h-3.5 w-3.5 shrink-0" />;
}

/** 顶栏 / 侧边栏的状态指示，点击即立即同步 */
export function SyncIndicator({ className }: { className?: string }) {
  const s = useSyncStatus();
  const clickable = s.state !== "local" && s.state !== "syncing";
  return (
    <button
      type="button"
      onClick={() => clickable && void syncNow()}
      disabled={!clickable}
      title={s.state === "local" ? "本地模式：数据只存在这台设备" : s.message || `最后同步：${relativeTime(s.lastSyncAt)}`}
      data-testid="button-sync-indicator"
      data-sync-state={s.state}
      className={cn(
        "flex max-w-[11rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-none transition-colors",
        TONE[s.state],
        clickable && "hover-elevate",
        className,
      )}
    >
      <Icon state={s.state} />
      <span className="truncate" data-testid="text-sync-status">
        {statusLabel(s)}
      </span>
    </button>
  );
}

/** 断网细条提示 */
export function OfflineBar() {
  const s = useSyncStatus();
  if (s.online) return null;
  return (
    <div
      className="flex items-center justify-center gap-1.5 border-b border-chart-4/40 bg-chart-4/10 px-3 py-1 text-[11px] leading-relaxed text-chart-4"
      data-testid="bar-offline"
      role="status"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        当前离线，记录已存在本机{s.pending > 0 ? `（${s.pending} 项待上传）` : ""}，联网后会自动补传。
      </span>
    </div>
  );
}

/** 设置页用的「立即同步」按钮 */
export function SyncNowButton({ label = "立即同步" }: { label?: string }) {
  const s = useSyncStatus();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      data-testid="button-sync-now"
      disabled={busy || s.state === "syncing" || s.state === "local"}
      onClick={async () => {
        setBusy(true);
        try {
          await syncNow();
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm hover-elevate disabled:opacity-50"
    >
      <RotateCw className={cn("h-4 w-4", (busy || s.state === "syncing") && "animate-spin")} />
      {label}
    </button>
  );
}
