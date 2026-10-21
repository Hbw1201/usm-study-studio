"use client";
import {useEffect,useState} from "react";
import {Download,ExternalLink,FileArchive,FileText,Loader2,Upload} from "lucide-react";
import catalog from "../content/catalog.json";
import {PdfViewer} from "./pdf-viewer";
import {readFile} from "../lib/local-files";
type Resource=typeof catalog.resources[number];
export function MaterialReader({resource,userKey,onAttach}:{resource:Resource;userKey:string;onAttach:()=>void}){
 const [available,setAvailable]=useState<boolean|null>(null),[local,setLocal]=useState(""),[reload,setReload]=useState(0);
 const api="/api/materials/"+resource.id;
 const isSlides=["ppt","pptx"].includes(resource.ext);
 const isDocument=["pdf","doc","docx","ppt","pptx"].includes(resource.ext);
 const preview=isDocument&&resource.ext!=="pdf"?api+"?preview=1":api;
 useEffect(()=>{let cancelled=false,url="";setAvailable(null);setLocal("");
  void fetch(preview,{method:"HEAD"}).then(r=>{if(!cancelled)setAvailable(r.ok);return r.ok;}).catch(()=>{if(!cancelled)setAvailable(false);return false;}).then(async ok=>{if(ok||cancelled||!["pdf","mp4","png","jpg","jpeg","webp"].includes(resource.ext))return;const f=await readFile(userKey+":"+resource.id).catch(()=>null);if(f&&!cancelled){url=URL.createObjectURL(f);setLocal(url);}});
  return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};
 },[preview,resource.id,resource.ext,userKey,reload]);
 const src=local||preview;
 return <section className="reader material-reader"><header><span><FileText size={17}/>{resource.fileName}</span><div><a href={api+"?download=1"} title="下载原文件"><Download size={17}/></a><a href={resource.url} target="_blank" rel="noreferrer" title="打开 USM 原资源"><ExternalLink size={17}/></a></div></header>
  {available===null?<div className="pdf-placeholder"><Loader2 className="spin" size={26}/>正在准备课件…</div>:available||local?isDocument?<PdfViewer source={src} mode={isSlides?"slides":"scroll"} label={resource.title}/>:resource.ext==="mp4"?<div className="course-video"><video controls preload="metadata" src={src}/></div>:["jpg","jpeg","png","webp"].includes(resource.ext)?<div className="course-image"><img src={src} alt={resource.title}/></div>:<div className="empty"><span><FileArchive size={32}/></span><h3>课程练习压缩包</h3><p>下载后解压，即可使用其中的项目文件。</p><a className="primary" href={api+"?download=1"}><Download size={16}/>下载 {resource.fileName}</a></div>:<div className="empty"><span><FileText size={30}/></span><h3>这份课件暂时无法打开</h3><p>资料可能尚在准备，稍后重试即可。<br/>也可以下载原文件在电脑上查看。</p><div className="material-fallback"><button className="primary" onClick={()=>setReload(n=>n+1)}>重新载入</button><a className="secondary" href={api+"?download=1"}><Download size={16}/>下载原文件</a><button className="text-button" onClick={onAttach}><Upload size={15}/>关联本地文件</button></div></div>}
  <footer className="material-footer"><span>{resource.courseId} · {isSlides?"原版幻灯片":isDocument?"文档阅读":"课程资料"}</span><a href={api+"?download=1"}>下载原文件<Download size={14}/></a></footer>
 </section>;
}
