import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {prepareRunRequest,executionLimits} from '../../execution/index.js';
import {CodeError} from '../../index.js';
const versionPattern=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export async function createDockerProvider(options){
 if(process.platform!=='linux'||!options||typeof options.image!=='string'||!/^(?:sha256:|[a-z0-9][a-z0-9./:_-]*@sha256:)[0-9a-f]{64}$/.test(options.image)||typeof options.runtimeVersion!=='string'||!versionPattern.test(options.runtimeVersion))throw new CodeError('execution.dockerOptions');
 const image=options.image,binary=options.binary??'docker',runtimeVersion=options.runtimeVersion;
 if(typeof binary!=='string'||!binary)throw new CodeError('execution.dockerOptions');
 async function command(args,{onData,maxBytes=1048576,timeoutMs=10000}={}){
  return new Promise(resolve=>{
   let processHandle,stdout=[],stderr=[],size=0,done=false,timer;
   const finish=(code,overflow=false)=>{if(done)return;done=true;clearTimeout(timer);resolve({code,overflow,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')});};
   try{processHandle=spawn(binary,args,{shell:false,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH??'/usr/bin:/bin'}});}catch{finish(-1);return;}
   const data=(channel,chunk)=>{if(done)return;size+=chunk.length;if(size>maxBytes){onData?.(channel,chunk);processHandle.kill('SIGKILL');finish(-1,true);return;}(channel==='stdout'?stdout:stderr).push(chunk);onData?.(channel,chunk);};
   processHandle.stdout.on('data',b=>data('stdout',b));processHandle.stderr.on('data',b=>data('stderr',b));processHandle.once('error',()=>finish(-1));processHandle.once('close',code=>finish(code??-1));
   timer=setTimeout(()=>{processHandle.kill('SIGKILL');finish(-1);},timeoutMs);
  });
 }
 const info=await command(['info','--format','{{json .}}']);let host;try{host=JSON.parse(info.stdout);}catch{throw new CodeError('execution.dockerUnavailable');}
 if(info.code!==0||host.OSType!=='linux'||!['MemoryLimit','SwapLimit','PidsLimit','CpuCfsQuota'].every(k=>host[k]===true))throw new CodeError('execution.dockerLimits');
 const imageCheck=await command(['image','inspect',image]);if(imageCheck.code!==0)throw new CodeError('execution.dockerImage');
 const version=await command(['run','--rm','--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=65534:65534','--memory=67108864','--memory-swap=67108864','--pids-limit=16','--entrypoint=node',image,'--version']);
 if(version.code!==0||version.stdout.trim()!=='v'+runtimeVersion)throw new CodeError('execution.runtimeVersion');
 const manifest=Object.freeze({providerVersion:'1.0.0',id:'interactive-project/docker-node',isolation:'container',enforced:Object.freeze({time:true,memory:true,output:true,filesystem:true,network:true,processes:true}),limits:executionLimits,requiredPermissions:Object.freeze(['execution']),runtimes:Object.freeze([{id:'interactive-project/node',version:runtimeVersion,languages:['javascript']}])});
 async function run(input,{signal,onMessage}={}){
  const request=prepareRunRequest(input);if(request.language!=='javascript'||request.runtime.id!=='interactive-project/node'||request.runtime.version!==runtimeVersion)throw new CodeError('execution.runtime');
  const name='interactive-code-'+request.executionId+'-'+randomUUID(),decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')},chunks=[];let directory,created=false,reason=null,timer,outputBytes=0,cleanupComplete=false,stopPromise=null;
  const outcome=(status,extra={})=>({executionVersion:'1.0.0',executionId:request.executionId,status,cleanupComplete,...extra});
  const stop=why=>{if(reason===null)reason=why;if(created&&!stopPromise)stopPromise=command(['rm','--force','--volumes',name]);};
  const abort=()=>stop('cancelled');signal?.addEventListener('abort',abort,{once:true});
  function output(channel,chunk){
   if(reason!==null)return;outputBytes+=chunk.length;if(outputBytes>request.limits.outputBytes){stop('output-limit');return;}
   const text=decoders[channel].write(chunk);if(text)chunks.push({channel,text});
  }
  let exitCode,status='failed',failure='provider-error',logsOkay=false;
  try{
   if(signal?.aborted){reason='cancelled';return await finalize();}
   directory=await mkdtemp(join(tmpdir(),'interactive-code-'));await chmod(directory,0o755);
   for(const file of request.files){const path=join(directory,file.path);await mkdir(dirname(path),{recursive:true,mode:0o755});await writeFile(path,file.text,{encoding:'utf8',mode:0o644,flag:'wx'});}
   if(signal?.aborted){reason='cancelled';return await finalize();}
   const args=['create','--name',name,'--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=65534:65534','--pids-limit='+request.limits.processes,'--memory='+request.limits.memoryBytes,'--memory-swap='+request.limits.memoryBytes,'--cpus=1','--workdir=/workspace','--tmpfs=/tmp:rw,noexec,nosuid,nodev,size='+request.limits.scratchBytes,'--mount','type=bind,src='+directory+',dst=/workspace,readonly','--env','HOME=/tmp','--entrypoint=node',image,'--max-old-space-size='+Math.max(8,Math.floor(request.limits.memoryBytes/1048576/2)),'/workspace/'+request.entrypoint];
   const create=await command(args);created=create.code===0;
   if(!created)return await finalize();
   if(signal?.aborted){stop('cancelled');return await finalize();}
   timer=setTimeout(()=>stop('timeout'),request.limits.wallTimeMs);
   const start=await command(['start',name]);if(start.code!==0)return await finalize();
   const logs=await command(['logs','--follow',name],{onData:output,maxBytes:request.limits.outputBytes+65536,timeoutMs:request.limits.wallTimeMs+10000});
   logsOkay=logs.code===0&&!logs.overflow;
   if(reason!==null)return await finalize();
   const inspect=await command(['inspect','--format','{{json .State}}',name]);let state;try{state=JSON.parse(inspect.stdout);}catch{return await finalize();}
   if(inspect.code!==0||state.Running||!Number.isSafeInteger(state.ExitCode)||state.ExitCode<0||state.ExitCode>255)return await finalize();
   exitCode=state.ExitCode;status=exitCode===0?'completed':'failed';failure=state.OOMKilled?'memory-limit':'runtime-error';
   return await finalize();
  }catch{return await finalize();}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  async function finalize(){
   clearTimeout(timer);
   if(stopPromise)await stopPromise;
   const remove=await command(['rm','--force','--volumes',name]);const remaining=await command(['inspect',name]);cleanupComplete=remaining.code===1&&(remaining.stderr.includes('No such object: '+name)||remaining.stderr.includes('No such container: '+name));
   if(directory)try{await rm(directory,{recursive:true,force:true});}catch{cleanupComplete=false;}
   if(!cleanupComplete)return outcome('failed',{reason:'cleanup-incomplete'});
   if(reason)return outcome(reason==='timeout'?'timed-out':reason==='cancelled'?'cancelled':'failed',{reason});
   if(!logsOkay)return outcome('failed',{reason:'provider-error'});
   for(const channel of ['stdout','stderr']){const tail=decoders[channel].end();if(tail)chunks.push({channel,text:tail});}
   let sequence=0;
   for(const chunk of chunks)for(let from=0;from<chunk.text.length;){let to=Math.min(from+16384,chunk.text.length);const a=chunk.text.charCodeAt(to-1),b=chunk.text.charCodeAt(to);if(a>=0xD800&&a<=0xDBFF&&b>=0xDC00&&b<=0xDFFF)to--;const message={executionVersion:'1.0.0',executionId:request.executionId,sequence:sequence++,channel:chunk.channel,text:chunk.text.slice(from,to)};try{const r=onMessage?.(Object.freeze(message));if(r&&typeof r.then==='function')Promise.resolve(r).catch(()=>{});}catch{}from=to;}
   return outcome(status,{...(status==='completed'?{}:{reason:failure}),exitCode});
  }
 }
 return Object.freeze({manifest,run});
}
