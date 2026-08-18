import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo, Num } from "@/components/bits";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldQuestion, Sparkles, AlertTriangle } from "lucide-react";
import { CATEGORIES } from "@shared/gameRules";

type Mode = "login" | "register" | "reset";

export default function AuthPage() {
  const { setSession, storageOk } = useApp();
  const { toast } = useToast();
  const { data: boot, isLoading } = useQuery<{ hasUsers: boolean }>({ queryKey: ["/api/bootstrap"] });
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [question, setQuestion] = useState("我的第一位导师姓什么？");
  const [answer, setAnswer] = useState("");
  const [resetQuestion, setResetQuestion] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (boot && !boot.hasUsers) setMode("register");
  }, [boot]);

  const login = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/login", { username, password, remember });
      return await res.json();
    },
    onSuccess: (d) => setSession(d.user, d.token ?? null),
    onError: (e: any) => toast({ title: "登录失败", description: cleanErr(e), variant: "destructive" }),
  });

  const register = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/register", {
        username,
        password,
        displayName,
        securityQuestion: question,
        securityAnswer: answer,
        remember,
      });
      return await res.json();
    },
    onSuccess: (d) => {
      toast({ title: "账号已创建", description: "开始记录你的第一件小事吧。" });
      setSession(d.user, d.token ?? null);
    },
    onError: (e: any) => toast({ title: "注册失败", description: cleanErr(e), variant: "destructive" }),
  });

  const fetchQuestion = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", `/api/security-question/${encodeURIComponent(username)}`);
      return await res.json();
    },
    onSuccess: (d) => setResetQuestion(d.question || "（该账号未设置安全问题）"),
    onError: (e: any) => toast({ title: "查询失败", description: cleanErr(e), variant: "destructive" }),
  });

  const reset = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/reset-password", { username, answer, newPassword });
    },
    onSuccess: () => {
      toast({ title: "密码已重置", description: "请用新密码登录。" });
      setMode("login");
      setPassword("");
    },
    onError: (e: any) => toast({ title: "重置失败", description: cleanErr(e), variant: "destructive" }),
  });

  const demo = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/demo-account", {});
      return await res.json();
    },
    onSuccess: (d) => {
      toast({
        title: "演示数据已载入",
        description: `账号 ${d.username} / 密码 ${d.password}，可直接查看图表与面板。`,
      });
      setSession(d.user, d.token ?? null);
    },
    onError: (e: any) => toast({ title: "载入失败", description: cleanErr(e), variant: "destructive" }),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 paper-grain">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="text-primary">
            <Logo size={38} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">自律成长系统</h1>
            <p className="text-xs text-muted-foreground leading-tight">
              沉静的学者书房 × RPG 状态面板 · 无惩罚，只做正向督促
            </p>
          </div>
        </div>

        {!storageOk && (
          <div
            className="mb-4 flex items-start gap-2.5 rounded-lg border border-chart-4/40 bg-chart-4/10 p-3"
            data-testid="banner-storage-unavailable-auth"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-chart-4" />
            <p className="min-w-0 flex-1 text-xs leading-relaxed">
              当前环境不支持本地存储，数据仅保存在本次会话中。请在正式网址下使用。
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-card-border bg-card p-5 shadow-lg sm:p-6">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : mode === "reset" ? (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold">通过安全问题重置密码</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  输入用户名后获取你注册时设置的安全问题，答对即可设置新密码。
                </p>
              </div>
              <Field label="用户名" value={username} onChange={setUsername} testId="input-reset-username" />
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => fetchQuestion.mutate()}
                disabled={!username || fetchQuestion.isPending}
                data-testid="button-fetch-question"
              >
                <ShieldQuestion className="mr-1.5 h-4 w-4" />
                获取安全问题
              </Button>
              {resetQuestion && (
                <p className="rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed" data-testid="text-security-question">
                  {resetQuestion}
                </p>
              )}
              <Field label="答案" value={answer} onChange={setAnswer} testId="input-reset-answer" />
              <Field
                label="新密码"
                value={newPassword}
                onChange={setNewPassword}
                type="password"
                testId="input-reset-new-password"
              />
              <Button
                className="w-full"
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
                data-testid="button-submit-reset"
              >
                重置密码
              </Button>
              <button
                className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setMode("login")}
                data-testid="button-back-to-login"
              >
                返回登录
              </button>
            </div>
          ) : mode === "register" ? (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold">创建账号</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  数据全部保存在本浏览器（IndexedDB），不上传任何服务器。
                </p>
              </div>
              <Field label="用户名" value={username} onChange={setUsername} testId="input-register-username" />
              <Field label="显示名称（可选）" value={displayName} onChange={setDisplayName} testId="input-register-displayname" />
              <Field label="密码（至少 6 位）" value={password} onChange={setPassword} type="password" testId="input-register-password" />
              <Field label="安全问题" value={question} onChange={setQuestion} testId="input-register-question" />
              <Field label="安全问题答案" value={answer} onChange={setAnswer} testId="input-register-answer" />
              <RememberBox checked={remember} onChange={setRemember} testId="checkbox-remember-register" />
              <Button
                className="w-full"
                onClick={() => register.mutate()}
                disabled={register.isPending}
                data-testid="button-submit-register"
              >
                {register.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                创建并进入
              </Button>
              {boot?.hasUsers && (
                <button
                  className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => setMode("login")}
                  data-testid="button-switch-login"
                >
                  已有账号？返回登录
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold">登录</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  数据保存在本浏览器（IndexedDB），不上传任何服务器。
                </p>
              </div>
              <Field label="用户名" value={username} onChange={setUsername} testId="input-login-username" />
              <Field label="密码" value={password} onChange={setPassword} type="password" testId="input-login-password" />
              <RememberBox checked={remember} onChange={setRemember} testId="checkbox-remember-login" />
              <Button
                className="w-full"
                onClick={() => login.mutate()}
                disabled={login.isPending}
                data-testid="button-submit-login"
              >
                {login.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                进入系统
              </Button>
              <div className="flex items-center justify-between gap-2 text-xs">
                <button
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => setMode("reset")}
                  data-testid="button-forgot-password"
                >
                  忘记密码？
                </button>
                <button
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => setMode("register")}
                  data-testid="button-switch-register"
                >
                  创建新账号
                </button>
              </div>
            </div>
          )}

          {mode !== "reset" && (
            <div className="mt-4 border-t border-card-border pt-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => demo.mutate()}
                disabled={demo.isPending}
                data-testid="button-load-demo"
              >
                {demo.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                载入演示数据
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                一键创建一个已有 60 天记录的演示账号，可立即查看图表、成就与成长树。
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-5 gap-1.5">
          {CATEGORIES.map((c) => (
            <div
              key={c.key}
              className="rounded-lg border border-card-border bg-card/70 px-1 py-2 text-center"
              title={c.name}
            >
              <div
                className="mx-auto mb-1 h-1.5 w-6 rounded-full"
                style={{ background: `hsl(var(${c.colorVar}))` }}
              />
              <span className="block truncate text-[10px] text-muted-foreground">{c.name}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground leading-relaxed">
          五大类别独立熟练度 · <Num>4</Num> 种结算模式 · <Num>36</Num> 条成就 · <Num>30</Num> 节点成长树
        </p>
      </div>
    </div>
  );
}

function RememberBox({
  checked,
  onChange,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={testId}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        data-testid={testId}
        className="mt-0.5"
      />
      <Label htmlFor={testId} className="text-xs font-normal leading-relaxed text-muted-foreground">
        记住登录状态（30 天内刷新页面无需重新登录）
      </Label>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  testId: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={testId}>{label}</Label>
      <Input id={testId} type={type} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </div>
  );
}

function cleanErr(e: any) {
  const raw = String(e?.message ?? e);
  const m = raw.match(/\{"message":"(.+?)"\}/);
  return m ? m[1] : raw.replace(/^\d+:\s*/, "");
}
