// ============================================================
// Supabase 客户端（SPEC-V2 1.5）
//
// 这里写死的是 **publishable key**。它设计上就是公开的前端配置：
// 八张表全部启用了 RLS，策略统一为 auth.uid() = user_id，
// 未登录 / 他人账号读不到任何一行。
//
// 仓库与构建产物中【绝不包含】service_role key、access token、数据库密码。
// 用户的 AI API Key 也【不上云】，仅本地 AES-256-GCM 加密存储。
// ============================================================
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://cybhpgsquazqievgjidj.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_C_40YYDECFUrTHebZSsXXA_QDNs44rq";

/** 「记住登录状态」关闭时使用的内存 storage（关掉标签页即失效） */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const STORAGE_KEY = "drpg-auth";
const REMEMBER_KEY = "drpg-remember";

export function rememberEnabled(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setRememberEnabled(on: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? "1" : "0");
  } catch {
    /* 存储不可用时忽略 */
  }
}

function pickStorage() {
  if (!rememberEnabled()) return memoryStorage();
  try {
    // 探测一次，预览沙箱 iframe 会禁用 localStorage
    localStorage.setItem("__drpg_probe__", "1");
    localStorage.removeItem("__drpg_probe__");
    return localStorage;
  } catch {
    return memoryStorage();
  }
}

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: pickStorage() as any,
      storageKey: STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export type { Session };

/** 把 Supabase 的英文错误翻译成温和的中文提示 */
export function authErrorText(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s.includes("invalid login credentials")) return "邮箱或密码不正确";
  if (s.includes("email not confirmed")) return "邮箱还没确认，请先点开确认邮件里的链接";
  if (s.includes("user already registered") || s.includes("already been registered")) return "这个邮箱已经注册过了，直接登录就好";
  if (s.includes("password should be at least")) return "密码至少 6 位";
  if (s.includes("email address") && s.includes("invalid")) return "邮箱格式看起来不太对，换一个试试";
  if (s.includes("rate limit") || s.includes("too many")) return "操作有点频繁，过一会儿再试";
  if (s.includes("failed to fetch") || s.includes("networkerror") || s.includes("load failed")) return "网络连不上，请检查网络后重试";
  return raw || "操作没能完成，请稍后再试";
}
