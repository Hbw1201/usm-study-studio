import {env} from "cloudflare:workers";
import {getAccountUser} from "../../../../lib/account-auth";
import catalog from "../../../../content/catalog.json";
import {MATERIAL_MIME,materialDisposition,materialKey,parseMaterialRange} from "../../../../lib/material-files";

export const dynamic="force-dynamic";
const json=(error:string,status:number)=>Response.json({error},{status,headers:{"Cache-Control":"no-store"}});
type Context={params:Promise<{id:string}>};

async function serve(req:Request,{params}:Context,head=false){
  const user=await getAccountUser();if(!user)return json("请先登录后阅读课程资料。",401);
  const {id}=await params,resource=catalog.resources.find(item=>item.id===id);
  if(!resource)return json("没有找到这份课程资料。",404);
  if(!env.BUCKET)return json("课程资料存储暂不可用。",503);
  const url=new URL(req.url),preview=url.searchParams.get("preview")==="1",download=url.searchParams.get("download")==="1";
  if(preview&&!["pdf","pptx","docx"].includes(resource.ext))return json("这份资料没有 PDF 预览。",404);
  const ext=preview?"pdf":resource.ext,key=materialKey(resource,preview),fileName=preview?resource.fileName.replace(/\.[^.]+$/,".pdf"):resource.fileName;
  try{
    const metadata=await env.BUCKET.head(key);
    if(!metadata)return json(preview?"这份资料的 PDF 预览尚未准备好，请稍后重试。":"这份课程资料尚未准备好，请稍后重试。",404);
    const headers=new Headers({
      "Content-Type":MATERIAL_MIME[ext]||"application/octet-stream",
      "Content-Disposition":materialDisposition(fileName,resource.id+"."+ext,download),
      "Content-Length":String(metadata.size),
      "Cache-Control":"private, no-store",
      "Accept-Ranges":"bytes",
      "ETag":metadata.httpEtag,
      "Last-Modified":metadata.uploaded.toUTCString(),
      "X-Content-Type-Options":"nosniff",
      "Cross-Origin-Resource-Policy":"same-origin"
    });
    if(head)return new Response(null,{headers});
    const requestedRange=req.headers.get("range"),ifRange=req.headers.get("if-range");
    const canRange=!ifRange||ifRange===metadata.httpEtag||(!ifRange.includes('"')&&Date.parse(ifRange)>=Math.floor(metadata.uploaded.getTime()/1000)*1000);
    const range=requestedRange&&canRange?parseMaterialRange(requestedRange,metadata.size):undefined;
    if(range===null){headers.set("Content-Range","bytes */"+metadata.size);headers.set("Content-Length","0");return new Response(null,{status:416,headers});}
    const object=await env.BUCKET.get(key,range?{range:{offset:range.offset,length:range.length}}:undefined);
    if(!object)return json("课程资料暂时无法读取，请重试。",404);
    if(range){headers.set("Content-Length",String(range.length));headers.set("Content-Range","bytes "+range.offset+"-"+range.end+"/"+metadata.size);}
    return new Response(object.body,{status:range?206:200,headers});
  }catch{return json("课程资料读取失败，请稍后重试。",503);}
}

export const GET=(req:Request,context:Context)=>serve(req,context);
export const HEAD=(req:Request,context:Context)=>serve(req,context,true);
