/** Import an explicit, fixed set of accounts and course assets into the hosted app.
 * Credentials and multipart tickets are accepted/retained in memory only.
 * Run: node scripts/provision-production.mjs, then supply the hidden JSON line.
 */
import {readFile,realpath,stat,open,mkdir,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const PART_SIZE=16*1024*1024;
const TIMEOUT=120_000;
const MAX_ATTEMPTS=3;
const HASH=/^[0-9a-f]{64}$/;
const EXPECTED_USERS={'han-bowen':'Han Bowen','cao-chengwei':'Cao Chengwei'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function parseProvisionInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['baseUrl','token','users'].includes(k)))throw Error('Invalid provisioning input.');
  let url;try{url=new URL(input.baseUrl);}catch{throw Error('Invalid deployment URL.');}
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Use an HTTPS site origin, or HTTP 127.0.0.1 for local checks.');
  if(typeof input.token!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(input.token))throw Error('Invalid provisioning token.');
  if(!Array.isArray(input.users)||input.users.length!==2)throw Error('Both configured accounts are required.');
  const seen=new Set();
  const users=input.users.map(user=>{
    if(!user||typeof user!=='object'||Object.keys(user).some(k=>!['id','displayName','passwordHash'].includes(k))||typeof user.id!=='string'||typeof user.displayName!=='string'||!Object.hasOwn(EXPECTED_USERS,user.id)||EXPECTED_USERS[user.id]!==user.displayName||seen.has(user.id)||typeof user.passwordHash!=='string'||!/^\$pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(user.passwordHash))throw Error('Invalid account seed.');
    seen.add(user.id);return {id:user.id,displayName:user.displayName,passwordHash:user.passwordHash};
  });
  return {baseUrl:url.origin,token:input.token,users};
}

async function hiddenInput(){
  console.log('Ready for production provisioning JSON on stdin (input hidden).');
  return new Promise((resolve,reject)=>{
    let buffer='',done=false;const raw=process.stdin.isTTY;
    if(raw)process.stdin.setRawMode(true);
    function finish(error){if(done)return;done=true;process.stdin.off('data',receive);process.stdin.off('end',ended);if(raw)process.stdin.setRawMode(false);process.stdin.pause();if(error)return reject(error);try{resolve(parseProvisionInput(JSON.parse(buffer.trim())));}catch(error){reject(error instanceof SyntaxError?Error('Invalid JSON input.'):error);}finally{buffer='';}}
    function receive(chunk){buffer+=chunk.toString('utf8');if(buffer.includes('\u0003'))return finish(Error('Cancelled.'));if(buffer.length>65536)return finish(Error('Input is too large.'));if(/[\r\n]/.test(buffer))finish();}
    function ended(){finish();}
    process.stdin.on('data',receive);process.stdin.on('end',ended);process.stdin.resume();
  });
}

async function digestFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}

export async function loadCourseAssets(projectRoot=ROOT){
  const manifest=JSON.parse(await readFile(path.join(projectRoot,'content/material-previews.json'),'utf8'));
  const catalog=JSON.parse(await readFile(path.join(projectRoot,'content/catalog.json'),'utf8'));
  if(manifest.version!==1||!Array.isArray(manifest.materials)||!Array.isArray(catalog.resources)||catalog.resources.length!==48||manifest.materials.length!==catalog.resources.length)throw Error('The complete 48-resource course manifest is required.');
  const assetsRoot=await realpath(path.join(projectRoot,'outputs/course-assets'));
  const entries=[],seen=new Set(),seenMaterials=new Set();
  for(const material of manifest.materials){
    const resource=catalog.resources.find(r=>r.id===material.id&&r.courseId===material.courseId);
    if(!resource||seenMaterials.has(material.id)||!HASH.test(material.sha256||'')||!material.original)throw Error('Invalid or duplicate course manifest entry.');
    seenMaterials.add(material.id);
    for(const kind of ['original','preview']){
      const asset=material[kind];if(!asset)continue;
      const expected=`course-assets/${resource.courseId}/${resource.id}/${kind==='original'?'original.'+resource.ext:'preview.pdf'}`;
      if(asset.key!==expected||seen.has(asset.key)||typeof asset.file!=='string'||!Number.isSafeInteger(asset.bytes)||asset.bytes<1)throw Error('Invalid asset path, key, or size.');
      const file=await realpath(path.resolve(assetsRoot,asset.file)),relative=path.relative(assetsRoot,file);
      if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Asset path is outside the course asset directory.');
      const info=await stat(file);
      if(!info.isFile()||info.size!==asset.bytes||(kind==='original'&&info.size!==resource.bytes))throw Error('Local course asset size differs from its manifest.');
      const sha256=await digestFile(file);
      if(kind==='original'&&sha256!==material.sha256)throw Error('Original course asset checksum differs from its manifest.');
      seen.add(asset.key);entries.push({key:asset.key,file,bytes:asset.bytes,sha256,kind,resourceId:resource.id,courseId:resource.courseId});
    }
  }
  if(entries.length!==74)throw Error('The complete set of 74 course objects is required.');
  return entries;
}

