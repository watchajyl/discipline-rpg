// V0.6：自托管在线后端认证。用户在设置页配置服务器地址、邮箱和密码。
import { serverLogin, serverRegister, serverMe } from "./server-api";
import { serverConnectCurrent, serverCurrentUser } from "./localdb";

export type CloudSession = {
  user: any;
  token: string;
  email: string;
  cloudUserId: string;
};

export async function cloudSignIn(
  serverUrl: string,
  email: string,
  password: string,
): Promise<CloudSession> {
  const data = await serverLogin(serverUrl, email, password);
  const token = String(data.token || "");
  const id = String(data.user?.id || "");
  if (!token || !id) throw new Error("服务器没有返回有效的登录信息");
  const { user, token: localToken } = await serverConnectCurrent({
    serverUrl,
    token,
    cloudUserId: id,
    email: data.user?.email || email,
  });
  return { user, token: localToken, email: data.user?.email || email, cloudUserId: id };
}

export async function cloudSignUp(
  serverUrl: string,
  email: string,
  password: string,
): Promise<CloudSession> {
  const data = await serverRegister(serverUrl, email, password);
  const token = String(data.token || "");
  const id = String(data.user?.id || "");
  if (!token || !id) throw new Error("服务器没有返回有效的注册信息");
  const { user, token: localToken } = await serverConnectCurrent({
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

export async function verifyCloudConnection(
  serverUrl: string,
  token: string,
): Promise<void> {
  await serverMe(serverUrl, token);
}
