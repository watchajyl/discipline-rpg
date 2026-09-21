// 本地路由分发：把原 Express 路由的 method + URL 映射到 localdb 操作。
// 这样所有页面/组件仍然只调用 apiRequest / React Query，无需改动业务代码。
import * as db from "./localdb";
import { LocalError } from "./localdb";

type Handler = (ctx: { params: string[]; body: any }) => Promise<any>;

type Route = { method: string; pattern: RegExp; handler: Handler };

const num = (s: string) => Number(s);

const routes: Route[] = [
  // ---------------- 引导 / 认证 ----------------
  { method: "GET", pattern: /^\/api\/bootstrap$/, handler: () => db.bootstrap() },
  {
    method: "POST",
    pattern: /^\/api\/register$/,
    handler: ({ body }) => db.register(body, body?.remember !== false),
  },
  {
    method: "POST",
    pattern: /^\/api\/login$/,
    handler: ({ body }) => db.login(body, body?.remember !== false),
  },
  { method: "POST", pattern: /^\/api\/logout$/, handler: () => db.logout() },
  {
    method: "GET",
    pattern: /^\/api\/security-question\/(.+)$/,
    handler: ({ params }) => db.getSecurityQuestion(decodeURIComponent(params[0])),
  },
  { method: "POST", pattern: /^\/api\/reset-password$/, handler: ({ body }) => db.resetPassword(body) },
  {
    method: "POST",
    pattern: /^\/api\/change-password$/,
    handler: ({ body }) => db.changePassword(body?.oldPassword, body?.newPassword),
  },

  // ---------------- 资料 / 任务 ----------------
  { method: "GET", pattern: /^\/api\/profile\/(\d+)$/, handler: () => db.getProfile() },
  { method: "GET", pattern: /^\/api\/tasks\/(\d+)$/, handler: () => db.getTasks() },
  { method: "POST", pattern: /^\/api\/tasks$/, handler: ({ body }) => db.createTask(body?.task ?? body) },
  {
    method: "PATCH",
    pattern: /^\/api\/tasks\/(\d+)$/,
    handler: ({ params, body }) => db.updateTask(num(params[0]), body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/tasks\/(\d+)$/,
    handler: ({ params }) => db.deleteTask(num(params[0])),
  },

  // ---------------- 结算 ----------------
  {
    method: "POST",
    pattern: /^\/api\/tasks\/(\d+)\/timer\/([a-z]+)$/,
    handler: ({ params }) => db.timerAction(num(params[0]), params[1]),
  },
  {
    method: "POST",
    pattern: /^\/api\/tasks\/(\d+)\/manual-time$/,
    handler: ({ params, body }) => db.manualTime(num(params[0]), body),
  },
  {
    method: "POST",
    pattern: /^\/api\/tasks\/(\d+)\/milestone$/,
    handler: ({ params, body }) => db.toggleMilestone(num(params[0]), body),
  },
  {
    method: "POST",
    pattern: /^\/api\/tasks\/(\d+)\/checkin$/,
    handler: ({ params, body }) => db.checkin(num(params[0]), body),
  },
  {
    method: "POST",
    pattern: /^\/api\/tasks\/(\d+)\/count$/,
    handler: ({ params, body }) => db.countUp(num(params[0]), body),
  },

  // ---------------- 记录 / 统计 ----------------
  { method: "GET", pattern: /^\/api\/logs\/(\d+)$/, handler: () => db.getLogs() },
  { method: "GET", pattern: /^\/api\/stats\/(\d+)$/, handler: () => db.getStats() },

  // ---------------- 每日维持（V2） ----------------
  { method: "GET", pattern: /^\/api\/upkeep\/(\d+)$/, handler: () => db.getUpkeep() },
  { method: "POST", pattern: /^\/api\/upkeep\/catchup$/, handler: () => db.catchUpUpkeep() },
  { method: "POST", pattern: /^\/api\/upkeep\/exempt$/, handler: ({ body }) => db.useUpkeepExemption(body) },
  { method: "PATCH", pattern: /^\/api\/upkeep\/config$/, handler: ({ body }) => db.updateUpkeepConfig(body) },

  // ---------------- 技能树 ----------------
  {
    method: "POST",
    pattern: /^\/api\/skill-tree\/unlock$/,
    handler: ({ body }) => db.unlockSkillNode(String(body?.nodeId ?? "")),
  },

  // ---------------- 奖励 ----------------
  { method: "GET", pattern: /^\/api\/rewards\/(\d+)$/, handler: () => db.getRewards() },
  { method: "POST", pattern: /^\/api\/rewards$/, handler: ({ body }) => db.createReward(body?.reward ?? body) },
  {
    method: "PATCH",
    pattern: /^\/api\/rewards\/(\d+)$/,
    handler: ({ params, body }) => db.updateReward(num(params[0]), body?.reward ?? body),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/rewards\/(\d+)$/,
    handler: ({ params }) => db.deleteReward(num(params[0])),
  },
  {
    method: "POST",
    pattern: /^\/api\/rewards\/(\d+)\/redeem$/,
    handler: ({ params }) => db.redeemReward(num(params[0])),
  },
  { method: "GET", pattern: /^\/api\/redemptions\/(\d+)$/, handler: () => db.getRedemptions() },

  // ---------------- 设置 / 数据 ----------------
  { method: "PATCH", pattern: /^\/api\/settings$/, handler: ({ body }) => db.updateSettings(body) },
  { method: "GET", pattern: /^\/api\/export\/(\d+)$/, handler: () => db.exportData() },
  { method: "POST", pattern: /^\/api\/import$/, handler: ({ body }) => db.importData(body?.payload ?? body) },
  { method: "POST", pattern: /^\/api\/clear-data$/, handler: () => db.clearData() },

  // ---------------- V3 全局专注计时器 ----------------
  { method: "GET", pattern: /^\/api\/focus\/state(?:\/(\d+))?$/, handler: () => db.focusState() },
  { method: "GET", pattern: /^\/api\/focus\/limits(?:\/(\d+))?$/, handler: () => db.focusLimits() },
  { method: "POST", pattern: /^\/api\/focus\/start$/, handler: ({ body }) => db.focusStart(body) },
  { method: "POST", pattern: /^\/api\/focus\/pause$/, handler: () => db.focusPause() },
  { method: "POST", pattern: /^\/api\/focus\/abandon$/, handler: () => db.focusAbandon() },
  { method: "POST", pattern: /^\/api\/focus\/stop$/, handler: ({ body }) => db.focusStop(body) },

  // ---------------- V4 复盘 / 规划 ----------------
  { method: "GET", pattern: /^\/api\/journals(?:\/(\d+))?$/, handler: () => db.journalList() },
  { method: "POST", pattern: /^\/api\/journals$/, handler: ({ body }) => db.journalUpsert(body) },
  {
    method: "POST",
    pattern: /^\/api\/journals\/(\d+)\/ai-review$/,
    handler: ({ params }) => db.journalAiReview({ id: params[0] }),
  },
  {
    method: "POST",
    pattern: /^\/api\/journals\/(\d+)\/ai-decompose$/,
    handler: ({ params }) => db.planAiDecompose({ id: params[0] }),
  },

  // ---------------- V0.2 睡眠 ----------------
  { method: "GET", pattern: /^\/api\/sleep\/state(?:\/(\d+))?$/, handler: () => db.sleepState() },
  { method: "PATCH", pattern: /^\/api\/sleep\/settings$/, handler: ({ body }) => db.sleepSettingsUpdate(body) },
  { method: "POST", pattern: /^\/api\/sleep\/record$/, handler: ({ body }) => db.sleepRecord(body) },

  // ---------------- V0.3 开销记账 ----------------
  { method: "GET", pattern: /^\/api\/expenses\/state(?:\/(\d+))?$/, handler: () => db.expenseState() },
  { method: "POST", pattern: /^\/api\/expenses$/, handler: ({ body }) => db.expenseAdd(body) },
  { method: "PATCH", pattern: /^\/api\/expenses\/budget$/, handler: ({ body }) => db.expenseBudget(body) },
  {
    method: "DELETE",
    pattern: /^\/api\/expenses\/(\d+)$/,
    handler: ({ params }) => db.expenseDelete(num(params[0])),
  },

  // ---------------- V0.4 智能规划聊天 ----------------
  { method: "GET", pattern: /^\/api\/planner\/state(?:\/(\d+))?$/, handler: () => db.plannerState() },
  { method: "POST", pattern: /^\/api\/planner\/reset$/, handler: () => db.plannerReset() },
  { method: "POST", pattern: /^\/api\/planner\/send$/, handler: ({ body }) => db.plannerSend(body) },
  { method: "POST", pattern: /^\/api\/planner\/confirm$/, handler: ({ body }) => db.plannerConfirm(body) },

  // ---------------- AI ----------------
  { method: "POST", pattern: /^\/api\/ai\/test$/, handler: ({ body }) => db.aiTest(body) },
  { method: "POST", pattern: /^\/api\/ai\/suggest$/, handler: ({ body }) => db.aiSuggest(body) },

  // ---------------- 演示数据 ----------------
  { method: "POST", pattern: /^\/api\/demo-seed$/, handler: () => db.seedDemoData() },
  { method: "POST", pattern: /^\/api\/demo-account$/, handler: () => db.createDemoAccount() },
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data === undefined ? { ok: true } : data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 与旧后端等价的请求分发；始终返回真实 Response 对象 */
export async function localFetch(method: string, url: string, body?: unknown): Promise<Response> {
  const path = url.split("?")[0];
  const upper = method.toUpperCase();
  for (const r of routes) {
    if (r.method !== upper) continue;
    const m = path.match(r.pattern);
    if (!m) continue;
    try {
      const data = await r.handler({ params: m.slice(1), body });
      return json(data);
    } catch (e: any) {
      if (e instanceof LocalError) return json({ message: e.message }, e.status);
      return json({ message: String(e?.message ?? e) }, 400);
    }
  }
  return json({ message: `未知接口：${upper} ${path}` }, 404);
}

// 自测桥：让 Playwright 走与 UI 完全相同的 method + URL 路径发起操作。
// 只暴露读写既有路由的能力，不含任何新数值逻辑。
if (typeof window !== "undefined") {
  (window as any).__api = async (method: string, url: string, body?: unknown) => {
    const res = await localFetch(method, url, body);
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}
