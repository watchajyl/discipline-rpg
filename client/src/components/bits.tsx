import { motion } from "framer-motion";
import {
  GraduationCap,
  Languages,
  Sprout,
  Users,
  Coins,
  Timer,
  ListChecks,
  CalendarCheck,
  Hash,
  type LucideIcon,
} from "lucide-react";
import { CATEGORIES, categoryName, modeName } from "@shared/gameRules";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

// ---------------- 品牌标识 ----------------
export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="自律成长系统标识"
      role="img"
      className={className}
    >
      <path
        d="M16 4 27.2 10.4v12.8L16 29.6 4.8 23.2V10.4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.5"
      />
      <path d="M16 11v10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M11 14v6.5M21 14v6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="8.4" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="text-primary shrink-0">
        <Logo size={26} />
      </span>
      {!compact && (
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-tight truncate">自律成长系统</span>
          <span className="block text-[11px] text-muted-foreground leading-tight truncate">
            Discipline&nbsp;RPG
          </span>
        </span>
      )}
    </div>
  );
}

// ---------------- 图标映射 ----------------
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  academic: GraduationCap,
  language: Languages,
  life: Sprout,
  social: Users,
  finance: Coins,
};

export const MODE_ICONS: Record<string, LucideIcon> = {
  timer: Timer,
  milestone: ListChecks,
  habit: CalendarCheck,
  count: Hash,
};

export function catColor(cat: string) {
  const c = CATEGORIES.find((x) => x.key === cat);
  return `hsl(var(${c?.colorVar ?? "--primary"}))`;
}

export function CategoryChip({ cat, className }: { cat: string; className?: string }) {
  const Icon = CATEGORY_ICONS[cat] ?? GraduationCap;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        className,
      )}
      style={{ color: catColor(cat), backgroundColor: `color-mix(in srgb, ${catColor(cat)} 14%, transparent)` }}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {categoryName(cat)}
    </span>
  );
}

export function ModeChip({ mode }: { mode: string }) {
  const Icon = MODE_ICONS[mode] ?? Timer;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
      <Icon className="h-3 w-3 shrink-0" />
      {modeName(mode)}
    </span>
  );
}

// ---------------- 环形进度 ----------------
export function Ring({
  ratio,
  size = 64,
  stroke = 6,
  color = "hsl(var(--primary))",
  track = "hsl(var(--muted))",
  children,
  label,
}: {
  ratio: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - clamped) }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        {children}
      </div>
    </div>
  );
}

export function Bar({
  ratio,
  color = "hsl(var(--primary))",
  className,
  height = 8,
}: {
  ratio: number;
  color?: string;
  className?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-muted", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${clamped * 100}%` }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

// ---------------- 页面骨架 ----------------
export function PageHeader({
  title,
  desc,
  actions,
}: {
  title: string;
  desc?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-bold leading-tight">{title}</h1>
        {desc && <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  desc,
  action,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/40 px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground leading-relaxed">{desc}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("num", className)}>{children}</span>;
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted/70", className)} />;
}

export function formatMinutes(min: number) {
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}
