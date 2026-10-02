import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
import {canonicalJson} from '@interactive-project/protocol/interoperability';
import {CodeError,normalizePath,validSourceText,sourceBytes} from '../index.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,ns=/^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/,version=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export const executionLimits=Object.freeze({wallTimeMs:30000,memoryBytes:268435456,outputBytes:262144,workspaceBytes:1048576,processes:64,scratchBytes:1048576});
function copy(v,maxBytes=2097152){const r=copyGeneratedJson(v,{maxBytes,maxDepth:32,maxCollectionSize:1000,maxStringLength:100000,maxNodes:50000});if(!r.valid)throw new CodeError('execution.nonJson');return r.value;}
export function prepareRunRequest(input){
 const r=copy(input),fields=['executionVersion','executionId','activityId','sessionId','attemptId','generation','revision','language','runtime','entrypoint','files','limits','filesystem','network'];
 if(!r||Object.keys(r).some(k=>!fields.includes(k))||r.executionVersion!=='1.0.0'||!['executionId','activityId','sessionId','generation'].every(k=>typeof r[k]==='string'&&uuid.test(r[k]))||(r.attemptId!==undefined&&!uuid.test(r.attemptId))||!Number.isSafeInteger(r.revision)||r.revision<0||typeof r.language!=='string'||!/^[a-z][a-z0-9+-]{0,31}$/.test(r.language)||!r.runtime||Object.keys(r.runtime).sort().join(',')!=='id,version'||typeof r.runtime.id!=='string'||!ns.test(r.runtime.id)||typeof r.runtime.version!=='string'||!version.test(r.runtime.version)||r.network!=='none'||r.filesystem!=='read-only-workspace'||!Array.isArray(r.files)||r.files.length<1||r.files.length>100||!r.limits||Object.keys(r.limits).sort().join(',')!==Object.keys(executionLimits).sort().join(','))throw new CodeError('execution.request');
 for(const [k,max]of Object.entries(executionLimits))if(!Number.isSafeInteger(r.limits[k])||r.limits[k]<1||r.limits[k]>max)throw new CodeError('execution.limits');
 if(r.limits.memoryBytes<16777216)throw new CodeError('execution.limits');
 const ids=new Set(),paths=new Set();for(const f of r.files){if(!f||Object.keys(f).sort().join(',')!=='encoding,id,path,text'||typeof f.id!=='string'||!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(f.id)||ids.has(f.id)||f.encoding!=='utf-8'||!validSourceText(f.text))throw new CodeError('execution.files');normalizePath(f.path);const p=f.path.toLowerCase();if(paths.has(p))throw new CodeError('execution.files');ids.add(f.id);paths.add(p);}
 for(const path of paths)for(const other of paths)if(path!==other&&path.startsWith(other+'/'))throw new CodeError('execution.files');
 normalizePath(r.entrypoint);if(!r.files.some(f=>f.path===r.entrypoint)||sourceBytes(r.files)>r.limits.workspaceBytes)throw new CodeError('execution.files');return r;
}
const terminalStatuses=['completed','failed','timed-out','cancelled'];
const reasons=['runtime-error','provider-error','output-limit','memory-limit','cancelled','timeout','permission','driver-missing','cleanup-incomplete'];
export function validateTerminal(input,request){
 let r;try{r=copy(input,65536);}catch{return{valid:false};}
 const valid=!!r&&Object.keys(r).every(k=>['executionVersion','executionId','status','reason','exitCode','cleanupComplete'].includes(k))&&r.executionVersion==='1.0.0'&&r.executionId===request.executionId&&terminalStatuses.includes(r.status)&&typeof r.cleanupComplete==='boolean'&&(r.reason===undefined||reasons.includes(r.reason))&&(r.exitCode===undefined||Number.isSafeInteger(r.exitCode)&&r.exitCode>=0&&r.exitCode<=255)&&(r.status!=='completed'||r.exitCode===0&&r.cleanupComplete===true);
 return{valid};
}
export function createExecutionCoordinator(options){
 if(!options||typeof options.getCurrent!=='function')throw new CodeError('execution.options');
 const getCurrent=options.getCurrent,provider=options.provider,policy=copy(options.policy??{}),onMessage=options.onMessage,onTerminal=options.onTerminal,maxRecords=options.maxRecords??16,cleanupTimeoutMs=options.cleanupTimeoutMs??5000;
 if(Object.keys(policy).some(k=>!['execution','network'].includes(k))||Object.values(policy).some(v=>typeof v!=='boolean')||!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>16||!Number.isSafeInteger(cleanupTimeoutMs)||cleanupTimeoutMs<1||cleanupTimeoutMs>10000)throw new CodeError('execution.options');
 let manifest;if(provider){manifest=copy(provider.manifest);if(typeof provider.run!=='function'||!manifest||manifest.providerVersion!=='1.0.0'||typeof manifest.id!=='string'||!ns.test(manifest.id)||!Array.isArray(manifest.runtimes)||!manifest.enforced||!['time','memory','output','filesystem','network','processes'].every(k=>manifest.enforced[k]===true)||!['container','remote-sandbox'].includes(manifest.isolation))throw new CodeError('execution.provider');}
 const requiredPermissions=manifest?.requiredPermissions??(manifest?.isolation==='remote-sandbox'?['execution','network']:['execution']);if(!Array.isArray(requiredPermissions)||requiredPermissions.some(p=>!['execution','network'].includes(p)))throw new CodeError('execution.provider');
 const runProvider=provider?.run,records=[],retained=new Map();let current=null,disposed=false;
 function matches(r){if(disposed)return false;try{const c=getCurrent();return c&&['activityId','sessionId','attemptId','generation','revision'].every(k=>c[k]===r[k]);}catch{return false;}}
 function emit(fn,value){try{const p=fn?.(value);if(p&&typeof p.then==='function')Promise.resolve(p).catch(()=>{});}catch{}}
 const terminal=(r,status,reason,cleanupComplete=true)=>copy({executionVersion:'1.0.0',executionId:r.executionId,status,reason,cleanupComplete});
 function run(input){
  let r,key;try{if(disposed)throw new CodeError('execution.disposed');r=prepareRunRequest(input);if(!matches(r))throw new CodeError('execution.stale');key=canonicalJson(r);
   if(current?.request.executionId===r.executionId){if(current.key!==key)throw new CodeError('execution.conflict');return current.promise;}
   if(retained.has(r.executionId)){const old=retained.get(r.executionId);if(old.key!==key)throw new CodeError('execution.conflict');return Promise.resolve({...old.outcome,duplicate:true});}
  }catch(e){return Promise.reject(e instanceof CodeError?e:new CodeError('execution.request'));}
  if(current){current.reason='cancelled';current.controller.abort();}
  const controller=new AbortController(),job={request:r,key,controller,reason:null,messages:[],bytes:0};current=job;let timer,listener;
  function message(input){
   if(disposed||current!==job||controller.signal.aborted||!matches(r))return;let m;try{m=copy(input,131072);}catch{job.reason='provider-error';controller.abort();return;}
   if(!m||Object.keys(m).sort().join(',')!=='channel,executionId,executionVersion,sequence,text'||m.executionVersion!=='1.0.0'||m.executionId!==r.executionId||m.sequence!==job.messages.length||!['stdout','stderr'].includes(m.channel)||typeof m.text!=='string'||m.text.length>16384){job.reason='provider-error';controller.abort();return;}
   const bytes=new TextEncoder().encode(m.text).byteLength;if(job.bytes+bytes>r.limits.outputBytes||job.messages.length>=1000){job.reason='output-limit';controller.abort();return;}job.bytes+=bytes;job.messages.push(m);emit(onMessage,m);
  }
  const work=Promise.resolve().then(()=>{
   if(controller.signal.aborted)return terminal(r,'cancelled','cancelled');
   if(policy.execution!==true||requiredPermissions.some(p=>policy[p]!==true))return terminal(r,'failed','permission');
   if(!runProvider||!manifest.runtimes.some(t=>t.id===r.runtime.id&&t.version===r.runtime.version&&Array.isArray(t.languages)&&t.languages.includes(r.language)))return terminal(r,'failed','driver-missing');
   return runProvider(r,{signal:controller.signal,onMessage:message});
  }).catch(()=>terminal(r,'failed','provider-error',false));
  const interrupted=new Promise(resolve=>{listener=()=>{const cleanupTimer=setTimeout(()=>resolve(terminal(r,job.reason==='timeout'?'timed-out':job.reason==='cancelled'?'cancelled':'failed',job.reason??'cancelled',false)),cleanupTimeoutMs);work.then(value=>{clearTimeout(cleanupTimer);resolve(value);},()=>{clearTimeout(cleanupTimer);resolve(terminal(r,'failed','provider-error',false));});};controller.signal.addEventListener('abort',listener,{once:true});});
  timer=setTimeout(()=>{job.reason='timeout';controller.abort();},r.limits.wallTimeMs+10000);
  job.promise=Promise.race([work,interrupted]).then(value=>{
   let valueCopy;try{valueCopy=copy(value,65536);}catch{valueCopy=terminal(r,'failed','provider-error');}
   if(!validateTerminal(valueCopy,r).valid)valueCopy=terminal(r,'failed','provider-error',false);
   if(controller.signal.aborted)valueCopy=terminal(r,job.reason==='timeout'?'timed-out':job.reason==='cancelled'?'cancelled':'failed',job.reason??'cancelled',valueCopy.cleanupComplete===true);
   const ignored=current!==job||!matches(r),outcome=Object.freeze({terminal:valueCopy,messages:Object.freeze([...job.messages]),ignored});
   if(!disposed){const record={key,outcome};records.push({executionId:r.executionId,...record});retained.set(r.executionId,record);while(records.length>maxRecords){const old=records.shift();retained.delete(old.executionId);}if(!ignored&&valueCopy.cleanupComplete)emit(onTerminal,outcome);}
   return outcome;
  },()=>({terminal:terminal(r,'failed','provider-error',false),messages:Object.freeze([...job.messages]),ignored:!matches(r)})).finally(()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',listener);if(current===job)current=null;});
  return job.promise;
 }
 function cancel(){if(current){current.reason='cancelled';current.controller.abort();}}
 function dispose(){if(disposed)return;disposed=true;cancel();records.length=0;retained.clear();}
 return Object.freeze({run,cancel,dispose,getRecords:()=>Object.freeze(records.map(r=>r.outcome))});
}
