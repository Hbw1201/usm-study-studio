/** Sealed production bootstrap helpers. No credential is bundled with the application. */
export const PROVISION_PART_BYTES = 16 * 1024 * 1024;
export const PROVISION_JSON_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export type ProvisionAsset = {key:string;bytes:number;mime:string;resourceId:string;courseId:string;sha256?:string};
export type ProvisionUser = {id:string;displayName:string;passwordHash:string};
export type UploadTicket = {v:1;key:string;uploadId:string;sha256:string;expiresAt:number};
export type ProvisionPart = {partNumber:number;etag:string;bytes:number;receipt:string};
const hex = (bytes:Uint8Array) => Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const encode64 = (bytes:Uint8Array) => btoa(Array.from(bytes,b=>String.fromCharCode(b)).join("")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
function decode64(value:string){if(!/^[A-Za-z0-9_-]+$/.test(value))throw Error("Invalid signature.");return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));}
export async function sha256(bytes:Uint8Array){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes as BufferSource)));}
export async function authorizedProvisionToken(header:string|null,secret:unknown){
  if(typeof secret!=="string"||! /^[A-Za-z0-9_-]{43,128}$/.test(secret))return false;
  const candidate=header?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  if(!candidate)return false;
  const a=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(candidate)));
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(secret)));
  let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
export async function readProvisionBody(req:Request,maxBytes:number,expectedBytes?:number){
  const contentLength=req.headers.get("content-length");
  if(contentLength!==null&&(!/^\d+$/.test(contentLength)||Number(contentLength)>maxBytes||(expectedBytes!==undefined&&Number(contentLength)!==expectedBytes)))throw Error("Invalid body size.");
  if(!req.body)throw Error("Missing request body.");
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>maxBytes){await reader.cancel();throw Error("Body too large.");}chunks.push(item.value);}}finally{reader.releaseLock();}
  if(expectedBytes!==undefined&&size!==expectedBytes)throw Error("Body size does not match manifest.");
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;
}
export async function readProvisionJson(req:Request):Promise<Record<string,unknown>>{
  if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))throw Error("JSON required.");
  const value=JSON.parse(decoder.decode(await readProvisionBody(req,PROVISION_JSON_BYTES)));
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid JSON object.");return value;
}
export function validateProvisionUsers(value:unknown):ProvisionUser[]{
  const expected:Record<string,string>={"han-bowen":"Han Bowen","cao-chengwei":"Cao Chengwei"};
  if(!Array.isArray(value)||value.length!==2)throw Error("Both configured users are required.");
  const seen=new Set<string>();
  return value.map(item=>{
    if(!item||typeof item!=="object"||Object.keys(item).some(k=>!["id","displayName","passwordHash"].includes(k)))throw Error("Invalid account fields.");
    if(typeof item.id!=="string"||expected[item.id]!==item.displayName||seen.has(item.id)||typeof item.passwordHash!=="string"||!/^\$pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(item.passwordHash))throw Error("Invalid account seed.");
    seen.add(item.id);return {id:item.id,displayName:item.displayName,passwordHash:item.passwordHash};
  });
}
export function provisionAssetIndex(manifest:unknown){
  const value=manifest as {version?:number;materials?:Array<{id:string;courseId:string;sha256:string;original:{key:string;bytes:number;mime:string};preview?:{key:string;bytes:number;mime:string}}>};
  if(value.version!==1||!Array.isArray(value.materials))throw Error("Invalid material manifest.");
  const entries=new Map<string,ProvisionAsset>();
  for(const item of value.materials){
    if(!/^[A-Z0-9]+$/.test(item.courseId)||!/^material-\d+$/.test(item.id)||!isDigest(item.sha256))throw Error("Invalid material identity.");
    for(const kind of ["original","preview"] as const){const asset=item[kind];if(!asset)continue;
      const suffix=kind==="preview"?"preview.pdf":"original."+asset.key.split(".").pop();
      if(asset.key!==`course-assets/${item.courseId}/${item.id}/${suffix}`||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||entries.has(asset.key))throw Error("Invalid asset whitelist.");
      entries.set(asset.key,{key:asset.key,bytes:asset.bytes,mime:asset.mime,resourceId:item.id,courseId:item.courseId,...(kind==="original"?{sha256:item.sha256}:{})});
    }
  }return entries;
}
export function isDigest(value:unknown):value is string{return typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);}
export function validateDigest(asset:ProvisionAsset,value:unknown):string{if(!isDigest(value)||(asset.sha256&&asset.sha256!==value))throw Error("Source checksum does not match manifest.");return value;}
export function expectedPartBytes(size:number,partNumber:number){const count=Math.ceil(size/PROVISION_PART_BYTES);if(!Number.isInteger(partNumber)||partNumber<1||partNumber>count)throw Error("Invalid part number.");return Math.min(PROVISION_PART_BYTES,size-(partNumber-1)*PROVISION_PART_BYTES);}
async function hmacKey(secret:string){return crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);}
async function sign(secret:string,value:string){return encode64(new Uint8Array(await crypto.subtle.sign("HMAC",await hmacKey(secret),encoder.encode(value))));}
async function verify(secret:string,value:string,signature:string){try{return await crypto.subtle.verify("HMAC",await hmacKey(secret),decode64(signature),encoder.encode(value));}catch{return false;}}
export async function signUploadTicket(secret:string,value:UploadTicket){const payload=encode64(encoder.encode(JSON.stringify(value)));return payload+"."+await sign(secret,payload);}
export async function readUploadTicket(secret:string,input:unknown,now=Date.now()):Promise<UploadTicket>{
  if(typeof input!=="string"||input.length>3000)throw Error("Invalid upload ticket.");const pieces=input.split(".");
  if(pieces.length!==2||!await verify(secret,pieces[0],pieces[1]))throw Error("Invalid upload ticket.");
  const value=JSON.parse(decoder.decode(decode64(pieces[0])));
  if(value.v!==1||typeof value.key!=="string"||typeof value.uploadId!=="string"||value.uploadId.length<1||value.uploadId.length>1024||!isDigest(value.sha256)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now)throw Error("Expired or invalid upload ticket.");return value;
}
function receiptPayload(ticket:string,part:Pick<ProvisionPart,"partNumber"|"etag"|"bytes">){return JSON.stringify([ticket,part.partNumber,part.etag,part.bytes]);}
export async function signPartReceipt(secret:string,ticket:string,part:Pick<ProvisionPart,"partNumber"|"etag"|"bytes">){return sign(secret,receiptPayload(ticket,part));}
export async function validateParts(secret:string,ticket:string,size:number,value:unknown):Promise<ProvisionPart[]>{
  if(!Array.isArray(value)||value.length!==Math.ceil(size/PROVISION_PART_BYTES))throw Error("Incomplete multipart upload.");
  const sorted=[...value].sort((a,b)=>a?.partNumber-b?.partNumber);
  for(let i=0;i<sorted.length;i++){const part=sorted[i];if(!part||part.partNumber!==i+1||part.bytes!==expectedPartBytes(size,i+1)||typeof part.etag!=="string"||part.etag.length<1||part.etag.length>256||typeof part.receipt!=="string"||!await verify(secret,receiptPayload(ticket,part),part.receipt))throw Error("Invalid part receipt.");}
  return sorted;
}
