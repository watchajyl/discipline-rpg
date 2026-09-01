// ============================================================
// 云端账号（SPEC-V2 1.2）
//
// 邮箱 + 密码注册 / 登录 / 登出 / 重置密码。
// 登录成功后在本机建立（或复用）一个镜像账号，UI 依旧只读本地 IndexedDB。
// 「本地模式」保持可用：不登录也能完整使用，随时可升级为云端账号。
// ============================================================
import { attachCloudSession } from "./localdb";
import { authErrorText, rememberEnabled, setRememberEnabled, supabase } from "./supabase";

export class CloudAuthError extends Error {
  needsConfirm: boolean;
  constructor(message: string, needsConfirm = false) {
    super(message);
    this.needsConfirm = needsConfirm;
  }
}

export type CloudSession = { user: any; token: string; email: string; cloudUserId: string };

async function attach(cloudUserId: string, email: string, displayName?: string): Promise<CloudSession> {
  const { user, token } = await attachCloudSession({
    cloudUserId,
    email,
    displayName,
    remember: rememberEnabled(),
  });
  return { user, token, email, cloudUserId };
}

export async function cloudSignIn(email: string, password: string, remember: boolean): Promise<CloudSession> {
  setRememberEnabled(remember);
  const { data, error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new CloudAuthError(authErrorText(error.message), /not confirmed/i.test(error.message));
  if (!data.user) throw new CloudAuthError("登录没能完成，请再试一次");
  return attach(data.user.id, data.user.email ?? email.trim(), data.user.user_metadata?.display_name);
}

export async function cloudSignUp(
  email: string,
  password: string,
  displayName: string,
  remember: boolean,
): Promise<CloudSession | { needsConfirm: true; email: string }> {
  setRememberEnabled(remember);
  const clean = email.trim();
  const { data, error } = await supabase().auth.signUp({
    email: clean,
    password,
    options: { data: { display_name: displayName.trim() || clean.split("@")[0] } },
  });
  if (error) throw new CloudAuthError(authErrorText(error.message));
  if (!data.session) return { needsConfirm: true, email: clean };
  return attach(data.user!.id, data.user!.email ?? clean, displayName);
}

export async function cloudResetPassword(email: string) {
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw new CloudAuthError(authErrorText(error.message));
}

export async function cloudSignOut() {
  try {
    await supabase().auth.signOut();
  } catch {
    /* 离线时本地登出即可，云端 session 到期自然失效 */
  }
}

/** 启动时：本机是否还有有效的云端 session（对应「记住登录状态」） */
export async function currentCloudUser(): Promise<{ id: string; email: string } | null> {
  try {
    const { data } = await supabase().auth.getSession();
    if (!data.session) return null;
    return { id: data.session.user.id, email: data.session.user.email ?? "" };
  } catch {
    return null;
  }
}

export { rememberEnabled, setRememberEnabled };
