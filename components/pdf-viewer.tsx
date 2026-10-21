"use client";
import {useEffect,useRef,useState} from "react";
import {ChevronLeft,ChevronRight,Loader2,AlertCircle} from "lucide-react";
const workerURL="/vendor/pdf.worker.min.mjs";
import type {PDFDocumentProxy} from "pdfjs-dist";
export function PdfViewer({source,mode="scroll",label="PDF 文档",pageRequest}:{source:string|Blob;mode?:"scroll"|"slides";label?:string;pageRequest?:{page:number;nonce:number}}){
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[error,setError]=useState(""),[page,setPage]=useState(1),[jumpNonce,setJumpNonce]=useState(0);
 const scroll=useRef<HTMLDivElement>(null),restoreScroll=useRef(0),jumpRequested=useRef(false);
 useEffect(()=>{restoreScroll.current=scroll.current?.scrollTop||0;jumpRequested.current=false;let cancelled=false;let task:ReturnType<typeof import("pdfjs-dist")["getDocument"]>|undefined;setError("");setPdf(null);setPage(1);
  void(async()=>{try{const lib=await import("pdfjs-dist");lib.GlobalWorkerOptions.workerSrc=workerURL;if(cancelled)return;task=lib.getDocument(typeof source==="string"?{url:source,withCredentials:true}:{data:new Uint8Array(await source.arrayBuffer())});const doc=await task.promise;if(cancelled){void doc.destroy();return;}setPdf(doc);}catch(e){if(!cancelled)setError(e instanceof Error?e.message:"无法打开 PDF");}})();
  return()=>{cancelled=true;void task?.destroy();};
 },[source]);
 useEffect(()=>{if(pdf&&scroll.current&&mode==="scroll")scroll.current.scrollTop=restoreScroll.current;},[pdf,mode]);
 useEffect(()=>{if(pdf&&pageRequest)setPage(Math.max(1,Math.min(pdf.numPages,pageRequest.page)));},[pdf,pageRequest]);
 useEffect(()=>{if(!pdf||mode!=="scroll"||(!pageRequest&&!jumpRequested.current))return;const frame=requestAnimationFrame(()=>{const host=scroll.current,el=host?.querySelector<HTMLElement>('[data-pdf-page="'+page+'"]');if(host&&el)host.scrollTop+=el.getBoundingClientRect().top-host.getBoundingClientRect().top;});return()=>cancelAnimationFrame(frame);},[pdf,page,mode,pageRequest,jumpNonce]);
 const change=(n:number)=>{if(Number.isFinite(n)){jumpRequested.current=true;setPage(Math.max(1,Math.min(pdf?.numPages||1,Math.floor(n))));setJumpNonce(nonce=>nonce+1);}};
 return <div className={"pdf-viewer "+mode} aria-label={label}>
  <div className="pdf-viewer-tools"><span>{mode==="slides"?"幻灯片 · 逐页阅读":"PDF · 连续阅读"}</span>{pdf&&<><b>{pdf.numPages} 页</b>{mode==="scroll"&&<label className="pdf-page-jump">跳转第 <input aria-label="PDF 跳转页码" type="number" min={1} max={pdf.numPages} value={page} onChange={e=>{if(e.target.value)change(Number(e.target.value));}} onKeyDown={e=>{if(e.key==="Enter"&&e.currentTarget.value){e.preventDefault();change(Number(e.currentTarget.value));}}}/> 页</label>}</>}</div>
  <div className="pdf-scroll" ref={scroll} tabIndex={0} onKeyDown={e=>{if(mode!=="slides"||(e.target as HTMLElement).tagName==="INPUT")return;if(e.key==="ArrowRight"){e.preventDefault();change(page+1);}if(e.key==="ArrowLeft"){e.preventDefault();change(page-1);}}}>
   {error?<div className="pdf-placeholder" role="alert"><AlertCircle size={27}/><strong>文档暂时无法预览</strong><p>{error}</p></div>:!pdf?<div className="pdf-placeholder"><Loader2 className="spin" size={26}/><span>正在打开文档…</span></div>:mode==="slides"?<PdfPage key={page} pdf={pdf} number={page} eager/>:Array.from({length:pdf.numPages},(_,i)=><PdfPage key={i} pdf={pdf} number={i+1} eager={i===0}/>)}
  </div>
  {mode==="slides"&&pdf&&<div className="slide-controls"><button className="secondary" disabled={page===1} onClick={()=>change(page-1)} aria-label="上一张幻灯片"><ChevronLeft size={17}/>上一页</button><label>第 <input aria-label="幻灯片页码" type="number" min={1} max={pdf.numPages} value={page} onChange={e=>{if(e.target.value)change(Number(e.target.value));}}/> / {pdf.numPages} 页</label><button className="secondary" disabled={page===pdf.numPages} onClick={()=>change(page+1)} aria-label="下一张幻灯片">下一页<ChevronRight size={17}/></button></div>}
 </div>;
}
function PdfPage({pdf,number,eager}:{pdf:PDFDocumentProxy;number:number;eager:boolean}){
 const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 const [visible,setVisible]=useState(eager),[width,setWidth]=useState(0),[ratio,setRatio]=useState(1.414),[error,setError]=useState("");
 useEffect(()=>{const el=host.current;if(!el)return;const observer=new ResizeObserver(entries=>setWidth(Math.floor(entries[0].contentRect.width)));observer.observe(el);const visibility=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);visibility.disconnect();}},{rootMargin:"450px"});visibility.observe(el);return()=>{observer.disconnect();visibility.disconnect();};},[]);
 useEffect(()=>{if(!visible||!width)return;let cancelled=false;let task:ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>|undefined;
  void pdf.getPage(number).then(p=>{if(cancelled||!canvas.current)return;const base=p.getViewport({scale:1});setRatio(base.height/base.width);const scale=width/base.width;const viewport=p.getViewport({scale:scale*Math.min(window.devicePixelRatio||1,2)});const el=canvas.current;el.width=Math.ceil(viewport.width);el.height=Math.ceil(viewport.height);task=p.render({canvas:el,canvasContext:el.getContext("2d")!,viewport});return task.promise;}).catch(e=>{if(!cancelled&&e?.name!=="RenderingCancelledException")setError("这一页暂时无法显示。");});return()=>{cancelled=true;task?.cancel();};
 },[pdf,number,width,visible]);
 return <div className="pdf-page-wrap" data-pdf-page={number}><div className="pdf-page" ref={host} style={{aspectRatio:"1 / "+ratio}}>{error?<p role="alert">{error}</p>:<canvas ref={canvas} aria-label={"文档第 "+number+" 页"}/>}</div><span className="pdf-page-number">{number}</span></div>;
}
