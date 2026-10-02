import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
import {canonicalJson} from '@interactive-project/protocol/interoperability';
import {prepareRunRequest} from '../execution/index.js';
import {CodeError} from '../index.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function copyEvaluation(input){const r=copyGeneratedJson(input,{maxBytes:2097152,maxDepth:32,maxCollectionSize:1000,maxStringLength:100000,maxNodes:50000});if(!r.valid)throw new CodeError('evaluation.input');return r.value;}
async function digest(request,cryptoProvider){if(typeof cryptoProvider?.subtle?.digest!=='function')throw new CodeError('evaluation.crypto');const bytes=new TextEncoder().encode(canonicalJson({language:request.language,runtime:request.runtime,entrypoint:request.entrypoint,files:request.files}));const hash=await cryptoProvider.subtle.digest('SHA-256',bytes);if(hash.byteLength!==32)throw new CodeError('evaluation.crypto');return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function createSubmission(request,submissionId,cryptoProvider){if(typeof submissionId!=='string'||!uuid.test(submissionId))throw new CodeError('evaluation.submission');const frozen=prepareRunRequest(request);return copyEvaluation({submissionVersion:'1.0.0',submissionId,fileDigest:await digest(frozen,cryptoProvider),request:frozen});}
export async function verifySubmission(input,cryptoProvider){const s=copyEvaluation(input);if(!s||Object.keys(s).sort().join(',')!=='fileDigest,request,submissionId,submissionVersion'||s.submissionVersion!=='1.0.0'||typeof s.submissionId!=='string'||!uuid.test(s.submissionId)||typeof s.fileDigest!=='string'||! /^[0-9a-f]{64}$/.test(s.fileDigest))throw new CodeError('evaluation.submission');const r=prepareRunRequest(s.request);if(await digest(r,cryptoProvider)!==s.fileDigest)throw new CodeError('evaluation.digest');return s;}
export const resultBase=s=>({protocolVersion:'1.0.0',resultVersion:'1.0.0',activityId:s.request.activityId,sessionId:s.request.sessionId,...(s.request.attemptId===undefined?{}:{attemptId:s.request.attemptId}),revision:s.request.revision,evidence:[]});
export function failureReport(s,category='infrastructure-error'){const code=category==='cancelled'?'evaluation.cancelled':category==='timed-out'?'evaluation.timeout':'evaluation.failure';return copyEvaluation({submissionId:s.submissionId,fileDigest:s.fileDigest,category,result:{...resultBase(s),status:'failed',failure:{code,message:'The evaluation could not complete.'}}});}
export function pendingReport(s){return copyEvaluation({submissionId:s.submissionId,fileDigest:s.fileDigest,category:'pending',result:{...resultBase(s),status:'pending',pendingReason:'evaluation'}});}
export function currentSubmission(s,getCurrent){let c;try{c=getCurrent();}catch{return false;}const r=s.request;return !!c&&['activityId','sessionId','attemptId','generation','revision'].every(k=>c[k]===r[k]);}
export function createEvaluationClient({remote,getCurrent,cryptoProvider,validateResult,timeoutMs=30000,maxRecords=16}){
 if(typeof remote!=='function'||typeof getCurrent!=='function'||typeof validateResult!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>64)throw new CodeError('evaluation.options');
 let disposed=false,active=null,ticket=0;const records=new Map(),admissions=new Map();
 function sanitize(s,input){const r=copyEvaluation(input),categories=['completed','assertion-failed','compile-error','runtime-error','infrastructure-error','pending'];
  if(!r||Object.keys(r).sort().join(',')!=='category,fileDigest,result,submissionId'||r.submissionId!==s.submissionId||r.fileDigest!==s.fileDigest||!categories.includes(r.category))throw new CodeError('evaluation.response');
  let valid;try{valid=validateResult(r.result,{activityId:s.request.activityId,sessionId:s.request.sessionId,attemptId:s.request.attemptId});}catch{}
  if(valid?.valid!==true||r.result.revision!==s.request.revision)throw new CodeError('evaluation.response');
  if(r.category==='pending'){if(r.result.status!=='pending')throw new CodeError('evaluation.response');return pendingReport(s);}
  if(r.category==='infrastructure-error'){if(r.result.status!=='failed')throw new CodeError('evaluation.response');return failureReport(s);}
  if(r.result.status!=='completed'||!Number.isFinite(r.result.score)||r.result.score<0||r.result.score>1||r.result.scale!=='normalized'||(['compile-error','runtime-error'].includes(r.category)&&r.result.score!==0))throw new CodeError('evaluation.response');
  return copyEvaluation({submissionId:s.submissionId,fileDigest:s.fileDigest,category:r.category,result:{...resultBase(s),status:'completed',score:r.result.score,scale:'normalized'}});
 }
 function evaluate(input){
  if(disposed)return Promise.reject(new CodeError('evaluation.disposed'));let raw,key;try{raw=copyEvaluation(input);key=canonicalJson(raw);}catch(e){return Promise.reject(e);}
  const id=raw.submissionId;if(admissions.has(id)){const old=admissions.get(id);if(old.key!==key)return Promise.reject(new CodeError('evaluation.conflict'));return old.promise;}
  if(records.has(id)){const old=records.get(id);if(old.key!==key)return Promise.reject(new CodeError('evaluation.conflict'));if(!currentSubmission(raw,getCurrent))return Promise.reject(new CodeError('evaluation.stale'));return Promise.resolve(copyEvaluation({...old.outcome,duplicate:true}));}
  if(admissions.size>=64)return Promise.reject(new CodeError('evaluation.capacity'));const ownTicket=++ticket;const admission={key,promise:null};const promise=(async()=>{
   const s=await verifySubmission(raw,cryptoProvider);if(disposed||ticket!==ownTicket||!currentSubmission(s,getCurrent))throw new CodeError('evaluation.stale');
   active?.controller.abort();const controller=new AbortController(),job={controller,submission:s,status:pendingReport(s)};active=job;
   let timer;const interruption=new Promise(resolve=>{controller.signal.addEventListener('abort',()=>resolve(failureReport(s,job.timeout?'timed-out':'cancelled')),{once:true});timer=setTimeout(()=>{job.timeout=true;controller.abort();},timeoutMs);});
   const work=Promise.resolve().then(()=>controller.signal.aborted?failureReport(s,'cancelled'):remote(s,{signal:controller.signal})).then(r=>sanitize(s,r),()=>failureReport(s)).catch(()=>failureReport(s));
   const report=await Promise.race([work,interruption]);clearTimeout(timer);
   const ignored=disposed||active!==job||!currentSubmission(s,getCurrent);if(active===job)active=null;
   const outcome=copyEvaluation({ignored,report});if(!ignored&&report.category!=='pending'){records.set(id,{key,outcome});while(records.size>maxRecords)records.delete(records.keys().next().value);}
   return outcome;
  })().finally(()=>admissions.delete(id));admission.promise=promise;admissions.set(id,admission);return promise;
 }
 return Object.freeze({evaluate,getStatus:()=>active?.status??null,cancel(){ticket++;active?.controller.abort();},dispose(){if(disposed)return;disposed=true;ticket++;active?.controller.abort();active=null;records.clear();},getRecords:()=>copyEvaluation([...records.values()].map(x=>x.outcome))});
}
