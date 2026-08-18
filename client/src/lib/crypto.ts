// ============================================================
// 浏览器端密码哈希与静态加密（WebCrypto）
//   · 密码 / 安全问题答案：PBKDF2-SHA256，210,000 次迭代，16 字节随机盐
//   · AI API Key：AES-256-GCM，密钥由本安装随机主密钥经 PBKDF2 派生
// ============================================================

export const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const HASH_PREFIX = "pbkdf2";
const ENC_PREFIX = "enc:v1:";

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("当前浏览器不支持 WebCrypto，无法安全存储密码");
  return c.subtle;
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

async function pbkdf2(secret: string, salt: Uint8Array, iterations: number, bytes: number): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** 定长常数时间比较 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 输出 pbkdf2$210000$saltHex$hashHex */
export async function hashSecret(secret: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(secret, salt, PBKDF2_ITERATIONS, HASH_BYTES);
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  const salt = fromHex(parts[2]);
  const expected = fromHex(parts[3]);
  const candidate = await pbkdf2(secret, salt, iterations, expected.length || HASH_BYTES);
  return timingSafeEqual(candidate, expected);
}

// ---------------- AES-256-GCM ----------------
let cachedKey: CryptoKey | null = null;
let cachedSecret = "";

async function encryptionKey(installSecret: string): Promise<CryptoKey> {
  if (cachedKey && cachedSecret === installSecret) return cachedKey;
  const bits = await pbkdf2(installSecret, new TextEncoder().encode("discipline-rpg-ai-key"), PBKDF2_ITERATIONS, 32);
  cachedKey = await subtle().importKey("raw", bits as unknown as BufferSource, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  cachedSecret = installSecret;
  return cachedKey;
}

/** 输出 enc:v1:ivHex:cipherHex（GCM tag 已包含在 cipher 尾部） */
export async function encryptSecretValue(plain: string, installSecret: string): Promise<string> {
  if (!plain) return "";
  const key = await encryptionKey(installSecret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  return `${ENC_PREFIX}${toHex(iv)}:${toHex(cipher)}`;
}

export async function decryptSecretValue(stored: string, installSecret: string): Promise<string> {
  if (!stored) return "";
  if (!stored.startsWith(ENC_PREFIX)) return stored; // 兼容历史明文（导入的旧备份）
  const [ivHex, dataHex] = stored.slice(ENC_PREFIX.length).split(":");
  if (!ivHex || !dataHex) return "";
  try {
    const key = await encryptionKey(installSecret);
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromHex(ivHex) as unknown as BufferSource },
      key,
      fromHex(dataHex) as unknown as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "sk-****";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}
