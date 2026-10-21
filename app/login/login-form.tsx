"use client";

import {useState, type FormEvent} from "react";
import {ArrowRight, BookOpen, Check, Eye, EyeOff, Layers3, Loader2, LockKeyhole, NotebookPen, UserRound} from "lucide-react";
import "./login.css";

const courses=["AKP202W","CAT402W","CAT405W","CMT322W","CPC357W","CST435W"];

export default function LoginForm(){
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [visible,setVisible]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/auth/login",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        credentials:"same-origin",
        body:JSON.stringify({username,password}),
      });
      const result=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){
        if(response.status===429)throw new Error("尝试过于频繁，请稍后再试。");
        if(response.status===401)throw new Error("用户名或密码不正确，请检查后重试。");
        throw new Error(result.error||"暂时无法登录，请稍后重试。");
      }
      window.location.assign("/");
    }catch(reason){
      setError(reason instanceof Error?reason.message:"暂时无法连接学习空间，请检查网络后重试。");
      setBusy(false);
    }
  }

  return <main className="signin-page">
    <div className="signin-topline"><a className="signin-brand" href="/login" aria-label="知习学习空间登录"><span><BookOpen size={24}/></span><div><b>知习<span>.</span></b><small>STUDY STUDIO</small></div></a><span className="signin-semester"><i/>2026 / 27 · SEMESTER Ⅰ</span></div>
    <section className="signin-shell" aria-label="登录知习学习空间">
      <div className="signin-story">
        <div className="signin-story-eyebrow">A LITTLE EVERY DAY</div>
        <h1>把今天学到的，<br/>变成明天记得的<span>。</span></h1>
        <p className="signin-story-copy">一起上课，各自成长。<br/>课件、笔记与复习，都有自己的位置。</p>
        <div className="signin-notebook-art" aria-hidden="true">
          <div className="signin-orbit"/>
          <div className="signin-book-back"/>
          <div className="signin-paper">
            <div className="signin-paper-label"><BookOpen size={14}/> MY LEARNING NOTES</div>
            <div className="signin-paper-heading">一点一滴，<br/>学有所获。</div>
            <div className="signin-paper-line"/><div className="signin-paper-line short"/>
            <div className="signin-paper-check"><span><Check size={12}/></span>今天的一个新发现</div>
          </div>
          <div className="signin-memory-tag"><Layers3 size={17}/><span>读懂 · 记录 · 再记住</span></div>
          <span className="signin-art-star">✦</span>
        </div>
        <div className="signin-courses"><span>本学期的六门课程</span><div>{courses.map(code=><b key={code}>{code}</b>)}</div></div>
      </div>

      <div className="signin-form-panel">
        <div className="signin-form-heading"><span className="signin-welcome-icon"><NotebookPen size={25}/></span><div className="signin-eyebrow">WELCOME BACK</div><h2>回到你的学习空间</h2><p>使用已开通的账号登录，接着上次的思路。</p></div>
        <form className="signin-form" onSubmit={submit} aria-busy={busy}>
          <div className="signin-field"><label htmlFor="signin-username">用户名</label><div className="signin-input"><UserRound size={18}/><input id="signin-username" name="username" type="text" required maxLength={100} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} placeholder="输入你的用户名" value={username} onChange={event=>setUsername(event.target.value)} aria-describedby={error?"signin-error":undefined}/></div></div>
          <div className="signin-field"><label htmlFor="signin-password">密码</label><div className="signin-input"><LockKeyhole size={18}/><input id="signin-password" name="password" type={visible?"text":"password"} required maxLength={256} autoComplete="current-password" disabled={busy} placeholder="输入登录密码" value={password} onChange={event=>setPassword(event.target.value)} aria-describedby={error?"signin-error":undefined}/><button type="button" className="signin-reveal" aria-label={visible?"隐藏密码":"显示密码"} aria-pressed={visible} disabled={busy} onClick={()=>setVisible(value=>!value)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></div>
          {error&&<p className="signin-error" id="signin-error" role="alert">{error}</p>}
          <button className="signin-submit" type="submit" disabled={busy}>{busy?<><Loader2 className="spin" size={18}/>正在进入学习空间…</>:<>登录学习空间<ArrowRight size={18}/></>}</button>
        </form>
        <div className="signin-personal-space"><span><LockKeyhole size={15}/></span><p>同一份课程资料，各自的学习记录。<br/><strong>你的笔记、进度与复习安排，随账号保存。</strong></p></div>
        <div className="signin-form-footer"><span>USM · 个人学习工作台</span><span>Learn a little. Remember more.</span></div>
      </div>
    </section>
    <footer className="signin-bottom">知习 · 把知识留在自己身上</footer>
  </main>;
}
