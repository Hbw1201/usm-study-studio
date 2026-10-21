import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { studySessions, studyUsers } from "../db/schema";
import { hashToken, readSessionToken } from "./account-security";

export type AccountUser = { userId: string; displayName: string };

export async function getAccountUser(): Promise<AccountUser | null> {
  const h = await headers();
  const token = readSessionToken(h.get("cookie"));
  if (!token) return null;
  const row = await getDb().select({ userId: studyUsers.id, displayName: studyUsers.displayName })
    .from(studySessions).innerJoin(studyUsers, eq(studySessions.userId, studyUsers.id))
    .where(and(eq(studySessions.tokenHash, await hashToken(token)), gt(studySessions.expiresAt, Date.now()), eq(studyUsers.disabled, false))).get();
  return row ?? null;
}

export async function requireAccountUser(): Promise<AccountUser> {
  const user = await getAccountUser();
  if (user) return user;
  redirect("/login");
}
