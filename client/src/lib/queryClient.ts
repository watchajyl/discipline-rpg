import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { localFetch } from "./local-api";
import { setToken } from "./localdb";

// 纯前端应用：没有后端，所有请求由本地数据层（IndexedDB）处理。
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  setToken(token);
}

export function getAuthToken(): string | null {
  return authToken;
}

/** 注册全局 401 处理（清 token + 回登录页） */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) {
      setAuthToken(null);
      onUnauthorized?.();
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await localFetch(method, url, data);
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await localFetch("GET", queryKey.join("/"));

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      setAuthToken(null);
      onUnauthorized?.();
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
