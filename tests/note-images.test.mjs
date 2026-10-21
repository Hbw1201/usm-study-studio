import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectNoteImage,readBoundedUpload,noteImageObjectKey,MAX_NOTE_IMAGE_BYTES} from '../lib/note-images.ts';

function png(width=1,height=1){
  const bytes=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNXsAAAAASUVORK5CYII=','base64'));
  const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);return bytes;
}
test('identifies real PNG and GIF dimensions from bytes, not filename or MIME',()=>{
  assert.deepEqual(inspectNoteImage(png()),{mime:'image/png',extension:'png',width:1,height:1});
  const gif=new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==','base64'));
  assert.equal(inspectNoteImage(gif).width,1);assert.equal(inspectNoteImage(gif).mime,'image/gif');
});
test('detects baseline JPEG frame dimensions past metadata',()=>{
  const jpeg=new Uint8Array([255,216,255,224,0,4,0,0,255,192,0,11,8,0,30,0,40,1,1,0,0,255,217]);
  assert.deepEqual(inspectNoteImage(jpeg),{mime:'image/jpeg',extension:'jpg',width:40,height:30});
});
test('detects WebP extended dimensions',()=>{
  const webp=new Uint8Array(30);webp.set(Buffer.from('RIFF'));webp.set(Buffer.from('WEBPVP8X'),8);
  const view=new DataView(webp.buffer);view.setUint32(4,22,true);view.setUint32(16,10,true);webp[24]=63;webp[27]=31;
  assert.deepEqual(inspectNoteImage(webp),{mime:'image/webp',extension:'webp',width:64,height:32});
});
test('rejects active content, truncated images, excessive dimensions and bytes',()=>{
  for(const text of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>','<html>fake image</html>','\x89PNG']){
    assert.throws(()=>inspectNoteImage(new TextEncoder().encode(text)));
  }
  assert.throws(()=>inspectNoteImage(png(0,1)));assert.throws(()=>inspectNoteImage(png(16001,1)));
  assert.throws(()=>inspectNoteImage(png(8000,8000)));assert.throws(()=>inspectNoteImage(new Uint8Array(MAX_NOTE_IMAGE_BYTES+1)));
});
test('request stream is cancelled as soon as its limit is exceeded',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8));controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
  await assert.rejects(readBoundedUpload(stream,10),e=>e.status===413);assert.equal(cancelled,true);
  const valid=new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3]));controller.close();}});
  assert.deepEqual([...await readBoundedUpload(valid,3)],[1,2,3]);
});
test('storage keys are isolated by authenticated user and reject arbitrary paths',async()=>{
  const id='fa013cc5-f552-4d8f-8920-801344800fd5';
  const alice=await noteImageObjectKey('alice',id),bob=await noteImageObjectKey('bob',id);
  assert.notEqual(alice,bob);assert.match(alice,new RegExp('^note-images/[a-f0-9]{64}/'+id+'$'));
  await assert.rejects(noteImageObjectKey('alice','../bob/secret'));
});
