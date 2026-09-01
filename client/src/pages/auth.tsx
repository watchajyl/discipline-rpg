import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo, Num } from "@/components/bits";
import { ACHIEVEMENTS } from "@shared/achievements";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldQuestion, Sparkles, AlertTriangle, Cloud, HardDrive, MailCheck } from "lucide-react";
import { CATEGORIES } from "@shared/gameRules";
import { cloudResetPassword, cloudSignIn, cloudSignUp } from "@/lib/cloud-auth";
import { rememberEnabled, setRememberEnabled } from "@/lib/supabase";

type Mode = "login" | "register" | "reset";
type Track = "cloud" | "local";

export default function AuthPage() {
  const { setSession, storageOk } = useApp();
  const { toast } = useToast();
  const { data: boot, isLoading } = useQuery<{ hasUsers: boolean }>({ queryKey: ["/api/bootstrap"] });
  const [track, setTrack] = useState<Track>("cloud");
  const [mode, setMode] = useState<Mode>("login");

  // 云端账号
  const [email, setEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [cloudName, setCloudName] = useState("");
  const [remember, setRemember] = useState(rememberEnabled());
  const [confirmSent, setConfirmSent] = useState("");

  // 本地模式
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [question, setQuestion] = useState("我的第一位导师姓什么？");
  const [answer, setAnswer] = useState("");
  const [resetQuestion, setResetQuestion] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    setRememberEnabled(remember);
  }, [remember]);

  useEffect(() => {
    if (track === "local" && boot && !boot.hasUsers) setMode("register");
  }, [boot, track]);

  // ---------------- 云端 ----------------
  const cloudLogin = useMutation({
    mutationFn: () => cloudSignIn(email, cloudPassword, remember),
    onSuccess: (d) => {
      setConfirmSent("");
      toast({ title: "已登录云端账号", description: "正在与云端同步你的记录…" });
      setSession(d.user, d.token);
    },
    onError: (e: any) => toast({ title: "登录失败", description: cleanErr(e), variant: "destructive" }),
  });

  const cloudRegister = useMutation({
    mutationFn: () => cloudSignUp(email, cloudPassword, cloudName, remember),
    onSuccess: (d: any) => {
      if (d?.needsConfirm) {
        setConfirmSent(d.email);
        setMode("login");
        toast({ title: "确认邮件已发出", description: "点开邮件里的链接完成确认后，就可以登录了。" });
        return;
      }
      toast({ title: "云端账号已创建", description: "开始记录你的第一件小事吧。" });
      setSession(d.user, d.token);
    },
    onError: (e: any) => toast({ title: "注册失败", description: cleanErr(e), variant: "destructive" }),
  });

  const cloudReset = useMutation({
    mutationFn: () => cloudResetPassword(email),
    onSuccess: () => {
      toast({ title: "重置邮件已发出", description: "请查收邮箱，按链接设置新密码。" });
      setMode("login");
    },
    onError: (e: any) => toast({ title: "发送失败", description: cleanErr(e), variant: "destructive" }),
  });

  // ---------------- 本地模式 ----------------
  const login = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/login", { username, password, remember: true });
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
        remember: true,
      });
      return await res.json();
    },
    onSuccess: (d) => {
      toast({ title: "本地账号已创建", description: "数据只存在这台设备上，随时可以升级为云端账号。" });
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
        description: `本地账号 ${d.username} / 密码 ${d.password}，可直接查看图表与面板。`,
      });
      setSession(d.user, d.token ?? null);
    },
    onError: (e: any) => toast({ title: "载入失败", description: cleanErr(e), variant: "destructive" }),
  });

  const busy =
    cloudLogin.isPending || cloudRegister.isPending || cloudReset.isPending || login.isPending || register.isPending;

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
          {/* 两种入口 */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            <TrackTab
              active={track === "cloud"}
              icon={Cloud}
              label="云端账号"
              testId="tab-track-cloud"
              onClick={() => {
                setTrack("cloud");
                setMode("login");
              }}
            />
            <TrackTab
              active={track === "local"}
              icon={HardDrive}
              label="本地模式"
              testId="tab-track-local"
              onClick={() => {
                setTrack("local");
                setMode(boot && !boot.hasUsers ? "register" : "login");
              }}
            />
          </div>

          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : track === "cloud" ? (
            <div className="space-y-4">
              {confirmSent && (
                <div
                  className="flex items-start gap-2.5 rounded-lg border border-primary/40 bg-primary/10 p-3"
                  data-testid="banner-confirm-sent"
                >
                  <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="min-w-0 flex-1 text-xs leading-relaxed">
                    确认邮件已发到 <span className="break-all font-medium">{confirmSent}</span>
                    ，点开链接完成确认后回来登录即可。
                  </p>
                </div>
              )}

              {mode === "reset" ? (
                <>
                  <div>
                    <p className="text-base font-semibold">重置云端账号密码</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      我们会给这个邮箱发一封重置链接，按链接设置新密码。
                    </p>
                  </div>
                  <Field label="邮箱" value={email} onChange={setEmail} type="email" testId="input-cloud-reset-email" />
                  <Button
                    className="w-full"
                    onClick={() => cloudReset.mutate()}
                    disabled={!email || cloudReset.isPending}
                    data-testid="button-cloud-reset"
                  >
                    {cloudReset.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    发送重置邮件
                  </Button>
                  <button
                    className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => setMode("login")}
                    data-testid="button-cloud-back-login"
                  >
                    返回登录
                  </button>
                </>
              ) : mode === "register" ? (
                <>
                  <div>
                    <p className="text-base font-semibold">注册云端账号</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      记录仍然完整存在本机（离线可用），同时自动备份到云端，换设备登录就能接着用。
                    </p>
                  </div>
                  <Field label="邮箱" value={email} onChange={setEmail} type="email" testId="input-cloud-email" />
                  <Field
                    label="显示名称（可选）"
                    value={cloudName}
                    onChange={setCloudName}
                    testId="input-cloud-displayname"
                  />
                  <Field
                    label="密码（至少 6 位）"
                    value={cloudPassword}
                    onChange={setCloudPassword}
                    type="password"
                    testId="input-cloud-password"
                  />
                  <RememberBox checked={remember} onChange={setRemember} testId="checkbox-remember-cloud-register" />
                  <Button
                    className="w-full"
                    onClick={() => cloudRegister.mutate()}
                    disabled={busy}
                    data-testid="button-cloud-register"
                  >
                    {cloudRegister.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    注册并进入
                  </Button>
                  <button
                    className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => setMode("login")}
                    data-testid="button-cloud-switch-login"
                  >
                    已有账号？返回登录
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-base font-semibold">登录云端账号</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      多设备同步，断网也能照常打卡，联网后自动补传。
                    </p>
                  </div>
                  <Field label="邮箱" value={email} onChange={setEmail} type="email" testId="input-cloud-email" />
                  <Field
                    label="密码"
                    value={cloudPassword}
                    onChange={setCloudPassword}
                    type="password"
                    testId="input-cloud-password"
                  />
                  <RememberBox checked={remember} onChange={setRemember} testId="checkbox-remember-cloud-login" />
                  <Button
                    className="w-full"
                    onClick={() => cloudLogin.mutate()}
                    disabled={busy}
                    data-testid="button-cloud-login"
                  >
                    {cloudLogin.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    登录并同步
                  </Button>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <button
                      className="text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => setMode("reset")}
                      data-testid="button-cloud-forgot"
                    >
                      忘记密码？
                    </button>
                    <button
                      className="text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => setMode("register")}
                      data-testid="button-cloud-switch-register"
                    >
                      注册云端账号
                    </button>
                  </div>
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                    只同步任务、结算、成就与维持记录。你的 AI API Key
                    <span className="font-medium text-foreground">不会上云</span>，仅在本机加密保存。
                  </p>
                </>
              )}
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
                <p className="text-base font-semibold">创建本地账号</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  数据全部保存在本浏览器（IndexedDB），不上传任何服务器。以后想多设备同步，可以随时在设置页升级为云端账号。
                </p>
              </div>
              <Field label="用户名" value={username} onChange={setUsername} testId="input-register-username" />
              <Field label="显示名称（可选）" value={displayName} onChange={setDisplayName} testId="input-register-displayname" />
              <Field label="密码（至少 6 位）" value={password} onChange={setPassword} type="password" testId="input-register-password" />
              <Field label="安全问题" value={question} onChange={setQuestion} testId="input-register-question" />
              <Field label="安全问题答案" value={answer} onChange={setAnswer} testId="input-register-answer" />
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
                  已有本地账号？返回登录
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold">登录本地账号</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  数据保存在本浏览器（IndexedDB），不上传任何服务器。
                </p>
              </div>
              <Field label="用户名" value={username} onChange={setUsername} testId="input-login-username" />
              <Field label="密码" value={password} onChange={setPassword} type="password" testId="input-login-password" />
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
                一键创建一个已有 60 天记录的本地演示账号，可立即查看图表、成就与成长树。
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
          五大类别独立熟练度 · <Num>4</Num> 种结算模式 · <Num>{ACHIEVEMENTS.length}</Num> 条成就 · <Num>30</Num> 节点成长树
        </p>
      </div>
    </div>
  );
}

function TrackTab({
  active,
  icon: Icon,
  label,
  testId,
  onClick,
}: {
  active: boolean;
  icon: typeof Cloud;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={
        "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors " +
        (active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
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
        记住登录状态（下次打开无需重新登录）
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
