/** Prepare private course assets without uploading them or changing source documents. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=path.resolve(import.meta.dirname,'..');
export const OFFICE_EXTENSIONS=new Set(['pptx','docx']);
const MIME={pdf:'application/pdf',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',mp4:'video/mp4',zip:'application/zip',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp'};

export function validateCourseCatalog(catalog){
  if(!catalog||!Array.isArray(catalog.courses)||!catalog.courses.length||!Array.isArray(catalog.resources)||!catalog.resources.length)throw Error('Invalid course catalog.');
  const courses=new Set(),resources=new Map();
  for(const course of catalog.courses){
    if(!course||typeof course.code!=='string'||!/^[A-Z0-9]+$/.test(course.code)||courses.has(course.code))throw Error('Invalid or duplicate course identity.');
    courses.add(course.code);
  }
  for(const r of catalog.resources){
    if(!r||typeof r.id!=='string'||!/^material-\d+$/.test(r.id)||resources.has(r.id)||!courses.has(r.courseId)||typeof r.ext!=='string'||!/^[a-z0-9]{1,12}$/.test(r.ext)||typeof r.fileName!=='string'||!r.fileName||/[\\/\0]/.test(r.fileName)||['.','..'].includes(r.fileName)||!Number.isSafeInteger(r.bytes)||r.bytes<1)throw Error('Invalid or duplicate course resource.');
    resources.set(r.id,r);
  }
  return resources;
}
function inside(base,target){
  const relative=path.relative(base,target);
  return !!relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);
}
async function walk(dir){
  const entries=await fs.readdir(dir,{withFileTypes:true}),files=[];
  for(const e of entries){const p=path.join(dir,e.name);if(e.isDirectory())files.push(...await walk(p));else files.push(p);}
  return files;
}
export async function digestFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}

/** Compare content, not only size. Stage and verify a fresh copy before replacing it. */
export async function synchronizeOriginal(source,target,expectedBytes){
  const sourceInfo=await fs.stat(source);
  if(!sourceInfo.isFile()||sourceInfo.size!==expectedBytes)throw Error('Local source size differs from its catalog.');
  const sha256=await digestFile(source);
  let unchanged=false;
  try{const current=await fs.stat(target);unchanged=current.isFile()&&current.size===expectedBytes&&await digestFile(target)===sha256;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(unchanged)return {sha256,changed:false};
  const staging=target+'.'+randomUUID()+'.tmp';
  try{
    await fs.copyFile(source,staging,constants.COPYFILE_EXCL);
    if((await fs.stat(staging)).size!==expectedBytes||await digestFile(staging)!==sha256)throw Error('Local source changed while preparing its staged copy.');
    await fs.rename(staging,target);
  }finally{await fs.rm(staging,{force:true});}
  return {sha256,changed:true};
}
async function slideCount(file){
  const handle=await fs.open(file,'r');
  try{
    const size=(await handle.stat()).size,tailSize=Math.min(size,65557),tail=Buffer.alloc(tailSize);
    await handle.read(tail,0,tailSize,size-tailSize);
    let footer=-1;
    for(let i=tail.length-22;i>=0;i--){if(tail.readUInt32LE(i)===0x06054b50){footer=i;break;}}
    if(footer<0)throw Error('PPTX ZIP directory is missing');
    const directorySize=tail.readUInt32LE(footer+12),directoryOffset=tail.readUInt32LE(footer+16);
    if(directorySize>10000000||directoryOffset+directorySize>size)throw Error('Invalid PPTX ZIP directory');
    const directory=Buffer.alloc(directorySize);await handle.read(directory,0,directorySize,directoryOffset);
    let count=0;
    for(let i=0;i+46<=directory.length;){
      if(directory.readUInt32LE(i)!==0x02014b50)throw Error('Invalid PPTX ZIP entry');
      const nameSize=directory.readUInt16LE(i+28),extraSize=directory.readUInt16LE(i+30),commentSize=directory.readUInt16LE(i+32);
      const end=i+46+nameSize+extraSize+commentSize;
      if(end>directory.length)throw Error('Invalid PPTX ZIP entry length');
      const name=directory.subarray(i+46,i+46+nameSize).toString('utf8');
      if(/^ppt\/slides\/slide\d+\.xml$/.test(name))count++;
      i=end;
    }
    if(!count)throw Error('PPTX contains no slides');
    return count;
  }finally{await handle.close();}
}
function exec(command,argv,root,timeout=180000){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,argv,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill();reject(Error('Conversion timed out: '+path.basename(command)));},timeout);
    child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    child.on('error',e=>{clearTimeout(timer);reject(e)});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(Error(stderr||stdout||'Exit code '+code));});
  });
}
async function stripEmbeddedVideos(file,root,log){
  if((await fs.stat(file)).size<50000000)return;
  const bundled=path.join(process.env.USERPROFILE||'','.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
  const python=process.env.COURSE_ASSETS_PYTHON||await fs.access(bundled).then(()=>bundled).catch(()=>'python');
  const staging=file+'.static.pdf';
  try{
    const report=await exec(python,[path.join(root,'scripts','prepare-course-assets.clean-pdf.py'),file,staging],root);
    await fs.rename(staging,file);log('Static preview: '+report.trim());
  }finally{await fs.rm(staging,{force:true});}
}
async function inspectPreview(file,getPageCount,sourceSlides){
  const stats=await fs.stat(file);
  if(!stats.isFile()||stats.size<=100)throw Error('Converter did not produce a valid PDF');
  const handle=await fs.open(file,'r'),header=Buffer.alloc(5);
  try{await handle.read(header,0,5,0);}finally{await handle.close();}
  if(header.toString()!=='%PDF-')throw Error('Converter did not produce a valid PDF');
  const pages=await getPageCount(file);
  if(!Number.isSafeInteger(pages)||pages<1)throw Error('PDF page count could not be verified');
  if(sourceSlides&&sourceSlides!==pages)throw Error('Slide count mismatch: original '+sourceSlides+', preview '+pages);
  return {bytes:stats.size,pages,sha256:await digestFile(file)};
}

export async function prepareCourseAssets({projectRoot=ROOT,inputRoot=path.resolve(projectRoot,'..'),prepareOnly=false,soffice,convertOffice,getPageCount,log=console.log}={}){
  const root=await fs.realpath(projectRoot),input=await fs.realpath(inputRoot);
  const manifestPath=path.join(root,'content','material-previews.json');
  const catalog=JSON.parse(await fs.readFile(path.join(root,'content','catalog.json'),'utf8')),resourceIndex=validateCourseCatalog(catalog);
  const outputPath=path.join(root,'outputs','course-assets');
  await fs.mkdir(outputPath,{recursive:true});
  const output=await fs.realpath(outputPath);
  if(!inside(root,output))throw Error('Asset path is outside the project directory.');
  const prior=await fs.readFile(manifestPath,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const previous=new Map();
  if(prior){
    if(prior.version!==1||!Array.isArray(prior.materials))throw Error('Invalid prior material manifest.');
    for(const m of prior.materials){
      if(!m||typeof m.id!=='string'||previous.has(m.id))throw Error('Invalid or duplicate prior material.');
      if(resourceIndex.has(m.id))previous.set(m.id,m);
    }
  }
  // Resolve the complete source set before modifying any staged original.
  const sources=new Map(),directories=await fs.readdir(input,{withFileTypes:true});
  for(const c of catalog.courses){
    const matches=directories.filter(d=>d.isDirectory()&&d.name.startsWith(c.code+'_'));
    if(matches.length!==1)throw Error('Missing or ambiguous course folder: '+c.code);
    const courseRoot=await fs.realpath(path.join(input,matches[0].name));
    if(!inside(input,courseRoot))throw Error('Asset path is outside the course source directory.');
    const files=await walk(courseRoot);
    for(const r of catalog.resources.filter(r=>r.courseId===c.code)){
      const candidates=[];
      for(const f of files.filter(f=>path.basename(f)===r.fileName)){
        const resolved=await fs.realpath(f);
        if(!inside(courseRoot,resolved))throw Error('Asset path is outside the course source directory.');
        const info=await fs.stat(resolved);if(info.isFile()&&info.size===r.bytes)candidates.push(resolved);
      }
      if(!candidates.length)throw Error('Missing or changed original: '+r.id+' '+r.fileName);
      if(candidates.length>1){const hashes=await Promise.all(candidates.map(digestFile));if(new Set(hashes).size!==1)throw Error('Ambiguous source versions: '+r.id);}
      sources.set(r.id,candidates[0]);
    }
  }
  const converter=soffice||path.join(root,'.sites-runtime','LibreOfficePortable','App','libreoffice','program','soffice.com');
  const profile=pathToFileURL(path.join(root,'.sites-runtime','libreoffice-conversion-profile')).href;
  getPageCount??=async file=>{try{const info=await exec('pdfinfo.exe',[file],root,30000);const found=info.match(/^Pages:\s+(\d+)/m);return found?Number(found[1]):undefined;}catch{return undefined;}};
  convertOffice??=async({source,outdir,ext})=>{
    await exec(converter,['-env:UserInstallation='+profile,'--headless','--nologo','--nodefault','--norestore','--convert-to',ext==='pptx'?'pdf:impress_pdf_Export':'pdf:writer_pdf_Export','--outdir',outdir,source],root,240000);
  };
  const manifest={version:1,generatedAt:new Date().toISOString(),materials:[...previous.values()]},converted=new Map();
  async function save(record){
    const index=manifest.materials.findIndex(m=>m.id===record.id);
    if(index>=0)manifest.materials[index]=record;else manifest.materials.push(record);
    const order=[...resourceIndex.keys()];manifest.materials.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    const staging=manifestPath+'.tmp';await fs.writeFile(staging,JSON.stringify(manifest,null,2)+'\n');await fs.rename(staging,manifestPath);
  }
  for(const r of catalog.resources){
    const dirPath=path.join(output,r.courseId,r.id);await fs.mkdir(dirPath,{recursive:true});
    const dir=await fs.realpath(dirPath);if(!inside(output,dir))throw Error('Asset path is outside the course asset directory.');
    const originalFile=path.join(dir,'original.'+r.ext);
    const synced=await synchronizeOriginal(sources.get(r.id),originalFile,r.bytes),hash=synced.sha256;
    const asset=(name,ext,bytes)=>({file:[r.courseId,r.id,name].join('/'),key:['course-assets',r.courseId,r.id,name].join('/'),mime:MIME[ext]||'application/octet-stream',bytes});
    const record={id:r.id,courseId:r.courseId,fileName:r.fileName,kind:r.ext==='pptx'?'slides':r.ext==='pdf'||r.ext==='docx'?'pdf':r.ext==='mp4'?'video':['jpg','jpeg','png','gif','webp'].includes(r.ext)?'image':'download',original:asset('original.'+r.ext,r.ext,r.bytes),sha256:hash,status:'ready'};
    if(r.ext==='pptx')record.sourceSlideCount=await slideCount(originalFile);
    if(r.ext==='pdf')record.pageCount=await getPageCount(originalFile);
    if(OFFICE_EXTENSIONS.has(r.ext)){
      const previewFile=path.join(dir,'preview.pdf'),old=previous.get(r.id),cacheKey=r.ext+':'+hash;
      let preview,jobDir;
      try{
        const reusable=!synced.changed&&old?.sha256===hash&&old.status==='ready'&&old.preview;
        if(reusable){
          try{
            const inspected=await inspectPreview(previewFile,getPageCount,record.sourceSlideCount);
            if(inspected.bytes===old.preview.bytes&&(!old.preview.sha256||inspected.sha256===old.preview.sha256))preview=inspected;
          }catch{/* An absent or damaged cached preview must be regenerated. */}
        }
        if(!preview){
          if(prepareOnly&&!converted.has(cacheKey))record.status='awaiting_conversion';
          else{
            jobDir=await fs.mkdtemp(path.join(dir,'.conversion-'));
            const candidate=path.join(jobDir,'original.pdf');
            if(converted.has(cacheKey))await fs.copyFile(converted.get(cacheKey),candidate);
            else{
              log('Converting '+r.id+' '+r.fileName);
              await convertOffice({source:originalFile,outdir:jobDir,ext:r.ext});
              if(r.ext==='pptx')await stripEmbeddedVideos(candidate,root,log);
            }
            preview=await inspectPreview(candidate,getPageCount,record.sourceSlideCount);
            await fs.rename(candidate,previewFile);
          }
        }
        if(preview){
          record.preview={...asset('preview.pdf','pdf',preview.bytes),sha256:preview.sha256};
          record.pageCount=preview.pages;converted.set(cacheKey,previewFile);
        }
      }catch(error){record.status='conversion_error';record.error=String(error.message||error);log(r.id+': '+record.error);}
      finally{if(jobDir&&inside(dir,jobDir))await fs.rm(jobDir,{recursive:true,force:true});}
    }
    await save(record);log('Prepared '+r.id+' '+record.kind+(record.pageCount?' ('+record.pageCount+' pages)':'')+' '+record.status);
  }
  if(manifest.materials.length!==resourceIndex.size||manifest.materials.some(m=>!resourceIndex.has(m.id)))throw Error('The complete catalog must be represented in the material manifest.');
  const failures=manifest.materials.filter(m=>m.status!=='ready');
  log(JSON.stringify({resources:manifest.materials.length,ready:manifest.materials.length-failures.length,failures:failures.map(m=>({id:m.id,status:m.status,error:m.error}))}));
  return manifest;
}
async function main(){
  const args=process.argv.slice(2),sofficeArg=args.indexOf('--soffice');
  if(sofficeArg>=0&&!args[sofficeArg+1])throw Error('--soffice requires an executable path.');
  const prepareOnly=args.includes('--prepare-only');
  const manifest=await prepareCourseAssets({prepareOnly,...(sofficeArg>=0?{soffice:path.resolve(args[sofficeArg+1])}:{})});
  if(!prepareOnly&&manifest.materials.some(m=>m.status!=='ready'))process.exitCode=1;
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>null)===await fs.realpath(fileURLToPath(import.meta.url)))await main();
