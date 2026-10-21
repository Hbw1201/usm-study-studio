import {getAccountUser} from "../../../lib/account-auth";
import { getDb } from "../../../db";
import { workspaces } from "../../../db/schema";
import { and, eq } from "drizzle-orm";
import { writeSchema } from "../../../lib/validation";
export const dynamic="force-dynamic";
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){
  const user=await getAccountUser();if(!user)return response({error:'请先登录'},401);
  if(req.headers.get('X-Study-User')&&req.headers.get('X-Study-User')!==user.userId)return response({code:'ACCOUNT_CHANGED',error:'账号已切换，请重新进入账号。原账号的未同步记录仍保留在本机。'},409);
  try{const row=await getDb().select().from(workspaces).where(eq(workspaces.userId,user.userId)).get();return response({revision:row?.revision??0,data:row?JSON.parse(row.data):null});}
  catch{ return response({error:'暂时无法读取学习记录，请稍后重试。'},503); }
}
export async function PUT(req:Request){
  const user=await getAccountUser();if(!user)return response({error:'请先登录'},401);
  if(req.headers.get('X-Study-User')!==user.userId)return response({code:'ACCOUNT_CHANGED',error:'账号已切换，请重新进入账号后再编辑。'},409);
  if(req.headers.get('origin')!==new URL(req.url).origin)return response({error:'来源校验失败'},403);
  const raw=await req.text();if(raw.length>2000000)return response({error:'记录过大，请先导出部分笔记。'},413);
  let input;try{input=writeSchema.safeParse(JSON.parse(raw));}catch{return response({error:'数据格式无效'},400);}
  if(!input.success)return response({error:'学习记录格式不正确'},400);
  const {revision,data}=input.data;
  try{
    const db=getDb(),value={data:JSON.stringify(data),revision:revision+1,updatedAt:new Date().toISOString()};
    const result=revision===0?await db.insert(workspaces).values({...value,userId:user.userId}).onConflictDoNothing().returning():await db.update(workspaces).set(value).where(and(eq(workspaces.userId,user.userId),eq(workspaces.revision,revision))).returning();
    if(!result.length)return response({error:'另一窗口或设备更新了记录。请先导出当前记录，再重新载入。'},409);
    return response({revision:revision+1});
  }catch{return response({error:'保存暂时失败，当前改动已保留在本机待同步。'},503);}
}
