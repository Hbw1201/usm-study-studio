import {ArrowUpRight,CalendarDays,BookOpen} from "lucide-react";
import updates from "../content/course-updates.json";
import catalog from "../content/catalog.json";
export function CourseUpdates({courseId,onOpen,compact=false}:{courseId?:string|null;onOpen:(id:string)=>void;compact?:boolean}){
 const materials=catalog.resources.filter(r=>updates.newResourceIds.includes(r.id)&&(!courseId||r.courseId===courseId));
 const notices=updates.notices.filter(n=>!courseId||n.courseId===courseId);
 if(!materials.length&&!notices.length)return null;
 return <section className="course-updates" aria-label="学校课程更新">
  <div className="updates-heading"><div><span className="eyebrow">COURSE UPDATES</span><h2>学校课程更新</h2></div><small>{updates.checkedAt} 核对 · UTC+8</small></div>
  {materials.length>0&&<div className="new-materials">{materials.map(r=><button key={r.id} onClick={()=>onOpen(r.id)}><BookOpen size={17}/><span><small>{r.courseId} · 新增{r.category}</small><b>{r.title}</b></span><ArrowUpRight size={16}/></button>)}</div>}
  <details className="school-notices" open={!compact}><summary><CalendarDays size={16}/> 课程通知与重要日期 <span>{notices.length}</span></summary><div className="school-notice-list">{notices.map(n=><article key={n.id}><div><small>{n.courseId}</small><h3>{n.title}</h3>{n.dueAt&&<time dateTime={n.dueAt}>{new Date(n.dueAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false})}</time>}</div><p>{n.details}</p><a href={n.source} target="_blank" rel="noreferrer">查看学校原通知<ArrowUpRight size={14}/></a></article>)}</div></details>
 </section>;
}
