import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNewProvisionUser} from '../lib/provisioning.ts';
import {readFile} from 'node:fs/promises';
import {authorizedProvisionToken,expectedPartBytes,PROVISION_PART_BYTES,provisionAssetIndex,readProvisionBody,readUploadTicket,signUploadTicket,signPartReceipt,validateParts,validateProvisionUsers,validateDigest} from '../lib/provisioning.ts';
const secret='a'.repeat(64),digest='d'.repeat(64);
test('single-account creation accepts only a normalized identity and salted hash',()=>{
  const user={id:'test-learner',displayName:'Test Learner',passwordHash:'$pbkdf2-sha256$100000$'+'b'.repeat(32)+'$'+'c'.repeat(64)};
  assert.deepEqual(validateNewProvisionUser(user),user);
  for(const value of [null,[],{...user,password:'plain'},{...user,passwordHash:'plain'},{...user,id:'../other'},{...user,displayName:' Test Learner'},{...user,displayName:'Test  Learner'},{...user,displayName:'Test\u0000Learner'},{...user,workspace:{}}])assert.throws(()=>validateNewProvisionUser(value));
});

test('provisioning fails closed without a strong secret and rejects wrong bearer tokens',async()=>{
  for(const configured of [undefined,'','short'])assert.equal(await authorizedProvisionToken('Bearer '+secret,configured),false);
  assert.equal(await authorizedProvisionToken('Bearer '+secret,secret),true);
  assert.equal(await authorizedProvisionToken('Bearer '+'b'.repeat(64),secret),false);
  assert.equal(await authorizedProvisionToken(secret,secret),false);
});
test('course whitelist derives all objects from the current manifest and checks original digests',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../content/material-previews.json',import.meta.url),'utf8'));
  const expected=manifest.materials.flatMap(m=>[m.original,...(m.preview?[m.preview]:[])]),index=provisionAssetIndex(manifest);
  assert.equal(index.size,expected.length);assert.deepEqual([...index.keys()].sort(),expected.map(asset=>asset.key).sort());
  assert.equal([...index.values()].reduce((sum,item)=>sum+item.bytes,0),expected.reduce((sum,item)=>sum+item.bytes,0));
  assert.equal(index.has('../notes/private.png'),false);
  const original=[...index.values()].find(item=>item.sha256);
  assert.equal(validateDigest(original,original.sha256),original.sha256);
  assert.throws(()=>validateDigest(original,digest));
});
test('account bootstrap only accepts the two configured identities and salted hashes',()=>{
  const hash='$pbkdf2-sha256$100000$'+'b'.repeat(32)+'$'+'c'.repeat(64);
  const users=[{id:'han-bowen',displayName:'Han Bowen',passwordHash:hash},{id:'cao-chengwei',displayName:'Cao Chengwei',passwordHash:hash}];
  assert.equal(validateProvisionUsers(users).length,2);
  assert.throws(()=>validateProvisionUsers([{...users[0],password:'plaintext'},users[1]]));
  assert.throws(()=>validateProvisionUsers([users[0],users[0]]));
  assert.throws(()=>validateProvisionUsers([{...users[0],id:'admin'},users[1]]));
});
test('upload tickets and part receipts bind upload, size, order and checksum',async()=>{
  const size=PROVISION_PART_BYTES+123,upload={v:1,key:'course-assets/CST435W/material-1/original.mp4',uploadId:'test-upload',sha256:digest,expiresAt:Date.now()+60000};
  const ticket=await signUploadTicket(secret,upload);assert.deepEqual(await readUploadTicket(secret,ticket),upload);
  await assert.rejects(()=>readUploadTicket('b'.repeat(64),ticket));
  await assert.rejects(()=>readUploadTicket(secret,ticket,upload.expiresAt));
  const parts=[];for(let partNumber=1;partNumber<=2;partNumber++){const part={partNumber,etag:'etag-'+partNumber,bytes:expectedPartBytes(size,partNumber)};parts.push({...part,receipt:await signPartReceipt(secret,ticket,part)});}
  assert.equal((await validateParts(secret,ticket,size,[parts[1],parts[0]])).length,2);
  await assert.rejects(()=>validateParts(secret,ticket,size,[parts[0],{...parts[1],etag:'other'}]));
  await assert.rejects(()=>validateParts(secret,ticket,size,[parts[0]]));
  await assert.rejects(()=>validateParts(secret,ticket,size,[parts[0],parts[0]]));
  assert.throws(()=>expectedPartBytes(size,3));
});
test('stream limits reject oversized and incomplete upload bodies',async()=>{
  assert.equal((await readProvisionBody(new Request('https://example.test',{method:'PUT',body:new Uint8Array(8)}),8,8)).length,8);
  await assert.rejects(()=>readProvisionBody(new Request('https://example.test',{method:'PUT',body:new Uint8Array(9)}),8,8));
  await assert.rejects(()=>readProvisionBody(new Request('https://example.test',{method:'PUT',body:new Uint8Array(7)}),8,8));
});
