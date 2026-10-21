import {z} from "zod";
const id=z.string().min(1).max(160).refine(v=>!['__proto__','prototype','constructor'].includes(v));
const date=z.string().datetime({offset:true});
const course=z.enum(['AKP202W','CAT402W','CAT405W','CMT322W','CPC357W','CST435W']);
const record=<T extends z.ZodTypeAny>(schema:T)=>z.record(id,schema).refine(v=>Object.keys(v).length<=5000);
export const stateSchema=z.object({
  version:z.literal(1),
  progress:record(z.object({status:z.enum(['learning','done']),updatedAt:date})),
  quizzes:record(z.object({choice:z.number().int().min(0).max(3),attempts:z.number().int().min(1).max(100000),questionHash:z.string().regex(/^[a-f0-9]{1,8}$/),updatedAt:date})).default({}),
  notes:z.array(z.object({id,courseId:course,resourceId:z.string().max(160),title:z.string().min(1).max(200),body:z.string().max(50000),updatedAt:date})).max(1000),
  cards:z.array(z.object({id,courseId:course,question:z.string().min(1).max(2000),answer:z.string().min(1).max(10000),source:z.object({file:z.string().max(500),page:z.number().int().positive(),label:z.string().max(500)}).optional(),tags:z.array(z.string().max(100)).max(20).optional()})).max(2000),
  reviews:record(z.object({dueAt:date,interval:z.number().min(0).max(100000),repetitions:z.number().int().min(0),ease:z.number().min(1.3).max(100),lapses:z.number().int().min(0),lastReview:date,grade:z.number().min(1).max(5)})),
  tasks:z.array(z.object({id,courseId:course,title:z.string().min(1).max(300),dueAt:date,done:z.boolean(),source:z.string().url().refine(v=>v.startsWith('https://')).optional()})).max(1000),
  sessions:z.array(z.object({id,courseId:course,minutes:z.number().min(1).max(480),endedAt:date})).max(5000),
  settings:z.object({dailyMinutes:z.number().int().min(5).max(480)})
}).strict();
export const writeSchema=z.object({revision:z.number().int().min(0),data:stateSchema}).strict();
