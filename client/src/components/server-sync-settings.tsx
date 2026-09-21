import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useApp, invalidateAll } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cloudSignIn, cloudSignUp } from "@/lib/cloud-auth";
import { serverDisconnectCurrent } from "@/lib/localdb";
import { refreshSyncStatus, syncNow } from "@/lib/sync";
import { CloudCog, Link2, Loader2, Unlink } from "lucide-react";

export function ServerSyncSection() {
  const { user, setUser, isCloud } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const [serverUrl, setServerUrl] = useState(user?.cloudUserId ? "" : "https://你的域名或服务器地址");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");

  const connect = useMutation({
    mutationFn: async () => (mode === "register" ? cloudSignUp(serverUrl, email, password) : cloudSignIn(serverUrl, email, password)),
    onSuccess: async (d) => {
      setUser(d.user);
      setPassword("");
      invalidateAll(userId);
      await syncNow();
      await refreshSyncStatus();
      toast({ title: "在线账号已连接", description: "正在使用自托管后端实时同步。" });
    },
    onError: (e: any) => toast({ title: "连接失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: async () => serverDisconnectCurrent(),
    onSuccess: async (d: any) => {
      setUser(d.user);
      invalidateAll(userId);
      await refreshSyncStatus();
      toast({ title: "已断开在线账号", description: "账号恢复为本地模式。" });
    },
    onError: (e: any) => toast({ title: "断开失败", description: String(e?.message ?? e), variant: "destructive" }),
  });

  return (
    <section className="rounded-2xl border border-card-border bg-card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <CloudCog className="h-4 w-4 text-primary" />
        在线云同步
      </h2>

      {isCloud ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary" className="max-w-full break-all">
              {user?.email || "在线账号"}
            </Badge>
            <Badge variant="default" className="text-[11px]">
              已连接
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            在线后端负责账号登录和云存档，操作会即时提交，其他设备会自动拉取最新数据。断网时本地仍会兜底保存，联网后立即同步。
          </p>
          <Button variant="outline" disabled={disconnect.isPending} onClick={() => disconnect.mutate()} data-testid="button-server-disconnect">
            {disconnect.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Unlink className="mr-1.5 h-4 w-4" />}
            断开在线账号
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            输入你部署的自托管后端地址、邮箱和密码。第一次使用先选“注册”，之后换设备选“登录”即可继承同一份云存档。
          </p>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="server-url" className="text-xs">
                服务器地址
              </Label>
              <Input
                id="server-url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://你的域名"
                data-testid="input-server-url"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="server-email" className="text-xs">
                  邮箱
                </Label>
                <Input id="server-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-server-email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="server-password" className="text-xs">
                  密码
                </Label>
                <Input id="server-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-server-password" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setMode((v) => (v === "login" ? "register" : "login"))}
              data-testid="button-server-switch-mode"
            >
              {mode === "login" ? "切换到注册" : "切换到登录"}
            </Button>
            <Button disabled={connect.isPending || !serverUrl || !email || password.length < 6} onClick={() => connect.mutate()} data-testid="button-server-connect">
              {connect.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
              {mode === "login" ? "连接并同步" : "注册并同步"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
