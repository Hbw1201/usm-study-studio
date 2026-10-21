/** Shared limits and signature checks for private notebook image uploads. */
export const MAX_NOTE_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_NOTE_UPLOAD_BYTES = MAX_NOTE_IMAGE_BYTES + 64 * 1024;
export const NOTE_IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type NoteImageInfo = {mime:string;extension:string;width:number;height:number};

export class NoteImageError extends Error {
  status:number;
  constructor(message:string,status=400){super(message);this.name="NoteImageError";this.status=status;}
}

const ascii = (bytes:Uint8Array,start:number,length:number)=>String.fromCharCode(...bytes.subarray(start,start+length));

/** Inspect dimensions without decoding an attacker-controlled large bitmap. */
export function inspectNoteImage(bytes:Uint8Array):NoteImageInfo {
  if(!bytes.length)throw new NoteImageError("请选择一张非空图片。");
  if(bytes.length>MAX_NOTE_IMAGE_BYTES)throw new NoteImageError("单张图片不能超过 8 MB，请先压缩图片。",413);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let result:NoteImageInfo|undefined;
  if(bytes.length>=33&&bytes[0]===137&&ascii(bytes,1,7)==="PNG\r\n\u001a\n"&&view.getUint32(8)===13&&ascii(bytes,12,4)==="IHDR"){
    result={mime:"image/png",extension:"png",width:view.getUint32(16),height:view.getUint32(20)};
  }else if(bytes.length>=13&&["GIF87a","GIF89a"].includes(ascii(bytes,0,6))){
    result={mime:"image/gif",extension:"gif",width:view.getUint16(6,true),height:view.getUint16(8,true)};
  }else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
    // JPEG SOF markers carry dimensions; skip metadata using declared segment sizes.
    let offset=2;
    while(offset+3<bytes.length){
      if(bytes[offset++]!==255)break;
      while(offset<bytes.length&&bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===0xd9||marker===0xda)break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(offset+2>bytes.length)break;
      const length=view.getUint16(offset);
      if(length<2||offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8){
        result={mime:"image/jpeg",extension:"jpg",width:view.getUint16(offset+5),height:view.getUint16(offset+3)};
        break;
      }
      offset+=length;
    }
  }else if(bytes.length>=20&&ascii(bytes,0,4)==="RIFF"&&ascii(bytes,8,4)==="WEBP"&&view.getUint32(4,true)+8<=bytes.length){
    const kind=ascii(bytes,12,4),size=view.getUint32(16,true);
    if(size+20<=bytes.length){
      if(kind==="VP8X"&&size>=10){
        const uint24=(index:number)=>bytes[index]+bytes[index+1]*256+bytes[index+2]*65536;
        result={mime:"image/webp",extension:"webp",width:uint24(24)+1,height:uint24(27)+1};
      }else if(kind==="VP8L"&&size>=5&&bytes[20]===0x2f){
        const bits=view.getUint32(21,true);
        result={mime:"image/webp",extension:"webp",width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};
      }else if(kind==="VP8 "&&size>=10&&bytes[23]===0x9d&&bytes[24]===0x01&&bytes[25]===0x2a){
        result={mime:"image/webp",extension:"webp",width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff};
      }
    }
  }
  if(!result)throw new NoteImageError("无法识别图片，请上传 PNG、JPEG、WebP 或 GIF 文件。");
  if(!result.width||!result.height||result.width>16000||result.height>16000||result.width*result.height>40000000){
    throw new NoteImageError("图片尺寸过大或无效，请缩小到 4000 万像素以内，单边不超过 16000 像素。",413);
  }
  return result;
}

export async function readBoundedUpload(body:ReadableStream<Uint8Array>|null,maxBytes=MAX_NOTE_UPLOAD_BYTES):Promise<Uint8Array<ArrayBuffer>>{
  if(!body)throw new NoteImageError("没有收到图片，请重新选择。");
  const reader=body.getReader(),chunks:Uint8Array[]=[];
  let length=0;
  try{
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      length+=chunk.value.byteLength;
      if(length>maxBytes){await reader.cancel();throw new NoteImageError("上传文件过大，单张图片不能超过 8 MB。",413);}
      chunks.push(chunk.value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}

export async function noteImageObjectKey(userId:string,imageId:string):Promise<string>{
  if(!NOTE_IMAGE_ID.test(imageId))throw new NoteImageError("图片不存在。",404);
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(userId));
  const owner=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
  return "note-images/"+owner+"/"+imageId;
}
