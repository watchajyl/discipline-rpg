// V0.6：自托管在线后端认证。用户在设置页配置服务器地址、邮箱和密码。
import { serverBaseUrl, serverLogin, serverMe, serverRegisterWithCode, serverSendCode, serverResetPassword } from "./server-api";
import { attachServerSession, serverCurrentUser } from "./localdb";

export type CloudSession = {
  user: any;
  token: string;
  email: string;
  cloudUserId: string;
};

export async function cloudSignIn(
  email: string,
  password: string,
  _remember = true,
): Promise<CloudSession> {
  const serverUrl = serverBaseUrl();
  const data = await serverLogin(serverUrl, email, password);
  const token = String(data.token || "");
  const id = String(data.user?.id || "");
  if (!token || !id) throw new Error("服务器没有返回有效的登录信息");
  const { user, token: localToken } = await attachServerSession({
    serverUrl,
    token,
    cloudUserId: id,
    email: data.user?.email || email,
  });
  return { user, token: localToken, email: data.user?.email || email, cloudUserId: id };
}

export async function cloudSignUp(
  email: string,
  password: string,
  _displayName = "",
  _remember = true,
  code = "",
): Promise<CloudSession> {
  const serverUrl = serverBaseUrl();
  const data = await serverRegisterWithCode(serverUrl, email, password, code);
  const token = String(data.token || "");
  const id = String(data.user?.id || "");
  if (!token || !id) throw new Error("服务器没有返回有效的注册信息");
  const { user, token: localToken } = await attachServerSession({
    serverUrl,
    token,
    cloudUserId: id,
    email: data.user?.email || email,
  });
  return { user, token: localToken, email: data.user?.email || email, cloudUserId: id };
}

export async function currentCloudUser(): Promise<{ id: string; email: string } | null> {
  return serverCurrentUser();
}

export async function cloudSignOut() {
  // 后端 token 由用户主动断开时清理；本地会话由 logout 流程处理。
}

export async function cloudResetPassword(_email: string) {
  throw new Error("请使用验证码重置密码");
}

export async function cloudSendCode(email: string, purpose: "register" | "reset") {
  return serverSendCode(serverBaseUrl(), email, purpose);
}

export async function cloudResetPasswordWithCode(email: string, code: string, password: string) {
  return serverResetPassword(serverBaseUrl(), email, code, password);
}

export async function verifyCloudConnection(
  serverUrl: string,
  token: string,
): Promise<void> {
  await serverMe(serverUrl, token);
}
