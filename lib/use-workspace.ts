"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {emptyState,type StudyState} from "./study";
import {stateSchema} from "./validation";
export function useWorkspace(userKey:string){
  const [data,setData]=useState<StudyState>(emptyState);
  const [status,setStatus]=useState('loading'),[error,setError]=useState('');
  const revision=useRef(0), current=useRef(data),ready=useRef(false),dirty=useRef(false),saving=useRef(false),blocked=useRef(false),accountChanged=useRef(false),leaving=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const backupKey='zhixi-pending:'+userKey;
  const persistBackup=useCallback((value:StudyState)=>{try{localStorage.setItem(backupKey,JSON.stringify({revision:revision.current,data:value}));return true;}catch{setError('本机缓存空间不足，请及时导出学习记录。');return false;}},[backupKey]);
  const flush=useCallback(async()=>{
    if(!ready.current||saving.current||blocked.current||leaving.current||!dirty.current)return;
    saving.current=true;dirty.current=false;const snapshot=current.current;setStatus('saving');
    try{const r=await fetch('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Study-User':userKey},body:JSON.stringify({revision:revision.current,data:snapshot})});const result=await r.json() as {revision:number;data:unknown;error?:string;code?:string};if(!r.ok){if(r.status===401||result.code==='ACCOUNT_CHANGED'){accountChanged.current=true;blocked.current=true;}if(r.status===409)blocked.current=true;throw new Error(result.error||'保存失败');}revision.current=result.revision;setError('');if(!dirty.current){localStorage.removeItem(backupKey);setStatus('saved');}else persistBackup(current.current);}
    catch(e){dirty.current=true;setStatus(accountChanged.current?'account-changed':blocked.current?'conflict':'error');setError(e instanceof Error?e.message:'暂时无法保存');}
    finally{saving.current=false;if(dirty.current&&!blocked.current&&!leaving.current)timer.current=setTimeout(()=>void flush(),4000);}
  },[backupKey,persistBackup,userKey]);
  const load=useCallback(async()=>{
    ready.current=false;setStatus('loading');setError('');
    try{const r=await fetch('/api/workspace',{cache:'no-store',headers:{'X-Study-User':userKey}});if(r.status===401||r.status===409){accountChanged.current=true;blocked.current=true;setError('登录状态已变化，请重新进入当前账号。未同步的记录仍保留在原账号的本机缓存中。');setStatus('account-changed');return;}if(!r.ok)throw new Error('暂时无法读取记录，请重试。');const result=await r.json() as {revision:number;data:unknown;error?:string};const parsed=result.data?stateSchema.parse(result.data):emptyState();revision.current=result.revision;let chosen=parsed;
      const pending=localStorage.getItem(backupKey);if(pending){try{const b=JSON.parse(pending),p=stateSchema.safeParse(b.data);if(p.success){chosen=p.data;dirty.current=true;if(b.revision!==revision.current){blocked.current=true;setError('发现未同步的本机记录，同时另一设备已更新。请导出本机备份后重新载入。');}}}catch{/* unreadable local cache does not replace server data */}}
      current.current=chosen;setData(chosen);ready.current=true;setStatus(blocked.current?'conflict':dirty.current?'saving':'saved');if(dirty.current&&!blocked.current)timer.current=setTimeout(()=>void flush(),100);
    }catch(e){setError(e instanceof Error?e.message:'载入失败');setStatus('error');}
  },[backupKey,flush,userKey]);
  useEffect(()=>{void load();return()=>{if(timer.current)clearTimeout(timer.current);};},[load]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(!leaving.current&&(dirty.current||saving.current)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);const online=()=>void flush();window.addEventListener('online',online);return()=>{window.removeEventListener('beforeunload',warn);window.removeEventListener('online',online);};},[flush]);
  const update=useCallback((fn:(state:StudyState)=>StudyState)=>{
    if(!ready.current)return;const value=fn(current.current);current.current=value;setData(value);dirty.current=true;persistBackup(value);if(!blocked.current)setStatus('saving');clearTimeout(timer.current);timer.current=setTimeout(()=>void flush(),700);
  },[flush,persistBackup]);
  const saveBeforeLeave=useCallback(async()=>{clearTimeout(timer.current);if(!dirty.current&&!saving.current)return true;if(!ready.current||blocked.current)return false;const deadline=Date.now()+10000;while(saving.current&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));if(saving.current)return false;await flush();return !dirty.current&&!saving.current;},[flush]);
  const preserveDraftBeforeLeave=useCallback(()=>!dirty.current&&!saving.current||persistBackup(current.current),[persistBackup]);
  const confirmLeave=useCallback(()=>{leaving.current=true;clearTimeout(timer.current);},[]);
  const reload=()=>{localStorage.removeItem(backupKey);blocked.current=false;dirty.current=false;void load();};
  return {data,update,status,error,retry:()=>ready.current?void flush():void load(),reload,saveBeforeLeave,preserveDraftBeforeLeave,confirmLeave,editable:ready.current&&!blocked.current};
}
