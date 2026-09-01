import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiRequest, queryClient, setAuthToken, setUnauthorizedHandler } from "./queryClient";
import { restoreSession, isStorageAvailable } from "./localdb";
import { currentCloudUser, cloudSignOut } from "./cloud-auth";
import { markLocalMode, refreshSyncStatus, setSyncInvalidator, startSyncLoop, syncNow } from "./sync";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  xp: number;
  points: number;
  theme: string;
  aiConfigured: boolean;
  hasKey?: boolean;
  aiBaseUrl: string;
  aiModel: string;
  aiKeyMasked: string;
  securityQuestion?: string;
  cloudUserId?: string | null;
  email?: string;
};

type Ctx = {
  user: SessionUser | null;
  /** 登录/注册成功后调用 */
  setSession: (u: SessionUser | null, token: string | null) => void;
  setUser: (u: SessionUser | null) => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  logout: () => void;
  /** 启动时正在恢复会话 */
  booting: boolean;
  /** 浏览器本地存储（IndexedDB）是否可用 */
  storageOk: boolean;
  /** 当前账号是否已接入云端同步 */
  isCloud: boolean;
};

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [theme, setThemeState] = useState<"dark" | "light">("dark");
  const [booting, setBooting] = useState(true);
  const [storageOk, setStorageOk] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // 启动：初始化本地存储并恢复「记住登录状态」的会话
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await restoreSession();
        if (cancelled) return;
        if (res.user) {
          const u = res.user as SessionUser;
          // 云端账号：本机会话还在，但云端 session 已失效（未勾选「记住登录状态」）→ 回到登录页
          if (u.cloudUserId) {
            const cloud = await currentCloudUser();
            if (cancelled) return;
            if (!cloud || cloud.id !== u.cloudUserId) {
              setAuthToken(null);
              return;
            }
          }
          setAuthToken(res.token);
          setUserState(u);
          const t = u.theme;
          if (t === "light" || t === "dark") setThemeState(t);
        }
      } catch {
        /* 忽略：无会话可恢复 */
      } finally {
        if (!cancelled) {
          setStorageOk(isStorageAvailable());
          setBooting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 全局 401：清空 token 与用户，回到登录页
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setUserState((prev) => {
        if (prev) {
          queryClient.clear();
          toast({ title: "会话已过期，请重新登录", variant: "destructive" });
        }
        return null;
      });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  function setUser(u: SessionUser | null) {
    setUserState(u);
    if (u?.theme === "light" || u?.theme === "dark") setThemeState(u.theme);
  }

  // 同步引擎：登录云端账号后启动后台同步；本地模式只显示「本地模式」
  useEffect(() => {
    if (booting) return;
    setSyncInvalidator(() => {
      queryClient.invalidateQueries();
    });
    if (user?.cloudUserId) {
      void refreshSyncStatus().then(() => startSyncLoop());
    } else {
      markLocalMode();
    }
    return () => setSyncInvalidator(null);
  }, [booting, user?.cloudUserId]);

  function setSession(u: SessionUser | null, token: string | null) {
    setAuthToken(token);
    setUser(u);
  }

  function setTheme(t: "dark" | "light") {
    setThemeState(t);
    if (user) {
      apiRequest("PATCH", "/api/settings", { theme: t }).catch(() => {});
      setUserState({ ...user, theme: t });
    }
  }

  function logout() {
    const wasCloud = !!user?.cloudUserId;
    if (wasCloud) {
      // 尽力先把队列推完，再登出，避免离线记录留在本机
      void syncNow()
        .catch(() => {})
        .finally(() => void cloudSignOut());
    }
    apiRequest("POST", "/api/logout").catch(() => {});
    setAuthToken(null);
    setUserState(null);
    markLocalMode();
    queryClient.clear();
  }

  return (
    <AppContext.Provider
      value={{ user, setUser, setSession, theme, setTheme, logout, booting, storageOk, isCloud: !!user?.cloudUserId }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp 必须在 AppProvider 内使用");
  return ctx;
}

/** 本地存储不可用时的可关闭提示条（预览 iframe 环境） */
export function StorageBanner() {
  const { storageOk } = useApp();
  const [closed, setClosed] = useState(false);
  if (storageOk || closed) return null;
  return (
    <div
      className="mb-4 flex items-start gap-2.5 rounded-lg border border-chart-4/40 bg-chart-4/10 p-3"
      data-testid="banner-storage-unavailable"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-chart-4" />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-foreground">
        当前环境不支持本地存储，数据仅保存在本次会话中。请在正式网址下使用。
      </p>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 shrink-0"
        aria-label="关闭提示"
        data-testid="button-dismiss-storage-banner"
        onClick={() => setClosed(true)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function useUserId(): number {
  const { user } = useApp();
  return user?.id ?? 0;
}

/** 结算后需要刷新的数据 */
export function invalidateAll(userId: number) {
  for (const key of [
    "/api/profile",
    "/api/tasks",
    "/api/logs",
    "/api/stats",
    "/api/rewards",
    "/api/redemptions",
    "/api/upkeep",
  ]) {
    queryClient.invalidateQueries({ queryKey: [key, userId] });
  }
}
