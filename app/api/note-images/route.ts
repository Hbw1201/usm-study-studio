import {env} from "cloudflare:workers";
import {getAccountUser} from "../../../lib/account-auth";
import {MAX_NOTE_UPLOAD_BYTES,NoteImageError,inspectNoteImage,noteImageObjectKey,readBoundedUpload} from "../../../lib/note-images";

export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});

export async function POST(req:Request){
  const user=await getAccountUser();
  if(!user)return json({error:"请先登录后再上传图片。"},401);
  if(req.headers.get("X-Study-User")!==user.userId)return json({code:"ACCOUNT_CHANGED",error:"账号已切换，请重新进入当前账号后再上传图片。"},409);
  if(req.headers.get("origin")!==new URL(req.url).origin)return json({error:"来源校验失败。"},403);
  if(!env.BUCKET)return json({error:"图片存储暂不可用，请稍后重试。"},503);
  const type=req.headers.get("content-type")||"";
  if(!/^multipart\/form-data\s*;/i.test(type))return json({error:"请通过图片上传按钮选择文件。"},415);
  const declared=Number(req.headers.get("content-length")||0);
  if(declared>MAX_NOTE_UPLOAD_BYTES)return json({error:"单张图片不能超过 8 MB。"},413);
  try{
    const bytes=await readBoundedUpload(req.body);
    let form:FormData;
    try{form=await new Response(bytes,{headers:{"Content-Type":type}}).formData();}
    catch{throw new NoteImageError("图片上传内容不完整，请重试。");}
    const files=form.getAll("file");
    if(files.length!==1||typeof files[0]==="string")throw new NoteImageError("请每次选择一张图片。");
    const file=files[0],content=new Uint8Array(await file.arrayBuffer());
    const info=inspectNoteImage(content),id=crypto.randomUUID(),key=await noteImageObjectKey(user.userId,id);
    const name=(file.name||"我的图片."+info.extension).replace(/[\u0000-\u001f\u007f]/g,"").slice(0,200);
    await env.BUCKET.put(key,content,{httpMetadata:{contentType:info.mime},customMetadata:{width:String(info.width),height:String(info.height)}});
    return json({id,url:"/api/note-images/"+id,name,width:info.width,height:info.height,mime:info.mime,bytes:content.byteLength},201);
  }catch(error){
    if(error instanceof NoteImageError)return json({error:error.message},error.status);
    return json({error:"图片上传失败，请稍后重试。"},503);
  }
}
