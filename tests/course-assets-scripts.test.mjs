import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareCourseAssets,validateCourseCatalog} from '../scripts/prepare-course-assets.mjs';
import {loadCourseAssets,parseProvisionInput,provisionCourseAssets,statusMatches} from '../scripts/provision-production.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const quiet=()=>{};
async function temp(t){
  const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'study-assets-test-'));
  t.after(async()=>{assert.equal(path.dirname(dir),parent);assert.ok(path.basename(dir).startsWith('study-assets-test-'));await fs.rm(dir,{recursive:true,force:true});});
  return dir;
}
async function json(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value));}
function catalog(resources){return {courses:[{code:'CMT322W'}],resources};}
function resource(id,ext,bytes){return {id,courseId:'CMT322W',fileName:id+'.'+ext,ext,bytes};}
async function stagedFixture(t,types=['docx','pdf','png']){
  const root=await temp(t),resources=[],materials=[];
  for(const [index,ext] of types.entries()){
    const id='material-'+(100+index),body=Buffer.from('original '+id),r=resource(id,ext,body.length);
    const dir=path.join(root,'outputs','course-assets',r.courseId,id);
    await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'original.'+ext),body);
    const asset=(file,mime,bytes)=>({file:r.courseId+'/'+id+'/'+file,key:'course-assets/'+r.courseId+'/'+id+'/'+file,mime,bytes});
    const m={id,courseId:r.courseId,fileName:r.fileName,sha256:hash(body),status:'ready',original:asset('original.'+ext,'application/octet-stream',body.length)};
    if(['docx','pptx'].includes(ext)){
      const preview=Buffer.from('%PDF-1.4\n'+id+'\n'+'p'.repeat(120));
      await fs.writeFile(path.join(dir,'preview.pdf'),preview);
      m.preview={...asset('preview.pdf','application/pdf',preview.length),sha256:hash(preview)};
    }
    resources.push(r);materials.push(m);
  }
  const data=catalog(resources),manifest={version:1,materials};
  await json(path.join(root,'content','catalog.json'),data);
  await json(path.join(root,'content','material-previews.json'),manifest);
  return {root,catalog:data,manifest};
}
async function preparationFixture(t){
  const base=await temp(t),root=path.join(base,'project'),input=path.join(base,'courses'),courseDir=path.join(input,'CMT322W_Test');
  const body=Buffer.from('version-A'),r=resource('material-200','docx',body.length);
  await json(path.join(root,'content','catalog.json'),catalog([r]));
  await fs.mkdir(courseDir,{recursive:true});const source=path.join(courseDir,r.fileName);await fs.writeFile(source,body);
  let conversions=0;
  const options={projectRoot:root,inputRoot:input,log:quiet,getPageCount:async()=>1,convertOffice:async({source,outdir})=>{
    conversions++;const bytes=await fs.readFile(source);await fs.writeFile(path.join(outdir,'original.pdf'),Buffer.concat([Buffer.from('%PDF-1.4\n'),bytes,Buffer.from('\n'+'p'.repeat(120))]));
  }};
  return {root,source,options,count:()=>conversions,staged:path.join(root,'outputs/course-assets/CMT322W/material-200/original.docx'),preview:path.join(root,'outputs/course-assets/CMT322W/material-200/preview.pdf')};
}

test('same-sized source revisions refresh staging and regenerate Office previews, unchanged sources are reused',async t=>{
  const f=await preparationFixture(t),first=await prepareCourseAssets(f.options);
  const initialPreview=await fs.readFile(f.preview);
  assert.equal(f.count(),1);
  await prepareCourseAssets(f.options);assert.equal(f.count(),1);
  await fs.writeFile(f.source,'version-B');
  const updated=await prepareCourseAssets(f.options);
  assert.equal(f.count(),2);assert.equal(await fs.readFile(f.staged,'utf8'),'version-B');
  assert.notEqual(updated.materials[0].sha256,first.materials[0].sha256);
  assert.notDeepEqual(await fs.readFile(f.preview),initialPreview);
  assert.equal(updated.materials[0].preview.sha256,hash(await fs.readFile(f.preview)));
  assert.equal(updated.materials[0].status,'ready');
});

test('prepare-only invalidates revised Office previews and the next full run rebuilds them',async t=>{
  const f=await preparationFixture(t);await prepareCourseAssets(f.options);
  const before=await fs.readFile(f.preview);await fs.writeFile(f.source,'version-B');
  const pending=await prepareCourseAssets({...f.options,prepareOnly:true});
  assert.equal(pending.materials[0].status,'awaiting_conversion');assert.equal(pending.materials[0].preview,undefined);
  assert.deepEqual(await fs.readFile(f.preview),before);
  await assert.rejects(()=>loadCourseAssets(f.root),/incomplete/);
  const finished=await prepareCourseAssets(f.options);
  assert.equal(f.count(),2);assert.equal(finished.materials[0].status,'ready');
});

test('conversion failure never advertises a stale preview and retry can recover',async t=>{
  const f=await preparationFixture(t);await prepareCourseAssets(f.options);
  const before=await fs.readFile(f.preview);await fs.writeFile(f.source,'version-B');
  const failed=await prepareCourseAssets({...f.options,convertOffice:async()=>{throw Error('Simulated converter failure');}});
  assert.equal(failed.materials[0].status,'conversion_error');assert.equal(failed.materials[0].preview,undefined);
  assert.deepEqual(await fs.readFile(f.preview),before);
  assert.equal((await prepareCourseAssets(f.options)).materials[0].status,'ready');
});

