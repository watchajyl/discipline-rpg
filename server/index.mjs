import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";

const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "server", "data.sqlite");
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STATIC_DIR = path.resolve(process.cwd(), "dist");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  create table if not exists users (
    id text primary key,
    email text unique not null,
    password_hash text not null,
    created_at integer not null
  );
  create table if not exists sessions (
    token text primary key,
    user_id text not null,
    expires_at integer not null
  );
  create table if not exists snapshots (
    user_id text primary key,
    version integer not null default 0,
    updated_at integer not null,
    data text not null
  );
  create table if not exists verification_codes (
    id integer primary key autoincrement,
    email text not null,
    purpose text not null,
    code_hash text not null,
    expires_at integer not null,
    consumed integer not null default 0,
    created_at integer not null
  );
`);

const cleanEmail = (s) => String(s || "").trim().toLowerCase();

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newId() {
  return crypto.randomUUID();
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendVerificationCode(email, code) {
  if (!smtpConfigured()) throw new Error("邮件服务尚未配置");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "自律成长系统验证码",
    text: `你的验证码是：${code}，10 分钟内有效。如果不是你本人操作，请忽略这封邮件。`,
  });
}

function issueVerificationCode(email, purpose) {
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = Date.now() + 10 * 60 * 1000;
  db.prepare("delete from verification_codes where email = ? and purpose = ?").run(email, purpose);
  db.prepare("insert into verification_codes(email, purpose, code_hash, expires_at, created_at) values (?, ?, ?, ?, ?)").run(
    email,
    purpose,
    hashCode(code),
    expiresAt,
    Date.now(),
  );
  return code;
}

function consumeVerificationCode(email, purpose, code) {
  const row = db
    .prepare("select id, code_hash, expires_at, consumed from verification_codes where email = ? and purpose = ? order by id desc limit 1")
    .get(email, purpose);
  if (!row || row.consumed || row.expires_at < Date.now() || row.code_hash !== hashCode(code)) return false;
  db.prepare("update verification_codes set consumed = 1 where id = ?").run(row.id);
  return true;
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 12 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("JSON 格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

function authUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const row = db.prepare("select user_id, expires_at from sessions where token = ?").get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return row.user_id;
}

function publicUser(id) {
  return db.prepare("select id, email, created_at from users where id = ?").get(id);
}

function issueSession(userId) {
  const token = newToken();
  db.prepare("insert into sessions(token, user_id, expires_at) values (?, ?, ?)").run(
    token,
    userId,
    Date.now() + TOKEN_TTL_MS,
  );
  return token;
}

const routes = [];

function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

route("POST", /^\/api\/auth\/register$/, async (req, res) => {
  const body = await readBody(req);
  const email = cleanEmail(body.email);
  const password = String(body.password || "");
  const code = String(body.code || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "邮箱格式不正确" });
  if (password.length < 6) return json(res, 400, { error: "密码至少 6 位" });
  if (!consumeVerificationCode(email, "register", code)) return json(res, 400, { error: "验证码不正确或已过期" });
  const exists = db.prepare("select id from users where email = ?").get(email);
  if (exists) return json(res, 409, { error: "该邮箱已注册" });
  const id = newId();
  db.prepare("insert into users(id, email, password_hash, created_at) values (?, ?, ?, ?)").run(
    id,
    email,
    hashPassword(password),
    Date.now(),
  );
  return json(res, 200, { token: issueSession(id), user: publicUser(id) });
});

route("POST", /^\/api\/auth\/send-code$/, async (req, res) => {
  const body = await readBody(req);
  const email = cleanEmail(body.email);
  const purpose = body.purpose === "reset" ? "reset" : "register";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "邮箱格式不正确" });
  const exists = db.prepare("select id from users where email = ?").get(email);
  if (purpose === "register" && exists) return json(res, 409, { error: "该邮箱已注册" });
  if (purpose === "reset" && !exists) return json(res, 404, { error: "该邮箱尚未注册" });
  const code = issueVerificationCode(email, purpose);
  try {
    await sendVerificationCode(email, code);
    return json(res, 200, { ok: true, message: "验证码已发送" });
  } catch (e) {
    return json(res, 500, { error: e?.message || "验证码发送失败" });
  }
});

route("POST", /^\/api\/auth\/reset-password$/, async (req, res) => {
  const body = await readBody(req);
  const email = cleanEmail(body.email);
  const code = String(body.code || "");
  const password = String(body.password || "");
  if (!consumeVerificationCode(email, "reset", code)) return json(res, 400, { error: "验证码不正确或已过期" });
  if (password.length < 6) return json(res, 400, { error: "密码至少 6 位" });
  const user = db.prepare("select id from users where email = ?").get(email);
  if (!user) return json(res, 404, { error: "该邮箱尚未注册" });
  db.prepare("update users set password_hash = ? where id = ?").run(hashPassword(password), user.id);
  return json(res, 200, { ok: true, message: "密码已重置" });
});

route("POST", /^\/api\/auth\/login$/, async (req, res) => {
  const body = await readBody(req);
  const email = cleanEmail(body.email);
  const password = String(body.password || "");
  const user = db.prepare("select * from users where email = ?").get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return json(res, 401, { error: "邮箱或密码不正确" });
  }
  return json(res, 200, { token: issueSession(user.id), user: publicUser(user.id) });
});

route("GET", /^\/api\/auth\/me$/, (req, res) => {
  const userId = authUser(req);
  if (!userId) return json(res, 401, { error: "登录状态已过期" });
  return json(res, 200, { user: publicUser(userId) });
});

route("POST", /^\/api\/auth\/logout$/, (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) db.prepare("delete from sessions where token = ?").run(token);
  return json(res, 200, { ok: true });
});

route("GET", /^\/api\/snapshot$/, (req, res) => {
  const userId = authUser(req);
  if (!userId) return json(res, 401, { error: "登录状态已过期" });
  const row = db.prepare("select version, updated_at, data from snapshots where user_id = ?").get(userId);
  if (!row) return json(res, 200, { version: 0, updatedAt: 0, data: null });
  return json(res, 200, { version: row.version, updatedAt: row.updated_at, data: JSON.parse(row.data) });
});

route("PUT", /^\/api\/snapshot$/, async (req, res) => {
  const userId = authUser(req);
  if (!userId) return json(res, 401, { error: "登录状态已过期" });
  const body = await readBody(req);
  const baseVersion = Number(body.baseVersion ?? 0);
  const incoming = body.data;
  if (incoming === undefined || incoming === null) return json(res, 400, { error: "缺少同步数据" });
  const current = db.prepare("select version, data from snapshots where user_id = ?").get(userId);
  const currentVersion = current ? current.version : 0;
  if (baseVersion !== currentVersion) {
    return json(res, 409, {
      error: "云端数据已更新，请先拉取最新数据",
      version: currentVersion,
      data: current ? JSON.parse(current.data) : null,
    });
  }
  const now = Date.now();
  const data = JSON.stringify(incoming);
  if (current) {
    db.prepare("update snapshots set version = ?, updated_at = ?, data = ? where user_id = ?").run(
      currentVersion + 1,
      now,
      data,
      userId,
    );
  } else {
    db.prepare("insert into snapshots(user_id, version, updated_at, data) values (?, ?, ?, ?)").run(
      userId,
      1,
      now,
      data,
    );
  }
  return json(res, 200, { version: currentVersion + 1, updatedAt: now });
});

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  for (const r of routes) {
    if (r.method !== req.method || !r.pattern.test(url.pathname)) continue;
    try {
      await r.handler(req, res);
    } catch (e) {
      json(res, 400, { error: e?.message || "请求处理失败" });
    }
    return;
  }

  if (req.method === "GET") {
    const pathname = decodeURIComponent(url.pathname);
    const requested = path.normalize(path.join(STATIC_DIR, pathname === "/" ? "index.html" : pathname));
    if (!requested.startsWith(STATIC_DIR)) {
      json(res, 403, { error: "禁止访问" });
      return;
    }
    let filePath = requested;
    if (!fs.existsSync(filePath)) filePath = path.join(STATIC_DIR, "index.html");
    try {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".json": "application/json; charset=utf-8",
      }[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Access-Control-Allow-Origin": "*",
        "Content-Length": stat.size,
      });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      json(res, 404, { error: "未找到" });
    }
    return;
  }

  json(res, 404, { error: "未找到接口" });
});

server.listen(PORT, () => {
  console.log(`discipline-rpg server listening on http://0.0.0.0:${PORT}`);
});
