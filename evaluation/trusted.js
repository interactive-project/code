import {copyEvaluation,verifySubmission,resultBase,failureReport,pendingReport} from './index.js';
import {CodeError} from '../index.js';
const id=/^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
export function prepareTests(input){const t=copyEvaluation(input);if(!t||Object.keys(t).sort().join(',')!=='cases,testVersion'||t.testVersion!=='1.0.0'||!Array.isArray(t.cases)||t.cases.length<1||t.cases.length>100)throw new CodeError('evaluation.tests');const seen=new Set();let sum=0;
 for(const c of t.cases){if(!c||Object.keys(c).sort().join(',')!=='expected,id,input,weight'||typeof c.id!=='string'||!id.test(c.id)||seen.has(c.id)||typeof c.expected!=='string'||c.expected.length>100000||typeof c.input!=='string'||c.input.length>100000||!Number.isFinite(c.weight)||c.weight<0||c.weight>1000000)throw new CodeError('evaluation.tests');seen.add(c.id);sum+=c.weight;}if(sum===0)throw new CodeError('evaluation.tests');return t;}
export function createTrustedEvaluator({tests,visibility='private',runCase,cryptoProvider,retries=0}){
 const captured=prepareTests(tests);if(!['public','private'].includes(visibility)||typeof runCase!=='function'||!Number.isSafeInteger(retries)||retries<0||retries>3)throw new CodeError('evaluation.options');
 // Trusted runner owns compilation and isolated per-case execution. Never package this factory or private tests in learner hosts.
 async function evaluate(input,{signal}={}){
  const s=await verifySubmission(input,cryptoProvider),cases=[];let category='completed',numerator=0,total=0;
  for(const test of captured.cases){if(signal?.aborted)return failureReport(s,'cancelled');let outcome;
   for(let attempt=0;attempt<=retries;attempt++){try{outcome=copyEvaluation(await runCase(s,test,{signal,attempt}));}catch{outcome={status:'infrastructure-error'};}
    if(!outcome||Object.keys(outcome).some(k=>!['status','stdout'].includes(k))||!['completed','compile-error','runtime-error','infrastructure-error','pending'].includes(outcome.status)||(outcome.status==='completed'&&typeof outcome.stdout!=='string'))outcome={status:'infrastructure-error'};
    if(outcome.status!=='infrastructure-error')break;
   }
   if(signal?.aborted)return failureReport(s,'cancelled');
   if(outcome.status==='pending')return pendingReport(s);
   if(outcome.status==='infrastructure-error')return failureReport(s);
   if(outcome.status==='compile-error'||outcome.status==='runtime-error'){category=outcome.status;return copyEvaluation({submissionId:s.submissionId,fileDigest:s.fileDigest,category,result:{...resultBase(s),status:'completed',score:{value:0,scale:'normalized'}},...(visibility==='public'?{cases:[...cases,{id:test.id,status:category,credit:0}]}:{})});}
   const passed=outcome.stdout===test.expected,credit=passed?1:0;cases.push({id:test.id,status:passed?'passed':'assertion-failed',credit});numerator+=test.weight*credit;total+=test.weight;if(!passed)category='assertion-failed';
  }
  return copyEvaluation({submissionId:s.submissionId,fileDigest:s.fileDigest,category,result:{...resultBase(s),status:'completed',score:{value:numerator/total,scale:'normalized'}},...(visibility==='public'?{cases}:{})});
 }
 return Object.freeze({evaluate});
}
