import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {emptyState} from "../lib/study.ts";
import {questionHash} from "../lib/quiz.ts";
const base=process.env.STUDY_TEST_URL||"http://127.0.0.1:5173";
if(new URL(base).origin!==base)throw Error("Expected site origin");
console.log("Ready for knowledge test JSON on stdin (input hidden).");
const accounts=await new Promise((resolve,reject)=>{let value="";const raw=process.stdin.isTTY;if(raw)process.stdin.setRawMode(true);const receive=chunk=>{value+=chunk.toString();if(value.includes("\n")||value.includes("\r")){process.stdin.off("data",receive);if(raw)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(value.trim()));}catch{reject(Error("Invalid input"));}}};process.stdin.on("data",receive);process.stdin.resume();});
const send=(route,init={})=>fetch(base+route,{redirect:"manual",...init});
const sessions=[];
const headers=(session)=>({"Content-Type":"application/json",Origin:base,...(session?{Cookie:session.cookie,"X-Study-User":session.user.userId}:{})});
for(const account of accounts){const res=await send("/api/auth/login",{method:"POST",headers:headers(),body:JSON.stringify(account)});assert.equal(res.status,200);const cookie=res.headers.get("set-cookie").split(";")[0];sessions.push({cookie,user:(await res.json()).user});}
const read=s=>send("/api/workspace",{headers:headers(s)}).then(r=>r.json());
const [han,cao]=sessions,hs=await read(han),cs=await read(cao);
const original=hs.data||emptyState(),caoOriginal=cs.data;
const course=JSON.parse(await fs.readFile("content/knowledge/AKP202W.json","utf8"));
const q=course.materials.flatMap(m=>m.questions)[0];
const testData={...original,quizzes:{...(original.quizzes||{}),[q.id]:{choice:q.answer,attempts:1,questionHash:questionHash(q),updatedAt:new Date().toISOString()}}};
let writtenRevision;
try{
 const write=await send("/api/workspace",{method:"PUT",headers:headers(han),body:JSON.stringify({revision:hs.revision,data:testData})});assert.equal(write.status,200);writtenRevision=(await write.json()).revision;
 const saved=await read(han);assert.deepEqual(saved.data.quizzes[q.id],testData.quizzes[q.id]);assert.deepEqual(saved.data.notes,original.notes);assert.deepEqual(saved.data.progress,original.progress);
 assert.deepEqual((await read(cao)).data,caoOriginal);
 assert.equal((await send("/api/workspace",{method:"PUT",headers:{...headers(cao),"X-Study-User":han.user.userId},body:JSON.stringify({revision:cs.revision,data:testData})})).status,409);
 for(const s of sessions){const response=await send("/",{headers:headers(s)});assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes("知识与练习"));assert.ok(html.includes("双语知识"));}
}finally{
 if(writtenRevision!==undefined){const restore=await send("/api/workspace",{method:"PUT",headers:headers(han),body:JSON.stringify({revision:writtenRevision,data:original})});assert.equal(restore.status,200,"Restore must preserve concurrent updates");}
 for(const s of sessions)assert.equal((await send("/api/auth/logout",{method:"POST",headers:headers(s)})).status,200);
}
const report={passed:true,accounts:sessions.map(s=>s.user.displayName),checks:["both authenticated accounts receive shared knowledge UI","quiz record persists","notes and progress preserved","other account quiz workspace unchanged","stale-account write denied","test record restored"],completedAt:new Date().toISOString()};
await fs.writeFile(process.env.STUDY_TEST_URL?"outputs/production-knowledge-integration.json":"outputs/knowledge-integration.json",JSON.stringify(report,null,2));
console.log("PASS: shared knowledge for both accounts; quiz records isolated, existing notes preserved, test record restored.");
