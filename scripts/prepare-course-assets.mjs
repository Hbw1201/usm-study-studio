/** Prepare private, reproducible course assets. No network uploads occur here. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
const input=path.resolve(root,'..');
const output=path.join(root,'outputs','course-assets');
const manifestPath=path.join(root,'content','material-previews.json');
const catalog=JSON.parse(await fs.readFile(path.join(root,'content','catalog.json'),'utf8'));
const args=process.argv.slice(2);
const prepareOnly=args.includes('--prepare-only');
const sofficeArg=args.indexOf('--soffice');
const soffice=sofficeArg>=0?path.resolve(args[sofficeArg+1]):path.join(root,'.sites-runtime','LibreOfficePortable','App','libreoffice','program','soffice.com');
const profile=pathToFileURL(path.join(root,'.sites-runtime','libreoffice-conversion-profile')).href;
const mime={pdf:'application/pdf',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',mp4:'video/mp4',zip:'application/zip',jpg:'image/jpeg',webp:'image/webp'};
async function walk(dir){const entries=await fs.readdir(dir,{withFileTypes:true});const files=[];for(const e of entries){const p=path.join(dir,e.name);if(e.isDirectory())files.push(...await walk(p));else files.push(p);}return files;}
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function slideCount(file){
  const handle=await fs.open(file,'r');
  try{
    const size=(await handle.stat()).size,tailSize=Math.min(size,65557),tail=Buffer.alloc(tailSize);
    await handle.read(tail,0,tailSize,size-tailSize);
    let footer=-1;
    for(let i=tail.length-22;i>=0;i--){if(tail.readUInt32LE(i)===0x06054b50){footer=i;break;}}
    if(footer<0)throw new Error('PPTX ZIP directory is missing');
    const directorySize=tail.readUInt32LE(footer+12),directoryOffset=tail.readUInt32LE(footer+16);
    if(directorySize>10000000||directoryOffset+directorySize>size)throw new Error('Invalid PPTX ZIP directory');
    const directory=Buffer.alloc(directorySize);await handle.read(directory,0,directorySize,directoryOffset);
    let count=0;
    for(let i=0;i+46<=directory.length;){
      if(directory.readUInt32LE(i)!==0x02014b50)throw new Error('Invalid PPTX ZIP entry');
      const nameSize=directory.readUInt16LE(i+28),extraSize=directory.readUInt16LE(i+30),commentSize=directory.readUInt16LE(i+32);
      const name=directory.subarray(i+46,i+46+nameSize).toString('utf8');
      if(/^ppt\/slides\/slide\d+\.xml$/.test(name))count++;
      i+=46+nameSize+extraSize+commentSize;
    }
    return count;
  }finally{await handle.close();}
}
function exec(command,argv,timeout=180000){return new Promise((resolve,reject)=>{const child=spawn(command,argv,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error('Conversion timed out: '+path.basename(command)));},timeout);child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error(stderr||stdout||'Exit code '+code));});});}
async function pageCount(file){try{const info=await exec('pdfinfo.exe',[file],30000);const found=info.match(/^Pages:\s+(\d+)/m);return found?Number(found[1]):undefined;}catch{return undefined;}}
async function stripEmbeddedVideos(file){
  if((await fs.stat(file)).size<50000000)return;
  const bundled=path.join(process.env.USERPROFILE||'','.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
  const python=process.env.COURSE_ASSETS_PYTHON||await fs.access(bundled).then(()=>bundled).catch(()=>'python');
  const staging=file+'.static.pdf';
  const report=await exec(python,[path.join(root,'scripts','prepare-course-assets.clean-pdf.py'),file,staging],180000);
  await fs.rename(staging,file);
  console.log('Static preview: '+report.trim());
}
const priorManifest=await fs.readFile(manifestPath,'utf8').then(JSON.parse).catch(()=>null);
const manifest={version:1,generatedAt:new Date().toISOString(),materials:Array.isArray(priorManifest?.materials)?priorManifest.materials.filter(m=>catalog.resources.some(r=>r.id===m.id)):[]};
async function writeManifest(){
  manifest.materials.sort((a,b)=>catalog.resources.findIndex(r=>r.id===a.id)-catalog.resources.findIndex(r=>r.id===b.id));
  const staging=manifestPath+'.tmp';await fs.writeFile(staging,JSON.stringify(manifest,null,2)+'\n');await fs.rename(staging,manifestPath);
}
const sourceFiles=[];
for(const c of catalog.courses){const courseDir=(await fs.readdir(input,{withFileTypes:true})).find(d=>d.isDirectory()&&d.name.startsWith(c.code+'_'));if(!courseDir)throw new Error('Course folder missing: '+c.code);sourceFiles.push(...await walk(path.join(input,courseDir.name)));}
const converted=new Map();
for(const r of catalog.resources){
  const matches=sourceFiles.filter(file=>path.basename(file)===r.fileName&&file.includes(r.courseId+'_'));
  let source;
  for(const file of matches){if((await fs.stat(file)).size===r.bytes){source=file;break;}}
  if(!source)throw new Error('Missing or changed original: '+r.id+' '+r.fileName);
  const dir=path.join(output,r.courseId,r.id);await fs.mkdir(dir,{recursive:true});
  const originalFile=path.join(dir,'original.'+r.ext);
  const hash=await digest(source);
  if(!await fs.stat(originalFile).then(s=>s.size===r.bytes).catch(()=>false))await fs.copyFile(source,originalFile);
  if(await digest(originalFile)!==hash)throw new Error('Original checksum mismatch: '+r.id);
  const asset=(name,ext,bytes)=>({file:[r.courseId,r.id,name].join('/'),key:['course-assets',r.courseId,r.id,name].join('/'),mime:mime[ext]||'application/octet-stream',bytes});
  const record={id:r.id,courseId:r.courseId,fileName:r.fileName,kind:r.ext==='pptx'?'slides':r.ext==='pdf'||r.ext==='docx'?'pdf':r.ext==='mp4'?'video':['jpg','webp','png'].includes(r.ext)?'image':'download',original:asset('original.'+r.ext,r.ext,r.bytes),sha256:hash,status:'ready'};
  if(r.ext==='pptx')record.sourceSlideCount=await slideCount(originalFile);
  if(r.ext==='pdf')record.pageCount=await pageCount(originalFile);
  if(['pptx','docx'].includes(r.ext)){
    const previewFile=path.join(dir,'preview.pdf');
    try{
      if(!await fs.stat(previewFile).then(s=>s.size>100).catch(()=>false)){
        if(converted.has(hash)){await fs.copyFile(converted.get(hash),previewFile);}
        else if(prepareOnly){record.status='awaiting_conversion';}
        else {
          const converter=r.ext==='pptx'?'pdf:impress_pdf_Export':'pdf:writer_pdf_Export';
          console.log('Converting '+r.id+' '+r.fileName);
          await exec(soffice,['-env:UserInstallation='+profile,'--headless','--nologo','--nodefault','--norestore','--convert-to',converter,'--outdir',dir,originalFile],240000);
          const temporary=path.join(dir,'original.pdf');
          await fs.rename(temporary,previewFile);
        }
      }
      if(record.status==='ready'){
        if(r.ext==='pptx')await stripEmbeddedVideos(previewFile);
        const stats=await fs.stat(previewFile);
        const buffer=Buffer.alloc(5),handle=await fs.open(previewFile,'r');await handle.read(buffer,0,5,0);await handle.close();
        if(buffer.toString()!=='%PDF-')throw new Error('Converter did not produce a valid PDF');
        record.preview=asset('preview.pdf','pdf',stats.size);
        record.pageCount=await pageCount(previewFile);
        if(!record.pageCount)throw new Error('PDF page count could not be verified');
        if(record.sourceSlideCount&&record.sourceSlideCount!==record.pageCount)throw new Error('Slide count mismatch: original '+record.sourceSlideCount+', preview '+record.pageCount);
        converted.set(hash,previewFile);
      }
    }catch(error){record.status='conversion_error';record.error=String(error.message||error);console.error(r.id+': '+record.error);}
  }
  const existingIndex=manifest.materials.findIndex(m=>m.id===record.id);
  if(existingIndex>=0)manifest.materials[existingIndex]=record;else manifest.materials.push(record);
  await writeManifest();
  console.log('Prepared '+r.id+' '+record.kind+(record.pageCount?' ('+record.pageCount+' pages)':'')+' '+record.status);
}
const failures=manifest.materials.filter(m=>m.status!=='ready');
console.log(JSON.stringify({resources:manifest.materials.length,ready:manifest.materials.length-failures.length,failures:failures.map(m=>({id:m.id,status:m.status,error:m.error}))}));
if(failures.length&&!prepareOnly)process.exitCode=1;
