import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {emptyState} from "../lib/study.ts";
import {stateSchema} from "../lib/validation.ts";
import {questionHash,currentAnswer,recordAnswer} from "../lib/quiz.ts";
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),"utf8"));
const catalog=read("../content/catalog.json"),manifest=read("../content/material-previews.json");
const courses=catalog.courses.map(c=>read("../content/knowledge/"+c.code+".json"));
const materials=courses.flatMap(c=>c.materials);
test("knowledge provenance matches the current original-file digest",()=>{for(const m of materials){assert.match(m.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(m.sourceSha256,manifest.materials.find(s=>s.id===m.resourceId)?.sha256,m.resourceId+" knowledge must be reviewed when the source changes");}});
const bi=(v,label)=>{assert.equal(typeof v?.zh,"string",label+" Chinese");assert.equal(typeof v?.en,"string",label+" English");assert.ok(v.zh.trim()&&v.en.trim(),label+" bilingual text");};
test("shared knowledge covers every catalog resource in the correct course",()=>{
 assert.equal(new Set(materials.map(m=>m.resourceId)).size,catalog.resources.length);
 assert.deepEqual(materials.map(m=>m.resourceId).sort(),catalog.resources.map(r=>r.id).sort());
 for(const c of courses){bi(c.overview,c.courseId);assert.ok(c.pathway.length);for(const p of c.pathway){assert.equal(catalog.resources.find(r=>r.id===p.resourceId)?.courseId,c.courseId);bi(p.reason,p.resourceId+" path");}for(const m of c.materials)assert.equal(catalog.resources.find(r=>r.id===m.resourceId)?.courseId,c.courseId);}
});
test("concepts, questions, links and bilingual text are structurally complete",()=>{
 const ids=new Set();
 const unique=id=>{assert.ok(id&&!ids.has(id),"globally unique id "+id);ids.add(id);};
 for(const m of materials){
  bi(m.overview,m.resourceId);if(m.sourceNote)bi(m.sourceNote,m.resourceId+" source");
  const concepts=m.groups.flatMap(g=>g.concepts),conceptIds=new Set(concepts.map(c=>c.id));
  for(const g of m.groups){unique(g.id);bi(g.title,g.id);}
  for(const c of concepts){unique(c.id);bi(c.title,c.id+" title");bi(c.explanation,c.id+" explanation");if(c.example)bi(c.example,c.id+" example");if(c.confusion)bi(c.confusion,c.id+" distinction");assert.ok(m.questions.some(q=>q.conceptIds.includes(c.id)),c.id+" must have a relevant question");}
  for(const q of m.questions){unique(q.id);bi(q.prompt,q.id);bi(q.explanation,q.id+" explanation");assert.equal(q.options.length,4,q.id);q.options.forEach(o=>bi(o,q.id+" option"));assert.equal(new Set(q.options.map(o=>o.zh.trim().toLowerCase())).size,4,q.id+" distinct options");assert.ok(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<4);assert.ok(q.conceptIds.length,q.id+" references concepts");for(const id of q.conceptIds)assert.ok(conceptIds.has(id),q.id+" "+id);}
  for(const l of m.links){assert.ok(conceptIds.has(l.from)&&conceptIds.has(l.to),m.resourceId+" link endpoints");assert.notEqual(l.from,l.to);bi(l.relation,m.resourceId+" relationship");}
 }
});
test("all page citations are real and every document page has an explicit coverage decision",()=>{
 for(const m of materials){
  const source=manifest.materials.find(r=>r.id===m.resourceId),max=source.pageCount||0;
  const valid=(pages,label)=>{assert.ok(Array.isArray(pages),label);assert.equal(new Set(pages).size,pages.length,label+" unique pages");for(const p of pages)assert.ok(Number.isInteger(p)&&p>=1&&p<=max,label+" page "+p+" / "+max);};
  const concepts=m.groups.flatMap(g=>g.concepts);for(const c of concepts){valid(c.pages,c.id);if(max)assert.ok(c.pages.length,c.id+" needs source");}
  for(const q of m.questions){valid(q.pages,q.id);if(max)assert.ok(q.pages.length,q.id+" needs source");}
  valid(m.coverage.coveredPages,m.resourceId+" covered");
  for(const e of m.coverage.excludedPages){valid(e.pages,m.resourceId+" excluded");bi(e.reason,m.resourceId+" exclusion");}
  const covered=new Set(m.coverage.coveredPages),excluded=new Set(m.coverage.excludedPages.flatMap(e=>e.pages));
  for(let p=1;p<=max;p++)assert.ok(covered.has(p)||excluded.has(p),m.resourceId+" unreviewed page "+p);
  for(const p of covered)assert.ok(!excluded.has(p),m.resourceId+" both covered/excluded "+p);
  for(const c of concepts)for(const p of c.pages)assert.ok(covered.has(p),c.id+" cites uncovered page "+p);
  for(const q of m.questions)for(const p of q.pages)assert.ok(covered.has(p),q.id+" cites uncovered page "+p);
  const cited=new Set([...concepts.flatMap(c=>c.pages),...m.questions.flatMap(q=>q.pages)]);
  for(const p of covered)assert.ok(cited.has(p),m.resourceId+" coverage claims an unreferenced page "+p);
  if(!max)assert.ok(m.sourceNote,m.resourceId+" non-paginated source needs explanation");
 }
});
const sample={id:"q1",prompt:{zh:"选择",en:"Choose"},options:[{zh:"甲",en:"A"},{zh:"乙",en:"B"},{zh:"丙",en:"C"},{zh:"丁",en:"D"}],answer:2,explanation:{zh:"丙正确",en:"C is correct"},conceptIds:["c1"],pages:[1]};
test("old workspaces gain empty quiz records without losing notes or progress",()=>{
 const old=emptyState();delete old.quizzes;old.notes.push({id:"legacy",courseId:"AKP202W",resourceId:"material-43",title:"保留",body:"原来的笔记",updatedAt:"2026-10-21T08:00:00Z"});old.progress["material-43"]={status:"learning",updatedAt:"2026-10-21T08:00:00Z"};
 const migrated=stateSchema.parse(old);assert.deepEqual(migrated.quizzes,{});assert.deepEqual(migrated.notes,old.notes);assert.deepEqual(migrated.progress,old.progress);
});
test("quiz attempts persist per question and changed questions invalidate obsolete answers",()=>{
 const first=recordAnswer(sample,1,undefined,new Date("2026-10-21T08:00:00Z"));assert.equal(first.attempts,1);assert.equal(currentAnswer(sample,{q1:first}).choice,1);
 const retry=recordAnswer(sample,2,first);assert.equal(retry.attempts,2);assert.equal(retry.choice,2);
 const changed={...sample,answer:1};assert.notEqual(questionHash(changed),questionHash(sample));assert.equal(currentAnswer(changed,{q1:retry}),undefined);assert.equal(recordAnswer(changed,1,retry).attempts,1);
 assert.throws(()=>recordAnswer(sample,4));assert.throws(()=>recordAnswer(sample,-1));assert.throws(()=>recordAnswer(sample,1.5));
 assert.equal(stateSchema.safeParse({...emptyState(),quizzes:{q1:retry}}).success,true);
 assert.equal(stateSchema.safeParse({...emptyState(),quizzes:{q1:{...retry,choice:4}}}).success,false);
});
