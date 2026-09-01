import { Link, useLocation } from "wouter";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  ListTodo,
  Trophy,
  Network,
  Gift,
  BarChart3,
  Settings as SettingsIcon,
  Menu,
  X,
  Moon,
  Sun,
  LogOut,
  Coins,
} from "lucide-react";
import { BrandMark, Num } from "./bits";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { Profile } from "@/lib/types";
import { levelTitle } from "@shared/gameRules";
import { OfflineBar, SyncIndicator } from "./sync-status";

const NAV = [
  { href: "/", label: "今日面板", icon: LayoutDashboard },
  { href: "/tasks", label: "任务管理", icon: ListTodo },
  { href: "/achievements", label: "成就", icon: Trophy },
  { href: "/skill-tree", label: "成长树", icon: Network },
  { href: "/rewards", label: "积分商城", icon: Gift },
  { href: "/stats", label: "数据统计", icon: BarChart3 },
  { href: "/settings", label: "设置", icon: SettingsIcon },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = location === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            data-testid={`link-nav-${item.href === "/" ? "today" : item.href.slice(1)}`}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover-elevate",
              active
                ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80",
            )}
          >
            <item.icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function UserBlock() {
  const { user, logout, theme, setTheme } = useApp();
  const { data: profile } = useQuery<Profile>({
    queryKey: ["/api/profile", user?.id],
    enabled: !!user,
  });
  if (!user) return null;
  return (
    <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" data-testid="text-sidebar-username">
            {user.displayName}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            Lv.<Num>{profile?.level ?? 1}</Num> · {profile?.title ?? levelTitle(1)}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="切换主题"
            data-testid="button-toggle-theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="退出登录"
            data-testid="button-logout"
            onClick={logout}
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Coins className="h-3.5 w-3.5 text-cat-finance" />
        <span>
          积分 <Num className="font-semibold text-foreground" data-testid="text-sidebar-points">{profile?.user.points ?? 0}</Num>
        </span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      {/* 桌面侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col justify-between border-r border-sidebar-border bg-sidebar px-3 py-4 lg:flex">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2.5 px-1">
            <BrandMark />
            <SyncIndicator className="self-start" />
          </div>
          <NavLinks />
        </div>
        <UserBlock />
      </aside>

      {/* 移动端顶栏 */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur lg:hidden">
        <OfflineBar />
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <BrandMark />
        <div className="flex min-w-0 shrink items-center gap-1.5">
        <SyncIndicator />
        <Button
          size="icon"
          variant="ghost"
          aria-label="打开导航"
          data-testid="button-open-nav"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        </div>
        </div>
      </header>

      <div className="hidden lg:block lg:pl-60">
        <OfflineBar />
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col justify-between border-r border-sidebar-border bg-sidebar px-3 py-4">
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between px-1">
                <BrandMark />
                <Button size="icon" variant="ghost" aria-label="关闭导航" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <UserBlock />
          </div>
        </div>
      )}

      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-7">{children}</div>
      </main>
    </div>
  );
}
