import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMaterialRange,materialDisposition,materialKey} from '../lib/material-files.ts';

test('video and PDF byte ranges cover fixed, open, suffix and clipped requests',()=>{
  assert.deepEqual(parseMaterialRange('bytes=10-19',100),{offset:10,length:10,end:19});
  assert.deepEqual(parseMaterialRange('bytes=10-',100),{offset:10,length:90,end:99});
  assert.deepEqual(parseMaterialRange('bytes=-10',100),{offset:90,length:10,end:99});
  assert.deepEqual(parseMaterialRange('bytes=95-200',100),{offset:95,length:5,end:99});
  assert.deepEqual(parseMaterialRange('bytes=-200',100),{offset:0,length:100,end:99});
});
test('invalid, unsatisfiable and multiple byte ranges are rejected',()=>{
  for(const range of ['bytes=100-','bytes=20-10','bytes=-0','bytes=-','bytes=1-2,4-8','bytes=9007199254740993-','items=0-1'])assert.equal(parseMaterialRange(range,100),null,range);
  assert.equal(parseMaterialRange('bytes=0-',0),null);
});
test('Unicode download filenames are encoded instead of written as raw header characters',()=>{
  const disposition=materialDisposition('课件 (1).pdf','material-0.pdf',true);
  assert.ok(disposition.startsWith('attachment; filename="material-0.pdf";'));
  assert.ok(disposition.includes("filename*=UTF-8''%E8%AF%BE%E4%BB%B6%20%281%29.pdf"));
  assert.ok(!materialDisposition('bad\r\nheader.pdf','material-0.pdf',false).includes('\r'));
});
test('preview routes use original PDFs and converted Office PDFs with stable keys',()=>{
  const resource={courseId:'CMT322W',id:'material-24',ext:'pptx'};
  assert.equal(materialKey(resource,false),'course-assets/CMT322W/material-24/original.pptx');
  assert.equal(materialKey(resource,true),'course-assets/CMT322W/material-24/preview.pdf');
  assert.equal(materialKey({...resource,ext:'pdf'},true),'course-assets/CMT322W/material-24/original.pdf');
});
