import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { studySessions } from "../../../../db/schema";
import { hashToken, isSameOrigin, readSessionToken, sessionCookie } from "../../../../lib/account-security";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return Response.json({ error: "请求来源无效。" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const token = readSessionToken(req.headers.get("cookie"));
    if (token) {
      const db = getDb(), tokenHash = await hashToken(token), expectedUser = req.headers.get("x-study-user");
      if (expectedUser) {
        const current = await db.select({ userId: studySessions.userId }).from(studySessions).where(eq(studySessions.tokenHash, tokenHash)).get();
        if (current && current.userId !== expectedUser) return Response.json({ error: "登录账号已在另一页面切换，请刷新后再操作。" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      await db.delete(studySessions).where(eq(studySessions.tokenHash, tokenHash));
    }
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", req.url, true), "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "暂时无法退出，请重试。" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
