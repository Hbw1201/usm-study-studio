import {env} from "cloudflare:workers";
import {getAccountUser} from "../../../../lib/account-auth";
import {NOTE_IMAGE_ID,noteImageObjectKey} from "../../../../lib/note-images";

export const dynamic="force-dynamic";
const json=(error:string,status:number)=>Response.json({error},{status,headers:{"Cache-Control":"no-store"}});

export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
  const user=await getAccountUser();
  if(!user)return json("请先登录。",401);
  const {id}=await params;
  if(!NOTE_IMAGE_ID.test(id))return json("图片不存在。",404);
  if(!env.BUCKET)return json("图片存储暂不可用。",503);
  try{
    const object=await env.BUCKET.get(await noteImageObjectKey(user.userId,id));
    if(!object)return json("图片不存在或不属于当前账号。",404);
    return new Response(object.body,{headers:{
      "Content-Type":object.httpMetadata?.contentType||"application/octet-stream",
      "Content-Length":String(object.size),
      "Content-Disposition":"inline",
      "Cache-Control":"private, no-store",
      "X-Content-Type-Options":"nosniff",
      "Cross-Origin-Resource-Policy":"same-origin",
      "Content-Security-Policy":"default-src 'none'; sandbox",
    }});
  }catch{return json("暂时无法读取图片，请稍后重试。",503);}
}
