import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo, Num } from "@/components/bits";
import { ACHIEVEMENTS } from "@shared/achievements";
import { Loader2, Sparkles, Cloud } from "lucide-react";
import { CATEGORIES } from "@shared/gameRules";
import { cloudSignIn, cloudSignUp } from "@/lib/cloud-auth";

export default function AuthPage() {
  const { setSession } = useApp();
  const { toast } = useToast();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = useMutation({
    mutationFn: async () => (mode === "login" ? cloudSignIn(email, password) : cloudSignUp(email, password)),
    onSuccess: (d) => {
      toast({
        title: mode === "login" ? "已登录在线账号" : "在线账号已创建",
        description: "正在同步云端最新数据…",
      });
      setSession(d.user, d.token);
    },
    onError: (e: any) => toast({ title: mode === "login" ? "登录失败" : "注册失败", description: cleanErr(e), variant: "destructive" }),
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
              在线实时存档 · 多设备同步 · 无惩罚正向督促
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-card-border bg-card p-5 shadow-lg sm:p-6">
          <div className="space-y-4">
            <div>
              <p className="flex items-center gap-1.5 text-base font-semibold">
                <Cloud className="h-4 w-4 text-primary" />
                {mode === "login" ? "登录在线账号" : "注册在线账号"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                所有数据直接保存在在线账号里，换设备登录同一邮箱即可继续。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auth-email">邮箱</Label>
              <Input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-online-email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-password">密码</Label>
              <Input id="auth-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-online-password" />
            </div>

            <Button
              className="w-full"
              disabled={submit.isPending || !email || password.length < 6}
              onClick={() => submit.mutate()}
              data-testid="button-online-submit"
            >
              {submit.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {mode === "login" ? "登录并同步" : "注册并进入"}
            </Button>

            <button
              className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setMode((v) => (v === "login" ? "register" : "login"))}
              data-testid="button-online-switch-mode"
            >
              {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-5 gap-1.5">
          {CATEGORIES.map((c) => (
            <div key={c.key} className="rounded-lg border border-card-border bg-card/70 px-1 py-2 text-center" title={c.name}>
              <div className="mx-auto mb-1 h-1.5 w-6 rounded-full" style={{ background: `hsl(var(${c.colorVar}))` }} />
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

function cleanErr(e: any) {
  const raw = String(e?.message ?? e);
  const m = raw.match(/\{"message":"(.+?)"\}/);
  return m ? m[1] : raw.replace(/^\d+:\s*/, "");
}
