export const MATERIAL_MIME:Record<string,string>={
  pdf:"application/pdf",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip:"application/zip",mp4:"video/mp4",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif"
};

export type ByteRange={offset:number;length:number;end:number};

/** Single byte ranges cover browser PDF and video requests without buffering objects. */
export function parseMaterialRange(header:string,size:number):ByteRange|null{
  const match=/^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if(!match||!size||(!match[1]&&!match[2]))return null;
  const first=match[1]?Number(match[1]):undefined,last=match[2]?Number(match[2]):undefined;
  if((first!==undefined&&!Number.isSafeInteger(first))||(last!==undefined&&!Number.isSafeInteger(last)))return null;
  if(first===undefined){
    if(!last)return null;
    const length=Math.min(last,size);return {offset:size-length,length,end:size-1};
  }
  if(first>=size||(last!==undefined&&last<first))return null;
  const end=Math.min(last??size-1,size-1);
  return {offset:first,length:end-first+1,end};
}

export function materialDisposition(fileName:string,fallback:string,download:boolean){
  const encoded=encodeURIComponent(fileName).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
  return (download?"attachment":"inline")+'; filename="'+fallback+'"; filename*=UTF-8\'\''+encoded;
}

export function materialKey(resource:{courseId:string;id:string;ext:string},preview:boolean){
  return "course-assets/"+resource.courseId+"/"+resource.id+"/"+(preview&&resource.ext!=="pdf"?"preview.pdf":"original."+resource.ext);
}
