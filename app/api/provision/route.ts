import {env} from "cloudflare:workers";
import {eq,or} from "drizzle-orm";
import {getDb} from "../../../db";
import {studyUsers} from "../../../db/schema";
import {validateNewProvisionUser} from "../../../lib/provisioning";
import manifest from "../../../content/material-previews.json";
import {authorizedProvisionToken,expectedPartBytes,PROVISION_PART_BYTES,provisionAssetIndex,readProvisionBody,readProvisionJson,readUploadTicket,sha256,signPartReceipt,signUploadTicket,validateDigest,validateParts,validateProvisionUsers,type ProvisionAsset} from "../../../lib/provisioning";

export const dynamic="force-dynamic";
const assets=provisionAssetIndex(manifest);
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const secret=()=>((env as unknown as {STUDY_PROVISION_TOKEN?:string}).STUDY_PROVISION_TOKEN);
function bucket(){if(!env.BUCKET)throw Error("Provisioning bucket unavailable.");return env.BUCKET;}
async function authorize(req:Request){const token=secret();return token&&await authorizedProvisionToken(req.headers.get("authorization"),token)?token:null;}
function assetFor(key:unknown){if(typeof key!=="string"||!assets.has(key))throw Error("Asset is not in the course manifest.");return assets.get(key)!;}
const metadata=(asset:ProvisionAsset,digest:string)=>({httpMetadata:{contentType:asset.mime},customMetadata:{sourceSha256:digest,resourceId:asset.resourceId,courseId:asset.courseId}});
async function uploadContext(token:string,ticket:unknown){const value=await readUploadTicket(token,ticket);const asset=assetFor(value.key);validateDigest(asset,value.sha256);if(asset.bytes<=PROVISION_PART_BYTES)throw Error("Use a single object upload.");return {value,asset,upload:bucket().resumeMultipartUpload(value.key,value.uploadId)};}

export async function GET(req:Request){
  if(!await authorize(req))return json({error:"Not found."},404);
  try{
    const stored=new Map<string,R2Object>();let cursor:string|undefined;
    do{const options={prefix:"course-assets/",include:["customMetadata"],limit:1000,...(cursor?{cursor}:{})};const page=await bucket().list(options);for(const object of page.objects)if(assets.has(object.key))stored.set(object.key,object);cursor=page.truncated?page.cursor:undefined;}while(cursor);
    const objects=[...assets.values()].map(asset=>{const object=stored.get(asset.key);return {key:asset.key,expectedBytes:asset.bytes,bytes:object?.size??null,sha256:object?.customMetadata?.sourceSha256??null,present:!!object};});
    const users=await getDb().select({id:studyUsers.id,displayName:studyUsers.displayName}).from(studyUsers).where(or(eq(studyUsers.id,"han-bowen"),eq(studyUsers.id,"cao-chengwei")));
    return json({users,objects,partSize:PROVISION_PART_BYTES});
  }catch{return json({error:"Provisioning storage is unavailable."},503);}
}

export async function POST(req:Request){
  const token=await authorize(req);if(!token)return json({error:"Not found."},404);
  try{
    const body=await readProvisionJson(req);
    if(body.action==="createUser"){
      const user=validateNewProvisionUser(body.user);
      // Unique constraints protect existing IDs/usernames even under concurrent requests.
      // No update, password reset, or workspace write is permitted by this operation.
      const inserted=await getDb().insert(studyUsers).values({...user,username:user.displayName.toLowerCase(),createdAt:Date.now(),disabled:false}).onConflictDoNothing().returning({id:studyUsers.id,displayName:studyUsers.displayName});
      if(!inserted.length)return json({error:"Account already exists; no changes made."},409);
      return json({ok:true,user:inserted[0]},201);
    }
    if(body.action==="users"){
      const users=validateProvisionUsers(body.users),db=getDb();
      for(const user of users){
        const username=user.displayName.toLowerCase();
        const existing=await db.select({id:studyUsers.id,username:studyUsers.username}).from(studyUsers).where(or(eq(studyUsers.id,user.id),eq(studyUsers.username,username))).get();
        if(existing&&(existing.id!==user.id||existing.username!==username))return json({error:"Existing account identity conflicts with bootstrap."},409);
      }
      for(const user of users)await db.insert(studyUsers).values({...user,username:user.displayName.toLowerCase(),createdAt:Date.now(),disabled:false}).onConflictDoNothing();
      return json({ok:true,users:users.map(({id,displayName})=>({id,displayName}))});
    }
    if(body.action==="createMultipart"){
      const asset=assetFor(body.key),digest=validateDigest(asset,body.sha256);
      if(asset.bytes<=PROVISION_PART_BYTES)throw Error("Use a single object upload.");
      const upload=await bucket().createMultipartUpload(asset.key,metadata(asset,digest));
      const ticket=await signUploadTicket(token,{v:1,key:asset.key,uploadId:upload.uploadId,sha256:digest,expiresAt:Date.now()+24*60*60*1000});
      return json({ticket,uploadId:upload.uploadId,partSize:PROVISION_PART_BYTES,partCount:Math.ceil(asset.bytes/PROVISION_PART_BYTES)});
    }
    if(body.action==="completeMultipart"){
      const {value,asset,upload}=await uploadContext(token,body.ticket);
      const parts=await validateParts(token,body.ticket as string,asset.bytes,body.parts);
      const existing=await bucket().head(asset.key);
      if(existing?.size===asset.bytes&&existing.customMetadata?.sourceSha256===value.sha256)return json({ok:true,key:asset.key,bytes:existing.size,sha256:value.sha256});
      const object=await upload.complete(parts.map(({partNumber,etag})=>({partNumber,etag})));
      if(object.size!==asset.bytes)return json({error:"Completed object size differs from manifest."},409);
      return json({ok:true,key:asset.key,bytes:object.size,sha256:value.sha256});
    }
    if(body.action==="abortMultipart"){
      const {upload}=await uploadContext(token,body.ticket);await upload.abort();return json({ok:true});
    }
    return json({error:"Unknown provisioning action."},400);
  }catch{return json({error:"Provisioning request was rejected. Check the manifest, body size, upload ticket and part receipts."},400);}
}

export async function PUT(req:Request){
  const token=await authorize(req);if(!token)return json({error:"Not found."},404);
  try{
    const query=new URL(req.url).searchParams;
    if(query.get("mode")==="object"){
      const asset=assetFor(query.get("key")),digest=validateDigest(asset,query.get("sha256"));
      if(asset.bytes>PROVISION_PART_BYTES)throw Error("Multipart upload required.");
      const bytes=await readProvisionBody(req,PROVISION_PART_BYTES,asset.bytes);
      if(await sha256(bytes)!==digest)throw Error("Uploaded object checksum differs.");
      await bucket().put(asset.key,bytes,metadata(asset,digest));
      return json({ok:true,key:asset.key,bytes:bytes.byteLength,sha256:digest});
    }
    if(query.get("mode")==="part"){
      const ticket=query.get("ticket"),{asset,upload}=await uploadContext(token,ticket);
      const partNumber=Number(query.get("partNumber")),size=expectedPartBytes(asset.bytes,partNumber);
      const bytes=await readProvisionBody(req,PROVISION_PART_BYTES,size);
      const result=await upload.uploadPart(partNumber,bytes),part={partNumber,etag:result.etag,bytes:size};
      return json({...part,receipt:await signPartReceipt(token,ticket!,part)});
    }
    return json({error:"Unknown upload mode."},400);
  }catch{return json({error:"Upload rejected. Check the key, size, checksum or upload ticket."},400);}
}