test('same-sized damage to a staged original is repaired from its source',async t=>{
  const f=await preparationFixture(t);await prepareCourseAssets(f.options);
  await fs.writeFile(f.staged,'damaged-X');
  await prepareCourseAssets(f.options);
  assert.equal(await fs.readFile(f.staged,'utf8'),'version-A');assert.equal(f.count(),2);
});

test('course loading derives a complete object set from a variable-sized catalog',async t=>{
  const f=await stagedFixture(t),assets=await loadCourseAssets(f.root);
  assert.equal(f.catalog.resources.length,3);assert.equal(assets.length,4);
  assert.equal(new Set(assets.map(a=>a.key)).size,4);
  assert.equal(assets.reduce((s,a)=>s+a.bytes,0),f.manifest.materials.reduce((s,m)=>s+m.original.bytes+(m.preview?.bytes||0),0));
});

test('course loading rejects missing Office previews, duplicate identities and incomplete manifests',async t=>{
  const f=await stagedFixture(t),file=path.join(f.root,'content/material-previews.json');
  const incomplete=structuredClone(f.manifest);delete incomplete.materials[0].preview;
  await json(file,incomplete);await assert.rejects(()=>loadCourseAssets(f.root),/complete Office preview/);
  await json(file,{...f.manifest,materials:[f.manifest.materials[0],f.manifest.materials[0],f.manifest.materials[2]]});
  await assert.rejects(()=>loadCourseAssets(f.root),/duplicate/);
  await json(file,{...f.manifest,materials:f.manifest.materials.slice(1)});await assert.rejects(()=>loadCourseAssets(f.root),/complete catalog/);
  const bad=structuredClone(f.catalog);bad.resources[1]={...bad.resources[0]};
  assert.throws(()=>validateCourseCatalog(bad),/duplicate/);
});

test('course loading rejects changed content even if its byte length is unchanged',async t=>{
  const f=await stagedFixture(t),m=f.manifest.materials[0],file=path.join(f.root,'outputs/course-assets',m.original.file);
  await fs.writeFile(file,Buffer.alloc(m.original.bytes,1));
  await assert.rejects(()=>loadCourseAssets(f.root),/checksum/);
});

test('course loading rejects noncanonical paths and resolved paths outside the asset root',async t=>{
  const f=await stagedFixture(t,['png']),file=path.join(f.root,'content/material-previews.json');
  const bad=structuredClone(f.manifest);bad.materials[0].original.file='../outside.png';
  await json(file,bad);await assert.rejects(()=>loadCourseAssets(f.root),/asset path/);
  await json(file,f.manifest);
  const coursePath=path.join(f.root,'outputs/course-assets/CMT322W'),outside=path.join(f.root,'outside-course');
  await fs.rename(coursePath,outside);await fs.symlink(outside,coursePath,'junction');
  await assert.rejects(()=>loadCourseAssets(f.root),/outside the course asset/);
});

test('materialsOnly input omits account data and cannot silently become a bootstrap run',()=>{
  const input={baseUrl:'https://example.test',token:'t'.repeat(64),materialsOnly:true};
  const parsed=parseProvisionInput(input);assert.equal(parsed.materialsOnly,true);assert.deepEqual(parsed.users,[]);
  assert.throws(()=>parseProvisionInput({...input,users:[]}),/omit account seeds/);
  assert.throws(()=>parseProvisionInput({...input,materialsOnly:'true'}),/Invalid materialsOnly/);
  assert.throws(()=>parseProvisionInput({...input,materialsOnly:false}),/Both configured/);
});

test('materials-only sync never writes accounts and skips only matching size plus checksum',async t=>{
  const f=await stagedFixture(t,['png']),assets=await loadCourseAssets(f.root);
  const config=parseProvisionInput({baseUrl:'https://example.test',token:'t'.repeat(64),materialsOnly:true});
  let uploads=0;const saved=new Map();
  const client={
    status:async()=>({partSize:16*1024*1024,objects:[...saved.values()]}),
    users:async()=>assert.fail('materials-only sync must never write accounts'),
    object:async(asset,bytes)=>{uploads++;assert.equal(hash(bytes),asset.sha256);const item={key:asset.key,present:true,bytes:asset.bytes,sha256:asset.sha256};saved.set(asset.key,item);return {...item,ok:true};}
  };
  const first=await provisionCourseAssets(config,assets,{client,log:quiet});
  assert.equal(first.uploaded,1);assert.deepEqual(first.accounts,[]);assert.equal(first.mode,'materials-only');
  const second=await provisionCourseAssets(config,assets,{client,log:quiet});
  assert.equal(second.skipped,1);assert.equal(uploads,1);
  const changed=Buffer.alloc(assets[0].bytes,9);await fs.writeFile(assets[0].file,changed);
  const revised={...assets[0],sha256:hash(changed)};
  assert.equal(statusMatches(await client.status(),revised),false);
  const third=await provisionCourseAssets(config,[revised],{client,log:quiet});
  assert.equal(third.uploaded,1);assert.equal(uploads,2);
});
