import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import type { Profile } from "@/lib/types";
import { Num, PageHeader } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import {
  Sparkles,
  Download,
  Upload,
  Trash2,
  KeyRound,
  Moon,
  Sun,
  Loader2,
  Database,
  CheckCircle2,
  ShieldAlert,
  HardDriveDownload,
} from "lucide-react";

export default function SettingsPage() {
  const { user, setUser, theme, setTheme } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const { data: profile } = useQuery<Profile>({ queryKey: ["/api/profile", userId] });
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [baseUrl, setBaseUrl] = useState(user?.aiBaseUrl ?? "https://api.openai.com/v1");
  const [model, setModel] = useState(user?.aiModel ?? "gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [clearStep, setClearStep] = useState<0 | 1 | 2 | 3>(0);
  const [clearPhrase, setClearPhrase] = useState("");

  const saveAi = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("PATCH", "/api/settings", { ...payload });
      return await res.json();
    },
    onSuccess: (d) => {
      setUser(d.user);
      setApiKey("");
      invalidateAll(userId);
      toast({ title: "设置已保存" });
    },
    onError: (e: any) => toast({ title: "保存失败", description: clean(e), variant: "destructive" }),
  });

  const testAi = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/test", {});
      return await res.json();
    },
    onSuccess: (d: any) =>
      toast({ title: d.ok ? "连接成功" : "连接失败", description: d.message, variant: d.ok ? undefined : "destructive" }),
    onError: (e: any) => toast({ title: "连接失败", description: clean(e), variant: "destructive" }),
  });

  const changePwd = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/change-password", { oldPassword, newPassword });
    },
    onSuccess: () => {
      setOldPassword("");
      setNewPassword("");
      toast({ title: "密码已更新" });
    },
    onError: (e: any) => toast({ title: "修改失败", description: clean(e), variant: "destructive" }),
  });

  const doExport = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", `/api/export/${userId}`);
      return await res.json();
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `discipline-rpg-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      invalidateAll(userId);
      toast({ title: "已导出 JSON 备份" });
    },
    onError: (e: any) => toast({ title: "导出失败", description: clean(e), variant: "destructive" }),
  });

  const doImport = useMutation({
    mutationFn: async (payload: any) => {
      await apiRequest("POST", "/api/import", { payload });
    },
    onSuccess: () => {
      invalidateAll(userId);
      toast({ title: "导入完成", description: "数据已恢复。" });
    },
    onError: (e: any) => toast({ title: "导入失败", description: clean(e), variant: "destructive" }),
  });

  const doClear = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/clear-data", {});
    },
    onSuccess: () => {
      invalidateAll(userId);
      setClearStep(0);
      setClearPhrase("");
      toast({ title: "数据已清空", description: "账号保留，所有任务与记录已删除。" });
    },
    onError: (e: any) => toast({ title: "清空失败", description: clean(e), variant: "destructive" }),
  });

  const demo = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/demo-seed", {});
      return await res.json();
    },
    onSuccess: () => {
      invalidateAll(userId);
      toast({ title: "演示数据已载入", description: "已为当前账号生成 60 天的任务与结算记录。" });
    },
    onError: (e: any) => toast({ title: "载入失败", description: clean(e), variant: "destructive" }),
  });

  const lastBackup = profile?.backup?.lastBackupAt
    ? new Date(profile.backup.lastBackupAt).toLocaleDateString("zh-CN")
    : null;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="设置"
        desc="账号、AI 建议服务、外观与数据管理。所有数据仅保存在本浏览器（IndexedDB），请定期导出备份。"
      />

      <div className="space-y-5">
        {/* 账号 */}
        <Section title="账号" icon={KeyRound}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">用户名</span>
            <Badge variant="secondary">{user?.username}</Badge>
            <span className="text-muted-foreground">等级</span>
            <Badge variant="secondary" className="num">
              Lv.{profile?.level ?? 1} {profile?.title ?? ""}
            </Badge>
            <span className="text-muted-foreground">积分</span>
            <Badge variant="secondary" className="num">
              {profile?.user.points ?? 0}
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="display-name">显示名称</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                data-testid="input-display-name"
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => saveAi.mutate({ displayName })}
              disabled={!displayName.trim() || saveAi.isPending}
              data-testid="button-save-name"
            >
              保存名称
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="old-password" className="block text-xs">
                当前密码
              </Label>
              <Input
                id="old-password"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                data-testid="input-old-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="block text-xs">
                新密码
              </Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="input-new-password"
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => changePwd.mutate()}
              disabled={!oldPassword || newPassword.length < 6 || changePwd.isPending}
              data-testid="button-change-password"
            >
              修改密码
            </Button>
          </div>
          {profile?.user.securityQuestion && (
            <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
              安全问题：{profile.user.securityQuestion}（忘记密码时用于重置）
            </p>
          )}
        </Section>

        {/* AI */}
        <Section title="AI 建议服务" icon={Sparkles}>
          <p className="text-xs text-muted-foreground leading-relaxed">
            填写任意 OpenAI 兼容接口即可。留空时系统使用内置规则引擎生成参数建议，功能完全可用。API Key 只保存在本浏览器
            IndexedDB（AES-256-GCM 加密存储），表单只会显示掩码后的后四位。接口地址必须为 https，不允许内网地址。
          </p>
          <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-chart-4/40 bg-chart-4/10 p-2.5">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-chart-4" />
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed">
              本应用无后端，AI 请求由浏览器直接发出。部分供应商（包括 OpenAI 官方接口）不允许网页端跳域调用，可能被 CORS
              拦下。若“测试连接”报网络/跳域错误，请改用允许跳域的接口或自建代理；内置规则引擎依然完全可用。
            </p>
          </div>
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-base-url">接口地址（Base URL）</Label>
              <Input
                id="ai-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                data-testid="input-ai-base-url"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ai-model">模型名称</Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  data-testid="input-ai-model"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-api-key">API Key</Label>
                <Input
                  id="ai-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={user?.hasKey ? user.aiKeyMasked : "sk-..."}
                  data-testid="input-ai-api-key"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => saveAi.mutate({ aiBaseUrl: baseUrl, aiModel: model, aiApiKey: apiKey })}
                disabled={saveAi.isPending}
                data-testid="button-save-ai"
              >
                {saveAi.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                保存配置
              </Button>
              <Button
                variant="secondary"
                onClick={() => testAi.mutate()}
                disabled={testAi.isPending || !user?.aiConfigured}
                data-testid="button-test-ai"
              >
                {testAi.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                测试连接
              </Button>
              {user?.aiConfigured && (
                <Button
                  variant="ghost"
                  onClick={() => saveAi.mutate({ clearApiKey: true })}
                  data-testid="button-clear-ai-key"
                >
                  清除密钥
                </Button>
              )}
              <Badge variant={user?.aiConfigured ? "default" : "secondary"} className="ml-auto">
                {user?.aiConfigured ? "已配置" : "使用内置规则"}
              </Badge>
            </div>
          </div>
        </Section>

        {/* 外观 */}
        <Section title="外观" icon={theme === "dark" ? Moon : Sun}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">深色模式</p>
              <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                深色为默认主题；浅色为暖白纸感配色，适合白天使用。
              </p>
            </div>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
              aria-label="切换深色模式"
              data-testid="switch-theme"
            />
          </div>
        </Section>

        {/* 数据 */}
        <Section title="数据备份" icon={HardDriveDownload}>
          <p className="text-xs leading-relaxed text-muted-foreground">
            数据只保存在本浏览器。清理浏览器数据、更换设备或使用无痕模式都会导致记录丢失，建议每两周导出一次备份。
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button size="lg" onClick={() => doExport.mutate()} disabled={doExport.isPending} data-testid="button-export">
              {doExport.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" />
              )}
              导出备份（.json）
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={doImport.isPending}
              data-testid="button-import"
            >
              {doImport.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              导入备份
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground" data-testid="text-last-backup">
            {lastBackup
              ? `上次导出：${lastBackup}（已过 ${profile?.backup?.daysSince ?? 0} 天）`
              : "尚未导出过备份。"}
            文件名包含当天日期，导入会覆盖当前账号的任务、日志、熟练度、成就与奖励。
          </p>
          <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const payload = JSON.parse(await f.text());
                  doImport.mutate(payload);
                } catch {
                  toast({ title: "文件解析失败", description: "请选择本应用导出的 JSON 备份。", variant: "destructive" });
                }
                e.target.value = "";
              }}
            data-testid="input-import-file"
          />
        </Section>

        {/* 数据管理 */}
        <Section title="数据管理" icon={Database}>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => demo.mutate()} disabled={demo.isPending} data-testid="button-load-demo-settings">
              {demo.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" />
              )}
              载入演示数据
            </Button>
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                setClearPhrase("");
                setClearStep(1);
              }}
              data-testid="button-clear-data"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              清空数据
            </Button>
          </div>
          <p className="mt-2.5 text-[11px] text-muted-foreground leading-relaxed">
            共 <Num>{profile?.unlockedAchievements.length ?? 0}</Num> 条成就、
            <Num>{profile?.unlockedNodes.length ?? 0}</Num> 个成长树节点、
            <Num>{profile?.backup?.settlements ?? 0}</Num> 条结算记录已保存。演示数据会追加到当前账号。
          </p>
        </Section>
      </div>

      {/* 清空数据：三重确认 */}
      <AlertDialog open={clearStep === 1} onOpenChange={(o) => !o && setClearStep(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">清空所有数据？（1/3）</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              将删除全部任务、结算日志、熟练度、成就、成长树节点与兑换记录，等级与积分归零。账号本身保留。数据只存在本浏览器，此操作无法撤销，建议先导出备份。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setClearStep(2);
              }}
              data-testid="button-confirm-clear-1"
            >
              我已了解，继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearStep === 2} onOpenChange={(o) => !o && setClearStep(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">请输入确认短语（2/3）</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              在下方输入框中输入「清空数据」以继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={clearPhrase}
            onChange={(e) => setClearPhrase(e.target.value)}
            placeholder="清空数据"
            data-testid="input-clear-phrase"
          />
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-2">取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={clearPhrase.trim() !== "清空数据"}
              onClick={(e) => {
                e.preventDefault();
                if (clearPhrase.trim() !== "清空数据") return;
                setClearStep(3);
              }}
              data-testid="button-confirm-clear-2"
            >
              继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearStep === 3} onOpenChange={(o) => !o && setClearStep(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">最后确认（3/3）</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              点击“确认清空”后立即执行，不可恢复。若尚未导出备份，请先取消并导出。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-3">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => doClear.mutate()}
              disabled={doClear.isPending}
              data-testid="button-confirm-clear"
            >
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function clean(e: any) {
  return String(e?.message ?? e).replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");
}
