import type {Question} from "./knowledge";
import type {QuizAnswer} from "./study";
// Invalidate only a changed question, preserving other saved attempts after content updates.
export function questionHash(q:Pick<Question,"prompt"|"options"|"answer"|"explanation">):string{
 const value=JSON.stringify([q.prompt,q.options,q.answer,q.explanation]);let hash=2166136261;
 for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return (hash>>>0).toString(16);
}
export function currentAnswer(q:Question,answers:Record<string,QuizAnswer>):QuizAnswer|undefined{
 const a=answers[q.id];return a?.questionHash===questionHash(q)&&a.choice>=0&&a.choice<q.options.length?a:undefined;
}
export function recordAnswer(q:Question,choice:number,previous?:QuizAnswer,now=new Date()):QuizAnswer{
 if(!Number.isInteger(choice)||choice<0||choice>=q.options.length)throw Error("请选择有效选项");
 return {choice,attempts:previous?.questionHash===questionHash(q)?previous.attempts+1:1,questionHash:questionHash(q),updatedAt:now.toISOString()};
}
