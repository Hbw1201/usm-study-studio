function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('zhixi-course-files',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function storeFile(key:string,file:File){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
export async function readFile(key:string):Promise<File|undefined>{const db=await database();try{return await new Promise((resolve,reject)=>{const r=db.transaction('files').objectStore('files').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
export async function fileKeys():Promise<string[]>{const db=await database();try{return await new Promise((resolve,reject)=>{const r=db.transaction('files').objectStore('files').getAllKeys();r.onsuccess=()=>resolve(r.result.map(String));r.onerror=()=>reject(r.error);});}finally{db.close();}}
// Read only XML parts for Office text previews; no original file leaves this device.
export async function officeText(file:File):Promise<{title:string;text:string}[]>{
  if(file.size>60*1024*1024)throw new Error('此文件较大，请下载后用 Office 打开。');
  const bytes=new Uint8Array(await file.arrayBuffer()),v=new DataView(bytes.buffer);
  let eocd=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){if(v.getUint32(p,true)===0x06054b50){eocd=p;break;}}
  if(eocd<0)throw new Error('无法读取这个 Office 文件。');
  const count=v.getUint16(eocd+10,true);let pos=v.getUint32(eocd+16,true);const parts:{name:string;text:string}[]=[];
  for(let n=0;n<count;n++){
    if(pos+46>bytes.length||v.getUint32(pos,true)!==0x02014b50)throw new Error('文件目录损坏');
    const method=v.getUint16(pos+10,true),size=v.getUint32(pos+20,true),full=v.getUint32(pos+24,true),nameLen=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
    const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+nameLen));pos+=46+nameLen+extra+comment;
    if(!/^ppt\/slides\/slide\d+\.xml$/.test(name)&&name!=='word/document.xml')continue;
    if(full>8*1024*1024||offset+30>bytes.length)throw new Error('文档内容过大，建议用 Office 打开。');
    const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);
    if(start+size>bytes.length)throw new Error('文件数据不完整');
    const data=bytes.slice(start,start+size);let decoded:Uint8Array;
    if(method===0)decoded=data;else if(method===8){const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));const reader=stream.getReader();const chunks:Uint8Array[]=[];let total=0;while(true){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>8*1024*1024){await reader.cancel();throw new Error('文档解压内容过大');}chunks.push(r.value);}decoded=new Uint8Array(total);let off=0;for(const chunk of chunks){decoded.set(chunk,off);off+=chunk.length;}}else throw new Error('暂不支持此文档的压缩方式');
    const xml=new DOMParser().parseFromString(new TextDecoder().decode(decoded),'text/xml');const paras=[...xml.getElementsByTagName(name.startsWith('ppt/')?'a:p':'w:p')];
    parts.push({name,text:paras.map(p=>[...p.getElementsByTagName(name.startsWith('ppt/')?'a:t':'w:t')].map(t=>t.textContent??'').join('')).filter(Boolean).join('\n')});
  }
  return parts.sort((a,b)=>(Number(a.name.match(/slide(\d+)/)?.[1])||0)-(Number(b.name.match(/slide(\d+)/)?.[1])||0)).map((p,i)=>({title:file.name.endsWith('.pptx')?`第 ${i+1} 页`:'文档正文',text:p.text||'此页主要是图片或图表，请用 Office 查看原始版式。'}));
}