export function createProvisionClient(config,{fetchImpl=fetch,timeout=TIMEOUT,retryDelay=1000}={}){
  async function request(method,query,body){
    // Never follow a redirect carrying the provisioning Authorization header.
    const url=new URL('/api/provision',config.baseUrl);
    for(const [key,value] of Object.entries(query||{}))url.searchParams.set(key,String(value));
    let lastCode='NETWORK';
    for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
      try{
        const isJson=body!==undefined&&!Buffer.isBuffer(body);
        const response=await fetchImpl(url,{method,redirect:'manual',signal:controller.signal,headers:{Authorization:'Bearer '+config.token,...(body===undefined?{}:{'Content-Type':isJson?'application/json':'application/octet-stream'})},...(body===undefined?{}:{body:isJson?JSON.stringify(body):body})});
        if(!response.ok){await response.body?.cancel();lastCode='HTTP_'+response.status;if(response.status<500||attempt===MAX_ATTEMPTS)throw Object.assign(Error('Provisioning request failed ('+lastCode+').'),{permanent:true});}
        else{let value;try{value=await response.json();}catch{throw Object.assign(Error('Provisioning returned an invalid response.'),{permanent:true});}return value;}
      }catch(error){if(error?.permanent)throw error;if(attempt===MAX_ATTEMPTS)throw Error('Provisioning request failed ('+lastCode+').');}
      finally{clearTimeout(timer);}
      await sleep(retryDelay*2**(attempt-1));
    }
  }
  return {
    status:()=>request('GET'),
    users:users=>request('POST',null,{action:'users',users}),
    object:(asset,bytes)=>request('PUT',{mode:'object',key:asset.key,sha256:asset.sha256},bytes),
    create:asset=>request('POST',null,{action:'createMultipart',key:asset.key,sha256:asset.sha256}),
    part:(ticket,partNumber,bytes)=>request('PUT',{mode:'part',ticket,partNumber},bytes),
    complete:(ticket,parts)=>request('POST',null,{action:'completeMultipart',ticket,parts}),
    abort:ticket=>request('POST',null,{action:'abortMultipart',ticket}),
  };
}

export function statusMatches(status,asset){return Array.isArray(status?.objects)&&status.objects.some(o=>o.key===asset.key&&o.present===true&&o.bytes===asset.bytes&&o.sha256===asset.sha256);}
function verifyStatus(status){if(status?.partSize!==PART_SIZE||!Array.isArray(status?.objects)||!Array.isArray(status?.users))throw Error('Incompatible provisioning status response.');}

async function readPart(handle,size,offset){
  const buffer=Buffer.allocUnsafe(size);let filled=0;
  while(filled<size){const result=await handle.read(buffer,filled,size-filled,offset+filled);if(!result.bytesRead)throw Error('Course file changed or ended during upload.');filled+=result.bytesRead;}
  return buffer;
}

