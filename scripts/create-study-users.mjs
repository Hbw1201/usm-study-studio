import "./sites-env.mjs";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Miniflare} from "miniflare";
import {hashPassword,normalizeUsername} from "../lib/account-security.ts";
const root=fileURLToPath(new URL("../",import.meta.url));
console.log("Ready for account JSON on stdin (input hidden).");
const input=await new Promise((resolve,reject)=>{
 let buffer="";
 const raw=process.stdin.isTTY;
 if(raw)process.stdin.setRawMode(true);
 const finish=()=>{process.stdin.off("data",receive);if(raw)process.stdin.setRawMode(false);process.stdin.pause();};
 function receive(chunk){buffer+=chunk.toString("utf8");if(buffer.includes("\u0003")){finish();reject(new Error("Cancelled"));return;}if(buffer.length>32000){finish();reject(new Error("Input too large"));return;}if(buffer.includes("\n")||buffer.includes("\r")){finish();try{resolve(JSON.parse(buffer.trim()));}catch{reject(new Error("Invalid JSON input"));}}}
 process.stdin.on("data",receive);process.stdin.resume();
});
if(!Array.isArray(input)||input.length<1||input.length>20)throw Error("Expected an array of accounts.");
const cfg=JSON.parse(await readFile(path.join(root,"dist/server/wrangler.json"),"utf8"));
const binding=cfg.d1_databases?.find(d=>d.binding==="DB");
if(!binding?.database_id||binding.remote)throw Error("A built local DB binding is required.");
const mf=new Miniflare({modules:true,compatibilityDate:"2026-05-15",host:"127.0.0.1",port:0,inspectorPort:0,cf:false,defaultPersistRoot:path.join(root,".wrangler/state/v3"),d1Databases:{DB:binding.database_id},script:"export default {fetch(){return new Response('local account setup')}}"});
try{
 const db=await mf.getD1Database("DB");
 const legacy=await db.prepare("SELECT user_id,data,revision,updated_at FROM study_workspaces WHERE user_id = ?").bind("local_seedy").first();
 if(legacy){await mkdir(path.join(root,"outputs"),{recursive:true});await writeFile(path.join(root,"outputs/legacy-preview-workspace.json"),JSON.stringify(legacy,null,2));}
 for(const account of input){
  if(!account||typeof account.id!=="string"||!/^[a-z0-9-]{3,80}$/.test(account.id)||typeof account.displayName!=="string"||typeof account.password!=="string"||account.password.length<8||account.password.length>256)throw Error("Invalid account details.");
  const username=normalizeUsername(account.displayName);
  const existing=await db.prepare("SELECT id FROM study_users WHERE id = ? OR username = ?").bind(account.id,username).first();
  if(existing){if(existing.id!==account.id)throw Error("Account name already belongs to another ID.");console.log("Already exists: "+account.displayName);continue;}
  const hash=await hashPassword(account.password);
  await db.prepare("INSERT INTO study_users (id,username,display_name,password_hash,disabled,created_at) VALUES (?,?,?,?,0,?)").bind(account.id,username,account.displayName,hash,Date.now()).run();
  console.log("Created: "+account.displayName);
 }
 console.log("Local account setup complete. Existing course files and workspace records preserved.");
}finally{await mf.dispose();}
