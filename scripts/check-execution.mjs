import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {prepareRunRequest,createExecutionCoordinator,validateTerminal} from '../execution/index.js';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),clone=v=>JSON.parse(JSON.stringify(v));
const request={executionVersion:'1.0.0',executionId:uuid(10),activityId:uuid(1),sessionId:uuid(2),attemptId:uuid(3),generation:uuid(4),revision:0,language:'javascript',runtime:{id:'interactive-project/node',version:'22.0.0'},entrypoint:'main.js',files:[{id:'main',path:'main.js',encoding:'utf-8',text:"console.log('fixture');"}],limits:{wallTimeMs:1000,memoryBytes:67108864,outputBytes:4096,workspaceBytes:1048576,processes:16,scratchBytes:1048576},filesystem:'read-only-workspace',network:'none'};
const manifest={providerVersion:'1.0.0',id:'fixtures/remote',isolation:'remote-sandbox',enforced:{time:true,memory:true,output:true,filesystem:true,network:true,processes:true},runtimes:[{...request.runtime,languages:['javascript']}]};
const completed=r=>({executionVersion:'1.0.0',executionId:r.executionId,status:'completed',exitCode:0,cleanupComplete:true});
assert(Object.isFrozen(prepareRunRequest(request).files));const schema=JSON.parse(readFileSync(new URL('../schemas/run-request.v1.schema.json',import.meta.url))),validate=new Ajv2020({strict:true}).compile(schema);assert(validate(request));
for(const mutate of [r=>r.network='internet',r=>r.filesystem='host',r=>r.env={TOKEN:'HOST_SECRET'},r=>r.files[0].path='../secret',r=>r.limits.memoryBytes=0,r=>r.files.push({...r.files[0],id:'duplicate',path:'MAIN.JS'}),r=>r.files.push({...r.files[0],id:'nested',path:'main.js/sub'})]){
 const bad=clone(request);mutate(bad);assert.throws(()=>prepareRunRequest(bad));
}
assert(!validateTerminal({...completed(request),executionId:uuid(99)},request).valid);
assert.throws(()=>createExecutionCoordinator({getCurrent:()=>request,provider:{manifest:{...manifest,isolation:'browser-worker',enforced:{...manifest.enforced,memory:false}},run:()=>completed(request)}}),e=>e.code==='execution.provider');
{
 let calls=0,terminals=0;const provider={manifest,run:async(r,o)=>{calls++;o.onMessage({executionVersion:'1.0.0',executionId:r.executionId,sequence:0,channel:'stdout',text:'fixture output'});return completed(r)}};
 const coordinator=createExecutionCoordinator({getCurrent:()=>request,policy:{execution:true,network:true},provider,onTerminal:()=>terminals++});
 const a=coordinator.run(request);assert.equal(coordinator.run(request),a);const result=await a;assert(!result.ignored);assert.equal(result.messages[0].text,'fixture output');assert.equal(calls,1);assert.equal(terminals,1);assert((await coordinator.run(request)).duplicate);assert.equal(calls,1);
 await assert.rejects(coordinator.run({...request,files:[{...request.files[0],text:'different'}]}),e=>e.code==='execution.conflict');coordinator.dispose();
 const policy={execution:false,network:true},denied=createExecutionCoordinator({getCurrent:()=>request,policy,provider});policy.execution=true;assert.equal((await denied.run(request)).terminal.reason,'permission');assert.equal(calls,1);denied.dispose();
 const transportDenied=createExecutionCoordinator({getCurrent:()=>request,policy:{execution:true},provider});assert.equal((await transportDenied.run(request)).terminal.reason,'permission');assert.equal(calls,1);transportDenied.dispose();
 const missing=createExecutionCoordinator({getCurrent:()=>request,policy:{execution:true}});assert.equal((await missing.run(request)).terminal.reason,'driver-missing');missing.dispose();
}
{
 let resolve;const current={...request},published=[],coordinator=createExecutionCoordinator({getCurrent:()=>current,policy:{execution:true},provider:{manifest,run:r=>new Promise(done=>resolve=()=>done(completed(r)))},onTerminal:o=>published.push(o)});
 const p=coordinator.run(request);await new Promise(r=>setImmediate(r));current.revision++;resolve();assert((await p).ignored);assert.equal(published.length,0);coordinator.dispose();
}
{
 let lateMessage;const coordinator=createExecutionCoordinator({getCurrent:()=>request,policy:{execution:true},provider:{manifest,run:(r,o)=>{lateMessage=o.onMessage;return new Promise(resolve=>o.signal.addEventListener('abort',()=>resolve({executionVersion:'1.0.0',executionId:r.executionId,status:'cancelled',reason:'cancelled',cleanupComplete:true}),{once:true}))}}});
 const p=coordinator.run(request);await new Promise(r=>setImmediate(r));coordinator.cancel();const result=await p;assert.equal(result.terminal.status,'cancelled');lateMessage({executionVersion:'1.0.0',executionId:request.executionId,sequence:0,channel:'stdout',text:'late'});assert.equal(result.messages.length,0);coordinator.dispose();
 const hung=createExecutionCoordinator({getCurrent:()=>request,policy:{execution:true},cleanupTimeoutMs:10,provider:{manifest,run:()=>new Promise(()=>{})}});const q=hung.run(request);await new Promise(r=>setImmediate(r));hung.cancel();assert.equal((await q).terminal.cleanupComplete,false);hung.dispose();
}
{
 const coordinator=createExecutionCoordinator({getCurrent:()=>request,policy:{execution:true},provider:{manifest,run:(r,o)=>{o.onMessage({executionVersion:'1.0.0',executionId:r.executionId,sequence:0,channel:'stdout',text:'x'.repeat(5000)});return completed(r)}}});
 assert.equal((await coordinator.run(request)).terminal.reason,'output-limit');coordinator.dispose();
}
console.log('Execution contract: request/schema/permission gates, retained idempotency, host-enforced provider profiles, bounded messages, cancellation cleanup and stale terminal rejection passed.');