export async function uploadAsset(client,asset,onProgress=()=>{}){
  if(asset.bytes<=PART_SIZE){
    const bytes=await readFile(asset.file);
    if(bytes.length!==asset.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Course file changed before upload.');
    const result=await client.object(asset,bytes);
    if(result?.ok!==true||result.key!==asset.key||result.bytes!==asset.bytes||result.sha256!==asset.sha256)throw Error('Uploaded object verification failed.');
    return;
  }
  const created=await client.create(asset),count=Math.ceil(asset.bytes/PART_SIZE);
  if(typeof created?.ticket!=='string'||created.partSize!==PART_SIZE||created.partCount!==count)throw Error('Invalid multipart upload response.');
  const ticket=created.ticket,parts=[];const handle=await open(asset.file,'r');
  let complete=false;
  try{
    if((await handle.stat()).size!==asset.bytes)throw Error('Course file changed before upload.');
    for(let start=1;start<=count;start+=2){
      // At most two 16-MiB buffers and requests are active at once.
      const results=await Promise.allSettled(Array.from({length:Math.min(2,count-start+1)},async(_,i)=>{
        const partNumber=start+i,size=Math.min(PART_SIZE,asset.bytes-(partNumber-1)*PART_SIZE);
        const bytes=await readPart(handle,size,(partNumber-1)*PART_SIZE);
        const result=await client.part(ticket,partNumber,bytes);
        if(result?.partNumber!==partNumber||result.bytes!==size||typeof result.etag!=='string'||!result.etag||typeof result.receipt!=='string'||!result.receipt)throw Error('Invalid multipart part receipt.');
        return {partNumber,bytes:size,etag:result.etag,receipt:result.receipt};
      }));
      const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
      parts.push(...results.map(r=>r.value));onProgress(parts.length,count);
    }
    try{
      const result=await client.complete(ticket,parts);
      if(result?.ok!==true||result.key!==asset.key||result.bytes!==asset.bytes||result.sha256!==asset.sha256)throw Error('Completed object verification failed.');
    }catch{
      // Completion may have succeeded before a connection was interrupted.
      if(!statusMatches(await client.status(),asset))throw Error('Multipart completion could not be verified.');
    }
    complete=true;
  }finally{
    await handle.close();
    if(!complete)try{await client.abort(ticket);}catch{/* Rerun starts a fresh upload; no ticket is persisted. */}
  }
}

async function main(){
  let report;
  try{
    const input=await hiddenInput(),assets=await loadCourseAssets();
    console.log('Verified '+assets.length+' local course objects ('+assets.reduce((s,a)=>s+a.bytes,0)+' bytes).');
    const client=createProvisionClient(input);let status=await client.status();verifyStatus(status);
    report={baseUrl:input.baseUrl,startedAt:new Date().toISOString(),passed:false,accounts:input.users.map(({id,displayName})=>({id,displayName})),objects:assets.length,totalBytes:assets.reduce((s,a)=>s+a.bytes,0),uploaded:0,skipped:0,assets:[]};
    await client.users(input.users);
    for(const [index,asset] of assets.entries()){
      let action='skipped';
      if(statusMatches(status,asset))report.skipped++;
      else{await uploadAsset(client,asset,(done,total)=>console.log('['+(index+1)+'/'+assets.length+'] '+asset.key+' parts '+done+'/'+total));report.uploaded++;action='uploaded';}
      report.assets.push({key:asset.key,bytes:asset.bytes,sha256:asset.sha256,action});
      console.log('['+(index+1)+'/'+assets.length+'] '+action+' '+asset.key);
    }
    status=await client.status();verifyStatus(status);
    const missing=assets.filter(asset=>!statusMatches(status,asset));
    if(missing.length||input.users.some(user=>!status.users.some(saved=>saved.id===user.id&&saved.displayName===user.displayName)))throw Error('Final verification did not find all expected users and course objects.');
    report.passed=true;report.verified=assets.length;report.completedAt=new Date().toISOString();
    console.log('PASS: both accounts and all '+assets.length+' course objects verified.');
  }catch(error){
    // Only local, fixed error messages are surfaced; never echo response bodies,
    // URLs carrying tickets, input JSON, Authorization headers or raw fetch errors.
    const safe=error?.message;
    const allowed=/^(?:Invalid |Use an HTTPS|Both configured|Cancelled\.|Input is too large|The complete|Asset path|Local course|Original course|Provisioning request failed \((?:HTTP_\d{3}|NETWORK)\)\.|Provisioning returned|Incompatible provisioning|Course file changed|Uploaded object|Completed object|Multipart completion|Final verification)/;
    console.error(allowed.test(safe||'')?safe:'Production provisioning failed; local assets were preserved.');
    if(report)report.failure='Provisioning incomplete; rerun verifies and skips completed objects.';
    process.exitCode=1;
  }finally{
    if(report){await mkdir(path.join(ROOT,'outputs'),{recursive:true});await writeFile(path.join(ROOT,'outputs/production-provision-report.json'),JSON.stringify(report,null,2)+'\n');}
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
