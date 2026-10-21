export type Review = { dueAt: string; interval: number; repetitions: number; ease: number; lapses: number; lastReview: string; grade: number };
export type Note = { id: string; courseId: string; resourceId: string; title: string; body: string; updatedAt: string };
export type Card = { id: string; courseId: string; question: string; answer: string; source?: {file:string;page:number;label:string}; tags?: string[] };
export type Task = {id:string;courseId:string;title:string;dueAt:string;done:boolean;source?:string};
export type StudyState = {
  version:1;
  progress:Record<string,{status:"learning"|"done";updatedAt:string}>;
  notes:Note[]; cards:Card[]; reviews:Record<string,Review>; tasks:Task[];
  sessions:{id:string;courseId:string;minutes:number;endedAt:string}[];
  settings:{dailyMinutes:number};
};
export const DAY=86400000;
// Explicit SM-2-style intervals; a lapse returns in 10 minutes.
export function scheduleReview(previous:Review|undefined, grade:1|3|4|5, now=new Date()):Review {
  let ease=previous?.ease??2.5, reps=previous?.repetitions??0, interval=previous?.interval??0;
  let lapses=previous?.lapses??0;
  if(grade===1){reps=0;interval=0;lapses++;ease=Math.max(1.3,ease-0.2);}
  else {interval=reps===0?(grade===3?1:grade===5?3:1):reps===1?(grade===3?3:grade===5?7:4):Math.max(1,Math.round(interval*(grade===3?1.2:grade===5?ease*1.3:ease)));reps++;ease=Math.max(1.3,ease+(grade===5?0.15:grade===3?-0.15:0));}
  return {dueAt:new Date(now.getTime()+(grade===1?600000:interval*DAY)).toISOString(),interval,repetitions:reps,ease,lapses,lastReview:now.toISOString(),grade};
}
export function isDue(review:Review|undefined, now=Date.now()){return !review||Date.parse(review.dueAt)<=now;}
export function emptyState():StudyState{return {version:1,progress:{},notes:[],cards:[],reviews:{},tasks:[
  {id:"cpc-assignment-1",courseId:"CPC357W",title:"Assignment 1 · 物联网作业",dueAt:"2026-11-13T23:59:00+08:00",done:false,source:"https://elearning.usm.my/sidang2627/mod/assign/view.php?id=48524"},
  {id:"cpc-project",courseId:"CPC357W",title:"IoT Project · 项目提交（上午截止）",dueAt:"2027-01-03T11:59:00+08:00",done:false,source:"https://elearning.usm.my/sidang2627/mod/assign/view.php?id=44026"},
  {id:"cmt-test-1",courseId:"CMT322W",title:"Test 1 · 09:00–10:00 · Exam Hall 1",dueAt:"2026-11-02T09:00:00+08:00",done:false,source:"https://elearning.usm.my/sidang2627/mod/forum/discuss.php?d=3022"},
  {id:"cmt-test-2",courseId:"CMT322W",title:"Test 2 · 09:00–10:00 · Room 411",dueAt:"2026-12-14T09:00:00+08:00",done:false,source:"https://elearning.usm.my/sidang2627/mod/forum/discuss.php?d=3023"}
],sessions:[],settings:{dailyMinutes:50}};}
export function dueLabel(date:string, now=Date.now()){const days=Math.ceil((Date.parse(date)-now)/DAY);return days<0?`已过 ${-days} 天`:days===0?"今天截止":`${days} 天后`;}
