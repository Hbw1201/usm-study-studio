/** Seed only this checkout's local R2 emulator; this script has no remote mode. */
import './sites-env.mjs';
import {readFile,stat,realpath,mkdir,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const options=new Set(process.argv.slice(2));
for(const arg of options)if(!['--dry-run','--verify-only'].includes(arg))throw new Error('Unknown argument: '+arg+'. This script only writes LOCAL storage.');
const config=JSON.parse(await readFile(path.join(projectRoot,'dist/server/wrangler.json'),'utf8'));
const hosting=JSON.parse(await readFile(path.join(projectRoot,'.openai/hosting.json'),'utf8'));
const binding=config.r2_buckets?.find(item=>item.binding===hosting.r2);
if(!binding?.bucket_name||binding.remote)throw new Error('Build this project first; a local R2 binding is required in dist/server/wrangler.json.');
const manifest=JSON.parse(await readFile(path.join(projectRoot,'content/material-previews.json'),'utf8'));
const catalog=JSON.parse(await readFile(path.join(projectRoot,'content/catalog.json'),'utf8'));
if(manifest.version!==1||!Array.isArray(manifest.materials))throw new Error('Unsupported material manifest.');
const root=await realpath(path.join(projectRoot,'outputs/course-assets'));
const inside=(file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const entries=[],seen=new Set();
for(const material of manifest.materials){
  const resource=catalog.resources.find(item=>item.id===material.id&&item.courseId===material.courseId);
  if(!resource)throw new Error('Material not in course catalog: '+material.id);
  for(const kind of ['original','preview']){
    const asset=material[kind];if(!asset)continue;
    const expected='course-assets/'+resource.courseId+'/'+resource.id+'/'+(kind==='original'?'original.'+resource.ext:'preview.pdf');
    if(asset.key!==expected||seen.has(asset.key))throw new Error('Unexpected or duplicate asset key: '+asset.key);
    seen.add(asset.key);
    const file=await realpath(path.resolve(root,asset.file));
    if(!inside(file))throw new Error('Asset path leaves course-assets: '+asset.file);
    const info=await stat(file);
    if(!info.isFile()||info.size!==asset.bytes)throw new Error('Asset size mismatch: '+asset.file);
    if(kind==='original'&&info.size!==resource.bytes)throw new Error('Original differs from downloaded catalog: '+asset.file);
    entries.push({...asset,file,id:resource.id,courseId:resource.courseId,kind});
  }
}
if(manifest.materials.length!==catalog.resources.length||entries.filter(x=>x.kind==='original').length!==catalog.resources.length)throw new Error('Manifest must contain all '+catalog.resources.length+' course originals.');
console.log(JSON.stringify({mode:options.has('--verify-only')?'verify-local':options.has('--dry-run')?'dry-run':'seed-local',bucket:binding.bucket_name,objects:entries.length,bytes:entries.reduce((sum,item)=>sum+item.bytes,0),persistTo:'.wrangler/state/v3'}));
if(options.has('--dry-run'))process.exit(0);

const mf=new Miniflare({
  modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,inspectorPort:0,cf:false,
  defaultPersistRoot:path.join(projectRoot,'.wrangler/state/v3'),
  r2Buckets:{BUCKET:binding.bucket_name},
  script:`export default {async fetch(req,env){
    if(req.method!=="PUT")return new Response(null,{status:405});
    const key=new URL(req.url).pathname.slice(1);
    if(!/^course-assets\\/[A-Z0-9]+\\/material-\\d+\\/(original\\.[a-z0-9]+|preview\\.pdf)$/.test(key))return new Response(null,{status:400});
    const options=JSON.parse(req.headers.get("Local-Seed-Options"));
    await env.BUCKET.put(key,req.body,options);
    return new Response(null,{status:204});
  }}`
});
let wrote=0,skipped=0;
const failures=[];
try{
  const bucket=await mf.getR2Bucket('BUCKET');
  for(const [index,item] of entries.entries()){
    const hash=createHash('sha256');for await(const chunk of createReadStream(item.file))hash.update(chunk);
    const digest=hash.digest('hex'),existing=await bucket.head(item.key);
    const matches=existing?.size===item.bytes&&existing?.customMetadata?.sourceSha256===digest;
    if(matches){skipped++;continue;}
    if(options.has('--verify-only')){failures.push(item.key);continue;}
    const response=await mf.dispatchFetch('http://localhost/'+item.key,{
      method:'PUT',body:Readable.toWeb(createReadStream(item.file)),duplex:'half',
      headers:{'Content-Length':String(item.bytes),'Local-Seed-Options':JSON.stringify({httpMetadata:{contentType:item.mime},customMetadata:{sourceSha256:digest,resourceId:item.id,courseId:item.courseId}})}
    });
    if(!response.ok)throw new Error('Local seed failed for '+item.key+': '+response.status+' '+await response.text());
    const saved=await bucket.head(item.key);
    if(saved?.size!==item.bytes||saved?.customMetadata?.sourceSha256!==digest)throw new Error('Verification failed after writing '+item.key);
    wrote++;console.log('['+(index+1)+'/'+entries.length+'] '+item.key+' ('+Math.ceil(item.bytes/1024)+' KB)');
  }
  const result={mode:options.has('--verify-only')?'verified-local':'seeded-local',bucket:binding.bucket_name,objects:entries.length,wrote,skipped,failures,completedAt:new Date().toISOString()};
  await mkdir(path.join(projectRoot,'outputs'),{recursive:true});
  await writeFile(path.join(projectRoot,'outputs/course-assets-seed-report.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
  if(failures.length)process.exitCode=1;
}finally{await mf.dispose();}
