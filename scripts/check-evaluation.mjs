import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {validateResult} from '@interactive-project/protocol/validation/interoperability';
import {createSubmission,verifySubmission,createEvaluationClient} from '../evaluation/index.js';
import {prepareTests,createTrustedEvaluator} from '../evaluation/trusted.js';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),clone=v=>JSON.parse(JSON.stringify(v));
const request={executionVersion:'1.0.0',executionId:uuid(10),activityId:uuid(1),sessionId:uuid(2),attemptId:uuid(3),generation:uuid(4),revision:7,language:'javascript',runtime:{id:'interactive-project/node',version:'22.0.0'},entrypoint:'main.js',files:[{id:'main',path:'main.js',encoding:'utf-8',text:'learner source'}],limits:{wallTimeMs:1000,memoryBytes:67108864,outputBytes:4096,workspaceBytes:1048576,processes:16,scratchBytes:1048576},filesystem:'read-only-workspace',network:'none'};
const suite={testVersion:'1.0.0',cases:[{id:'one',input:'private input',expected:'PRIVATE_EXPECTED',weight:1},{id:'two',input:'2',expected:'two\n',weight:3}]};
const submission=await createSubmission(request,uuid(20),webcrypto);
assert(Object.isFrozen(submission.request.files));request.files[0].text='changed';assert.equal(submission.request.files[0].text,'learner source');await verifySubmission(submission,webcrypto);
const corrupt=clone(submission);corrupt.request.files[0].text='bad';await assert.rejects(verifySubmission(corrupt,webcrypto),e=>e.code==='evaluation.digest');
for(const bad of [{...suite,cases:[]},{...suite,cases:[suite.cases[0],suite.cases[0]]},{...suite,cases:suite.cases.map(x=>({...x,weight:0}))},{...suite,cases:[{...suite.cases[0],weight:-1}]}])assert.throws(()=>prepareTests(bad));
{
 let attempts=0;const evaluator=createTrustedEvaluator({tests:suite,cryptoProvider:webcrypto,retries:1,runCase:async(s,t,o)=>{assert.equal(s.fileDigest,submission.fileDigest);attempts++;if(t.id==='one'&&o.attempt===0)return{status:'infrastructure-error'};return{status:'completed',stdout:t.id==='one'?t.expected:'two'};}});
 const a=await evaluator.evaluate(submission),b=await evaluator.evaluate(submission);assert.deepEqual(a,b);assert.equal(a.result.score,.25);assert.equal(a.category,'assertion-failed');assert.equal(attempts,6);assert(!JSON.stringify(a).includes('PRIVATE_EXPECTED'));assert(!JSON.stringify(a).includes('private input'));assert(!('cases' in a));assert(validateResult(a.result).valid);
 const pub=createTrustedEvaluator({tests:suite,visibility:'public',cryptoProvider:webcrypto,runCase:async(s,t)=>({status:'completed',stdout:t.expected})});const p=await pub.evaluate(submission);assert.equal(p.result.score,1);assert.deepEqual(p.cases.map(x=>x.credit),[1,1]);assert(!JSON.stringify(p).includes('PRIVATE_EXPECTED'));
 for(const status of ['compile-error','runtime-error','infrastructure-error','pending']){const e=createTrustedEvaluator({tests:suite,cryptoProvider:webcrypto,runCase:()=>({status})}),r=await e.evaluate(submission);assert.equal(r.category,status);assert(validateResult(r.result).valid);assert.equal(r.result.score,['compile-error','runtime-error'].includes(status)?0:undefined);}
 const throwing=createTrustedEvaluator({tests:suite,cryptoProvider:webcrypto,runCase:()=>{throw Error('PRIVATE_EXPECTED')}});assert(!JSON.stringify(await throwing.evaluate(submission)).includes('PRIVATE_EXPECTED'));
}
const aggregate=score=>({submissionId:submission.submissionId,fileDigest:submission.fileDigest,category:'completed',result:{protocolVersion:'1.0.0',resultVersion:'1.0.0',activityId:submission.request.activityId,sessionId:submission.request.sessionId,attemptId:submission.request.attemptId,revision:7,status:'completed',score,scale:'normalized',evidence:[]}});
const context=()=>({...submission.request});
{
 let calls=0;const client=createEvaluationClient({cryptoProvider:webcrypto,validateResult,getCurrent:context,remote:async()=>{calls++;return aggregate(.25);}});const p=client.evaluate(submission);assert.equal(client.evaluate(submission),p);assert.equal((await p).report.result.score,.25);assert((await client.evaluate(submission)).duplicate);assert.equal(calls,1);const conflict=clone(submission);conflict.request.revision++;await assert.rejects(client.evaluate(conflict),e=>e.code==='evaluation.conflict');assert(!JSON.stringify(client.getRecords()).includes('learner source'));client.dispose();
}
{
 let resolve,entered;const started=new Promise(r=>entered=r),current=context();const client=createEvaluationClient({cryptoProvider:webcrypto,validateResult,getCurrent:()=>current,remote:()=>{entered();return new Promise(r=>resolve=r);}});const p=client.evaluate(submission);await started;assert.equal(client.getStatus().category,'pending');current.generation=uuid(99);resolve(aggregate(1));assert((await p).ignored);assert.equal(client.getRecords().length,0);client.dispose();
}
{
 const client=createEvaluationClient({cryptoProvider:webcrypto,validateResult,getCurrent:context,remote:async()=>({...aggregate(1),cases:[{id:'hidden',expected:'PRIVATE_EXPECTED'}]})});const r=await client.evaluate(submission);assert.equal(r.report.category,'infrastructure-error');assert(!JSON.stringify(r).includes('PRIVATE_EXPECTED'));client.dispose();
 const wrong=aggregate(1);wrong.result.revision=8;const stale=createEvaluationClient({cryptoProvider:webcrypto,validateResult,getCurrent:context,remote:()=>wrong});assert.equal((await stale.evaluate(submission)).report.category,'infrastructure-error');stale.dispose();
 const timed=createEvaluationClient({cryptoProvider:webcrypto,validateResult,getCurrent:context,timeoutMs:10,remote:()=>new Promise(()=>{})});assert.equal((await timed.evaluate(submission)).report.category,'timed-out');timed.dispose();
 let entered;const started=new Promise(r=>entered=r);const cancelled=createEvaluationClient({cryptoProvider:webcrypto,validateResult,getCurrent:context,remote:()=>{entered();return new Promise(()=>{});}});const p=cancelled.evaluate(submission);await started;cancelled.cancel();assert.equal((await p).report.category,'cancelled');cancelled.dispose();
}
{
 let calls=0;const clean=createEvaluationClient({cryptoProvider:webcrypto,validateResult,getCurrent:context,remote:()=>{calls++;if(calls===1){const r=aggregate(1);delete r.result.score;delete r.result.scale;r.category='pending';r.result.status='pending';r.result.pendingReason='evaluation';return r;}return aggregate(1);}});assert.equal((await clean.evaluate(submission)).report.category,'pending');assert.equal((await clean.evaluate(submission)).report.result.score,1);assert.equal(calls,2);clean.dispose();
}
console.log('Code grading: immutable SHA-256 submissions, weighted private/public tests, error/pending categories, retry accounting, redaction, idempotency, deadline/cancellation and stale generation validation passed.');
