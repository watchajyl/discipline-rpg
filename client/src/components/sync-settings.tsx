// 设置页「同步」分区 + V1/本地数据迁移引导（SPEC-V2 1.2 / 1.6）
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { invalidateAll, useApp } from "@/lib/app-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Num } from "@/components/bits";
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
import { CloudCog, HardDriveDownload, Loader2, ShieldCheck, Upload } from "lucide-react";
import { importBackupToCloud, localOnlyAccounts, migrateLocalAccountToCloud, resetLocalForCloud } from "@/lib/localdb";
import { refreshSyncStatus, syncNow } from "@/lib/sync";
import { relativeTime, SyncNowButton, useSyncStatus } from "./sync-status";

type LocalAccount = Awaited<ReturnType<typeof localOnlyAccounts>>[number];

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
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

export function SyncSettingsSection() {
  const { user, isCloud } = useApp();
  const userId = user?.id ?? 0;
  const { toast } = useToast();
  const s = useSyncStatus();
  const fileRef = useRef<HTMLInputElement>(null);
  const [forceStep, setForceStep] = useState<0 | 1 | 2 | 3>(0);
  const [forcePhrase, setForcePhrase] = useState("");

  const { data: locals = [], refetch } = useQuery<LocalAccount[]>({
    queryKey: ["local-only-accounts", userId],
    queryFn: () => localOnlyAccounts(),
    enabled: isCloud,
  });

  useEffect(() => {
    void refreshSyncStatus();
  }, [userId]);

  const migrate = useMutation({
    mutationFn: (id: number) => migrateLocalAccountToCloud(id),
    onSuccess: async (r: any) => {
      invalidateAll(userId);
      await refetch();
      await syncNow();
      queryClient.invalidateQueries();
      toast({
        title: "本地数据已并入云端账号",
        description: `迁移后积分 ${r.after.points}、经验 ${r.after.xp}（迁移前 ${r.before.points} / ${r.before.xp}），数值未变。`,
      });
    },
    onError: (e: any) => toast({ title: "迁移失败", description: clean(e), variant: "destructive" }),
  });

  const importBackup = useMutation({
    mutationFn: (payload: any) => importBackupToCloud(payload),
    onSuccess: async (r: any) => {
      invalidateAll(userId);
      await syncNow();
      queryClient.invalidateQueries();
      toast({ title: "备份已导入云端账号", description: `当前积分 ${r.points}、经验 ${r.xp}。` });
    },
    onError: (e: any) => toast({ title: "导入失败", description: clean(e), variant: "destructive" }),
  });

  const forcePull = useMutation({
    mutationFn: async () => {
      const cloudId = user?.cloudUserId;
      if (!cloudId) throw new Error("当前不是云端账号");
      await resetLocalForCloud(cloudId);
      await syncNow();
    },
    onSuccess: () => {
      setForceStep(0);
      setForcePhrase("");
      queryClient.invalidateQueries();
      toast({ title: "已以云端为准重新拉取", description: "本机数据已用云端记录覆盖。" });
    },
    onError: (e: any) => toast({ title: "重拉失败", description: clean(e), variant: "destructive" }),
  });

  if (!isCloud) {
    return (
      <Section title="同步" icon={CloudCog}>
        <p className="text-xs leading-relaxed text-muted-foreground">
          当前是<span className="font-medium text-foreground">本地模式</span>
          ，数据只保存在这台设备的浏览器里（IndexedDB），不上传任何服务器。
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          想在手机和电脑之间接着用？退出登录后选择「云端账号」注册一个，再回到设置页把这份本地数据一键并入即可，数值一分不变。
        </p>
      </Section>
    );
  }

  return (
    <>
      <Section title="同步" icon={CloudCog}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">账号</span>
          <Badge variant="secondary" className="max-w-full break-all">
            {user?.email || user?.username}
          </Badge>
          <span className="text-muted-foreground">状态</span>
          <Badge variant="secondary" data-testid="badge-sync-state">
            {s.state === "idle" ? "已同步" : s.state === "syncing" ? "同步中" : s.state === "offline" ? "离线" : "同步失败"}
          </Badge>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <dt className="text-muted-foreground">最后同步</dt>
            <dd className="mt-0.5 font-medium" data-testid="text-last-sync-at">
              {relativeTime(s.lastSyncAt)}
            </dd>
          </div>
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <dt className="text-muted-foreground">待上传</dt>
            <dd className="mt-0.5 font-medium" data-testid="text-pending-count">
              <Num>{s.pending}</Num> 项
            </dd>
          </div>
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <dt className="text-muted-foreground">网络</dt>
            <dd className="mt-0.5 font-medium">{s.online ? "在线" : "离线"}</dd>
          </div>
        </dl>

        {s.state === "error" && s.message && (
          <p className="mt-2 break-words rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive">
            {s.message}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SyncNowButton />
          <Button
            variant="outline"
            onClick={() => setForceStep(1)}
            data-testid="button-force-pull"
          >
            <HardDriveDownload className="mr-1.5 h-4 w-4" />
            强制以云端为准重拉
          </Button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 p-2.5">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed">
            上云的只有任务、结算流水、兑换、成就、成长树与每日维持记录，以及 AI 的接口地址与模型名。
            <span className="font-medium">你的 AI API Key 不会上传云端</span>
            ，它只在这台设备上以 AES-256-GCM 加密保存；换设备登录后需要重新填一次。
          </p>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          UI 始终读取本机数据，秒开且断网可用。离线期间的打卡与结算会排队，联网后按顺序补传，同一条记录只会计一次分。
        </p>
      </Section>

      {(locals.length > 0 || true) && (
        <Section title="把旧数据并入这个云端账号" icon={Upload}>
          {locals.length > 0 ? (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                检测到本机还有 <Num>{locals.length}</Num> 份未上云的本地数据。一键并入后会由同一套规则重算数值，结果与原来完全一致。
              </p>
              <ul className="mt-3 space-y-2">
                {locals.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2"
                    data-testid={`row-local-account-${a.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.displayName || a.username}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        <Num>{a.tasks}</Num> 个任务 · <Num>{a.logs}</Num> 条结算 · <Num>{a.upkeepDays}</Num> 天维持 · 积分{" "}
                        <Num>{a.points}</Num>
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => migrate.mutate(a.id)}
                      disabled={migrate.isPending}
                      data-testid={`button-migrate-${a.id}`}
                    >
                      {migrate.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                      一键上传
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              本机没有检测到未上云的旧数据。若你在别的浏览器导出过备份 JSON，也可以直接导入到这个云端账号。
            </p>
          )}

          <div className="mt-3 border-t border-card-border pt-3">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              data-testid="input-import-backup-cloud"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  importBackup.mutate(JSON.parse(await f.text()));
                } catch {
                  toast({ title: "文件解析失败", description: "请选择本应用导出的 JSON 备份。", variant: "destructive" });
                }
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={importBackup.isPending}
              data-testid="button-import-backup-cloud"
            >
              {importBackup.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              导入备份 JSON 到云端
            </Button>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              导入会覆盖当前账号在本机的数据，然后按同一套规则重算并上传。建议先「立即同步」一次再导入。
            </p>
          </div>
        </Section>
      )}

      {/* 三重确认：强制以云端为准 */}
      <AlertDialog open={forceStep > 0} onOpenChange={(o) => !o && (setForceStep(0), setForcePhrase(""))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {forceStep === 1 ? "以云端为准重新拉取？" : forceStep === 2 ? "本机未上传的记录会丢失" : "最后一步确认"}
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {forceStep === 1 &&
                "这会清空本机这个账号的数据，然后完整重新下载云端记录。适合本机数据出现异常时使用。"}
              {forceStep === 2 &&
                `当前还有 ${s.pending} 项待上传。继续的话，这些还没传上去的记录会被丢弃，且无法恢复。`}
              {forceStep === 3 && "请输入「以云端为准」四个字以确认。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {forceStep === 3 && (
            <Input
              value={forcePhrase}
              onChange={(e) => setForcePhrase(e.target.value)}
              placeholder="以云端为准"
              data-testid="input-force-pull-phrase"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-force-pull-cancel">取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-force-pull-confirm"
              disabled={forceStep === 3 && forcePhrase.trim() !== "以云端为准"}
              onClick={(e) => {
                if (forceStep < 3) {
                  e.preventDefault();
                  setForceStep((forceStep + 1) as 2 | 3);
                  return;
                }
                forcePull.mutate();
              }}
            >
              {forceStep === 3 ? "确认重拉" : "继续"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** 本地模式下的迁移引导卡（今日面板顶部） */
export function MigrationHintCard() {
  const { isCloud, user, logout } = useApp();
  const [closed, setClosed] = useState(false);
  const { data: locals = [] } = useQuery<LocalAccount[]>({
    queryKey: ["local-only-accounts", user?.id ?? 0],
    queryFn: () => localOnlyAccounts(),
  });
  if (closed) return null;

  // 云端账号 + 本机还有旧数据 → 提示去设置页一键并入
  if (isCloud && locals.length > 0) {
    return (
      <div
        className="mb-4 flex flex-wrap items-start gap-2.5 rounded-lg border border-primary/40 bg-primary/10 p-3"
        data-testid="card-migration-hint"
      >
        <Upload className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed">
          本机还有 <Num>{locals.length}</Num> 份没上云的旧数据。到「设置 → 把旧数据并入这个云端账号」一键上传，数值不会变。
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="secondary" asChild data-testid="button-go-migrate">
            <a href="#/settings">去迁移</a>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setClosed(true)} data-testid="button-dismiss-migration">
            以后再说
          </Button>
        </div>
      </div>
    );
  }

  // 本地模式 + 已有一定量数据 → 提示升级为云端账号
  if (!isCloud && (locals.find((a) => a.id === user?.id)?.records ?? 0) >= 5) {
    return (
      <div
        className="mb-4 flex flex-wrap items-start gap-2.5 rounded-lg border border-border bg-muted/50 p-3"
        data-testid="card-upgrade-hint"
      >
        <CloudCog className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed">
          这份数据目前只在这台设备上。注册一个云端账号可以多设备接着用，离线照样打卡；登录后在设置页一键把现在的数据并入即可。
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="secondary" onClick={logout} data-testid="button-go-cloud-signup">
            去注册云端账号
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setClosed(true)} data-testid="button-dismiss-upgrade">
            以后再说
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

function clean(e: any) {
  return String(e?.message ?? e).replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");
}
