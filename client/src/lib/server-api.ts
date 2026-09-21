// V0.6：自托管在线后端客户端。后端为常驻 Node 服务，国内可直连。

export class ServerError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export function serverBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "";
}

function normalizeBaseUrl(url: string): string {
  const clean = String(url || "").trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(clean)) throw new ServerError("服务器地址需要以 http:// 或 https:// 开头");
  return clean;
}

async function serverFetch(base: string, path: string, init: RequestInit = {}) {
  const url = `${normalizeBaseUrl(base)}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ServerError("无法连接服务器，请检查网络或服务器地址");
  }
  return res;
}

async function parse(res: Response): Promise<any> {
  const text = await res.text().catch(() => "");
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || `服务器返回 ${res.status}` };
  }
  if (!res.ok) throw new ServerError(data?.error || `服务器返回 ${res.status}`, res.status);
  return data;
}

export async function serverLogin(base: string, email: string, password: string) {
  const res = await serverFetch(base, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return parse(res);
}

export async function serverRegister(base: string, email: string, password: string) {
  const res = await serverFetch(base, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return parse(res);
}

export async function serverSendCode(base: string, email: string, purpose: "register" | "reset") {
  const res = await serverFetch(base, "/api/auth/send-code", {
    method: "POST",
    body: JSON.stringify({ email, purpose }),
  });
  return parse(res);
}

export async function serverRegisterWithCode(base: string, email: string, password: string, code: string) {
  const res = await serverFetch(base, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, code }),
  });
  return parse(res);
}

export async function serverResetPassword(base: string, email: string, code: string, password: string) {
  const res = await serverFetch(base, "/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ email, code, password }),
  });
  return parse(res);
}

export async function serverMe(base: string, token: string) {
  const res = await serverFetch(base, "/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parse(res);
}

export async function serverGetSnapshot(base: string, token: string) {
  const res = await serverFetch(base, "/api/snapshot", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parse(res);
}

export async function serverPutSnapshot(base: string, token: string, baseVersion: number, data: any) {
  const res = await serverFetch(base, "/api/snapshot", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ baseVersion, data }),
  });
  return parse(res);
}
