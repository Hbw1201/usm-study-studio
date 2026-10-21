import { eq, lt, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { loginAttempts, studySessions, studyUsers } from "../../../../db/schema";
import { ACCOUNT_ATTEMPT_LIMIT, IP_ATTEMPT_LIMIT, DUMMY_PASSWORD_HASH, SESSION_SECONDS, createSessionToken, hashToken, isSameOrigin, loginWindow, readLoginInput, readSessionToken, sessionCookie, verifyPassword } from "../../../../lib/account-security";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "登录请求来源无效，请刷新后重试。" }, 403);
  let input: Awaited<ReturnType<typeof readLoginInput>>;
  try { input = await readLoginInput(req); } catch (e) { return json({ error: e instanceof Error ? e.message : "请输入用户名和密码。" }, 400); }
  try {
    const db = getDb(), now = Date.now(), window = loginWindow(now);
    // Only the platform-provided IP is used; account-wide throttling still applies on localhost.
    const ip = req.headers.get("cf-connecting-ip") || "local";
    const accountKey = await hashToken("account:" + input.username + ":" + window.number);
    const ipKey = await hashToken("ip:" + ip + ":" + window.number);
    const countAttempt = (key: string) => db.insert(loginAttempts).values({ key, count: 1, expiresAt: window.expiresAt }).onConflictDoUpdate({ target: loginAttempts.key, set: { count: sql`${loginAttempts.count} + 1` } }).returning({ count: loginAttempts.count });
    const counts = await db.batch([countAttempt(accountKey), countAttempt(ipKey)]);
    if ((counts[0]?.[0]?.count ?? 0) > ACCOUNT_ATTEMPT_LIMIT || (counts[1]?.[0]?.count ?? 0) > IP_ATTEMPT_LIMIT) {
      return json({ error: "登录尝试过多，请稍后再试。" }, 429, { "Retry-After": String(Math.max(1, Math.ceil((window.expiresAt - now) / 1000))) });
    }
    const user = await db.select().from(studyUsers).where(eq(studyUsers.username, input.username)).get();
    const valid = await verifyPassword(input.password, user?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!user || !valid || user.disabled) return json({ error: "用户名或密码不正确。" }, 401);
    const token = createSessionToken(), oldToken = readSessionToken(req.headers.get("cookie"));
    await db.insert(studySessions).values({ tokenHash: await hashToken(token), userId: user.id, createdAt: now, expiresAt: now + SESSION_SECONDS * 1000 });
    if (oldToken) await db.delete(studySessions).where(eq(studySessions.tokenHash, await hashToken(oldToken)));
    await db.delete(loginAttempts).where(eq(loginAttempts.key, accountKey));
    await db.delete(studySessions).where(lt(studySessions.expiresAt, now));
    await db.delete(loginAttempts).where(lt(loginAttempts.expiresAt, now));
    return json({ user: { userId: user.id, displayName: user.displayName } }, 200, { "Set-Cookie": sessionCookie(token, req.url) });
  } catch { return json({ error: "登录服务暂时不可用，请稍后重试。" }, 503); }
}
