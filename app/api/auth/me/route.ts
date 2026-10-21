import { getAccountUser } from "../../../../lib/account-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await getAccountUser();
    return Response.json(user ? { user } : { error: "请先登录。" }, { status: user ? 200 : 401, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "暂时无法读取登录状态。" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
