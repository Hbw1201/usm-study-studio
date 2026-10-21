import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {emptyState} from "../lib/study.ts";
const base=process.env.STUDY_TEST_URL||"http://127.0.0.1:5173";
const testOrigin=new URL(base);
if(testOrigin.origin!==base||(testOrigin.protocol!=="https:"&&testOrigin.hostname!=="127.0.0.1"))throw Error("Use an HTTPS origin or localhost for integration checks.");
console.log("Ready for account test JSON on stdin (input hidden).");
const accounts=await new Promise((resolve,reject)=>{let value="";const raw=process.stdin.isTTY;if(raw)process.stdin.setRawMode(true);const receive=chunk=>{value+=chunk.toString();if(value.includes("\n")||value.includes("\r")){process.stdin.off("data",receive);if(raw)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(value.trim()));}catch{reject(Error("Invalid input"));}}};process.stdin.on("data",receive);process.stdin.resume();});
const headers=(cookie,user)=>({"Origin":base,...(cookie?{Cookie:cookie}:{}),...(user?{"X-Study-User":user}:{}),"Content-Type":"application/json"});
const send=(route,init={})=>fetch(base+route,{redirect:"manual",...init});
for(const route of ["/api/workspace","/api/materials/material-2","/api/auth/me"]){assert.equal((await send(route)).status,401);}
assert.equal((await send("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://invalid.test"},body:JSON.stringify(accounts[0])})).status,403);
assert.equal((await send("/api/auth/login",{method:"POST",headers:headers(),body:JSON.stringify({username:accounts[0].username,password:"wrong-password-for-test"})})).status,401);
const sessions=[];
for(const account of accounts){
 const res=await send("/api/auth/login",{method:"POST",headers:headers(),body:JSON.stringify(account)});assert.equal(res.status,200);
 const cookie=res.headers.get("set-cookie");assert.ok(cookie.includes("HttpOnly"));assert.ok(cookie.includes("SameSite=Lax"));
 const user=(await res.json()).user;sessions.push({cookie:cookie.split(";")[0],user});
 const me=await send("/api/auth/me",{headers:headers(cookie.split(";")[0])});assert.equal(me.status,200);assert.equal((await me.json()).user.userId,user.userId);
}
const [han,cao]=sessions;
const snapshotResponse=await send("/api/workspace",{headers:headers(han.cookie,han.user.userId)});
const snapshot=await snapshotResponse.json();
const original=snapshot.data||emptyState();
const testId=crypto.randomUUID(),testState={...original,notes:[...original.notes,{id:testId,courseId:"AKP202W",resourceId:"",title:"Temporary account isolation check",body:"Integration test, removed after verification.",updatedAt:new Date().toISOString()}]};
let revision;
try{
 let r=await send("/api/workspace",{method:"PUT",headers:headers(han.cookie,han.user.userId),body:JSON.stringify({revision:snapshot.revision,data:testState})});assert.equal(r.status,200);revision=(await r.json()).revision;
 const a=await(await send("/api/workspace",{headers:headers(han.cookie,han.user.userId)})).json();assert.ok(a.data.notes.some(n=>n.id===testId));
 const b=await(await send("/api/workspace",{headers:headers(cao.cookie,cao.user.userId)})).json();assert.ok(!b.data?.notes.some(n=>n.id===testId));
 assert.equal((await send("/api/workspace",{method:"PUT",headers:headers(cao.cookie,han.user.userId),body:JSON.stringify({revision:b.revision,data:testState})})).status,409);
 assert.equal((await send("/api/auth/logout",{method:"POST",headers:headers(cao.cookie,han.user.userId)})).status,409);
 assert.equal((await send("/api/auth/me",{headers:headers(cao.cookie)})).status,200);
}finally{
 if(revision!==undefined){const restored=await send("/api/workspace",{method:"PUT",headers:headers(han.cookie,han.user.userId),body:JSON.stringify({revision,data:original})});assert.equal(restored.status,200);}
}
const imageFile=await fs.readFile("outputs/image-upload-example.png"),form=new FormData();form.append("file",new Blob([imageFile],{type:"image/png"}),"account-test.png");
const upload=await send("/api/note-images",{method:"POST",headers:{Origin:base,Cookie:han.cookie,"X-Study-User":han.user.userId},body:form});assert.equal(upload.status,201);
const image=await upload.json();
assert.equal((await send(image.url,{headers:headers(han.cookie)})).status,200);
assert.equal((await send(image.url,{headers:headers(cao.cookie)})).status,404);
const catalog=JSON.parse(await fs.readFile("content/catalog.json","utf8"));
for(const session of sessions){
 for(let start=0;start<catalog.resources.length;start+=6){await Promise.all(catalog.resources.slice(start,start+6).map(async resource=>{
  const r=await send("/api/materials/"+resource.id,{method:"HEAD",headers:headers(session.cookie)});assert.equal(r.status,200,session.user.displayName+" "+resource.id);
 }));}
}
const video=catalog.resources.find(r=>r.ext==="mp4");
const range=await send("/api/materials/"+video.id,{headers:{...headers(han.cookie),Range:"bytes=0-31"}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);
for(const session of sessions){assert.equal((await send("/api/auth/logout",{method:"POST",headers:headers(session.cookie,session.user.userId)})).status,200);assert.equal((await send("/api/auth/me",{headers:headers(session.cookie)})).status,401);}
await fs.writeFile((process.env.STUDY_TEST_URL?"outputs/production-account-integration-report.json":"outputs/account-integration-report.json"),JSON.stringify({passed:true,accounts:sessions.map(s=>s.user.displayName),sharedResources:catalog.resources.length,checks:["anonymous denied","wrong password denied","origin denied","both login","workspace isolation","image isolation","stale tab write denied","stale tab logout denied","both users all materials accessible","video range","logout revoked"],testImage:{id:image.id,owner:han.user.userId},completedAt:new Date().toISOString()},null,2));
console.log("PASS: both accounts, workspace/image isolation, all 48 shared resources, video range, stale tabs, and logout. Test note restored.");
