export const PASSWORD_ITERATIONS = 100_000;
export const SESSION_COOKIE = "zhixi_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_ATTEMPT_LIMIT = 10;
export const IP_ATTEMPT_LIMIT = 30;
export const MAX_LOGIN_BYTES = 4096;
const encoder = new TextEncoder();
const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const hexToBytes = (value: string) => new Uint8Array(value.match(/../g)!.map(v => parseInt(v, 16)));

export function normalizeUsername(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The workerd PBKDF2 limit is 100,000 iterations; use a fresh 128-bit salt per account. */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length > 256) throw new Error("Password length is invalid.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const digest = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return "$pbkdf2-sha256$" + PASSWORD_ITERATIONS + "$" + bytesToHex(salt) + "$" + bytesToHex(new Uint8Array(digest));
}

export const DUMMY_PASSWORD_HASH = "$pbkdf2-sha256$100000$0f5a9ce41731d18b8394b329195029c1$2b1f775b54c3276e0214ae5a4d073b25f09e74b8ce794458b7a4202459d2c644";

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || password.length > 256) return false;
  const parts = /^\$pbkdf2-sha256\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(stored);
  if (!parts || Number(parts[1]) !== PASSWORD_ITERATIONS) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const digest = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(parts[2]), iterations: PASSWORD_ITERATIONS }, key, 256));
  const expected = hexToBytes(parts[3]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= digest[i] ^ expected[i];
  return difference === 0;
}

export async function hashToken(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export function createSessionToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function readSessionToken(cookie: string | null): string | null {
  if (!cookie) return null;
  const tokens = cookie.split(";").map(v => v.trim()).filter(v => v.startsWith(SESSION_COOKIE + "="));
  if (tokens.length !== 1) return null;
  const token = tokens[0].slice(SESSION_COOKIE.length + 1);
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export function sessionCookie(value: string, url: string, clear = false): string {
  if (value && !/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid session token.");
  return SESSION_COOKIE + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (clear ? 0 : SESSION_SECONDS) + (new URL(url).protocol === "https:" ? "; Secure" : "");
}

export function isSameOrigin(req: Request): boolean {
  return req.headers.get("origin") === new URL(req.url).origin;
}

export function loginWindow(now = Date.now()): { number: number; expiresAt: number } {
  const number = Math.floor(now / LOGIN_WINDOW_MS);
  return { number, expiresAt: (number + 1) * LOGIN_WINDOW_MS };
}

export async function readLoginInput(req: Request): Promise<{ username: string; password: string }> {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) throw new Error("请使用有效的登录表单。");
  if (Number(req.headers.get("content-length")) > MAX_LOGIN_BYTES || !req.body) throw new Error("登录信息格式不正确。");
  const reader = req.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_LOGIN_BYTES) { await reader.cancel(); throw new Error("登录信息过长。"); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("登录信息格式不正确。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("登录信息格式不正确。");
  const fields = value as Record<string, unknown>;
  if (typeof fields.username !== "string" || typeof fields.password !== "string" || Object.keys(fields).some(k => !["username", "password"].includes(k))) throw new Error("请输入用户名和密码。");
  const username = normalizeUsername(fields.username);
  if (!username || username.length > 80 || !fields.password || fields.password.length > 256) throw new Error("请输入有效的用户名和密码。");
  return { username, password: fields.password };
}
