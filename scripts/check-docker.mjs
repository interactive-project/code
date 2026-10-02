import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDockerProvider} from '../providers/docker/index.js';
const image=process.env.CODE_TEST_IMAGE;if(!image)throw Error('CODE_TEST_IMAGE must identify an approved local image digest');
const runtimeVersion=execFileSync('docker',['run','--rm','--network=none','--read-only','--cap-drop=ALL','--user=65534:65534','--memory=67108864','--memory-swap=67108864','--pids-limit=16','--entrypoint=node',image,'--version'],{encoding:'utf8',timeout:10000}).trim().slice(1);
const provider=await createDockerProvider({image,runtimeVersion}),uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');let id=10;
const request=source=>({executionVersion:'1.0.0',executionId:uuid(id++),activityId:uuid(1),sessionId:uuid(2),attemptId:uuid(3),generation:uuid(4),revision:0,language:'javascript',runtime:{id:'interactive-project/node',version:runtimeVersion},entrypoint:'main.js',files:[{id:'main',path:'main.js',encoding:'utf-8',text:source}],limits:{wallTimeMs:3000,memoryBytes:67108864,outputBytes:65536,workspaceBytes:1048576,processes:16,scratchBytes:1048576},filesystem:'read-only-workspace',network:'none'});
async function run(r,signal){const messages=[],terminal=await provider.run(r,{signal,onMessage:m=>messages.push(m)});assert(terminal.cleanupComplete,JSON.stringify(terminal));return{terminal,messages,text:messages.map(m=>m.text).join('')};}
process.env.INTERACTIVE_HOST_SECRET='HOST_SECRET_SENTINEL';
{
 const r=await run(request("console.log('stdout fixture');console.error('stderr fixture');console.log(process.env.INTERACTIVE_HOST_SECRET === undefined ? 'no-host-env' : 'HOST_SECRET_SENTINEL');"));
 assert.equal(r.terminal.status,'completed');assert(r.text.includes('stdout fixture'));assert(r.text.includes('stderr fixture'));assert(r.text.includes('no-host-env'));assert(!r.text.includes('HOST_SECRET_SENTINEL'));assert.deepEqual(r.messages.map(m=>m.sequence),r.messages.map((_,i)=>i));
}
{
 const directory=await mkdtemp(join(tmpdir(),'code-host-secret-')),hostPath=join(directory,'secret');await writeFile(hostPath,'HOST_SECRET_SENTINEL');
 try{const source="const fs=require('fs');try{fs.readFileSync("+JSON.stringify(hostPath)+");console.log('HOST_READ_ALLOWED')}catch{console.log('host-read-denied')}try{fs.writeFileSync('/workspace/forbidden','x');console.log('WORKSPACE_WRITE_ALLOWED')}catch{console.log('workspace-write-denied')}try{fs.writeFileSync('/etc/forbidden','x');console.log('ROOT_WRITE_ALLOWED')}catch{console.log('root-write-denied')}";
 const r=await run(request(source));assert.equal(r.terminal.status,'completed');assert(r.text.includes('host-read-denied'));assert(r.text.includes('workspace-write-denied'));assert(r.text.includes('root-write-denied'));assert(!r.text.includes('_ALLOWED'));}finally{await rm(directory,{recursive:true,force:true});}
}
{
 const r=await run(request("const net=require('net');const s=net.connect({host:'1.1.1.1',port:80});s.on('connect',()=>{console.log('NETWORK_ALLOWED');s.destroy()});s.on('error',()=>console.log('network-denied'));s.setTimeout(1000,()=>{console.log('network-denied');s.destroy()});"));
 assert.equal(r.terminal.status,'completed');assert(r.text.includes('network-denied'));assert(!r.text.includes('NETWORK_ALLOWED'));
}
{
 const r=request('while(true){}');r.limits.wallTimeMs=500;const result=await run(r);assert.equal(result.terminal.status,'timed-out');assert.equal(result.messages.length,0);
 const excessive=request("process.stdout.write('x'.repeat(1000000));");excessive.limits.outputBytes=1024;const limited=await run(excessive);assert.equal(limited.terminal.reason,'output-limit');assert.equal(limited.messages.length,0);
}
{
 const signal=new AbortController(),r=request("require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'ignore'});setTimeout(()=>console.log('late'),4000);setInterval(()=>{},100);");r.limits.wallTimeMs=5000;
 const timer=setTimeout(()=>signal.abort(),700);try{const result=await run(r,signal.signal);assert.equal(result.terminal.status,'cancelled');assert.equal(result.messages.length,0);}finally{clearTimeout(timer);}
}
const leftovers=execFileSync('docker',['ps','-aq','--filter','name=interactive-code-'],{encoding:'utf8'}).trim();assert.equal(leftovers,'');
console.log('Docker isolation: actual stdout/stderr, no host env/files, read-only filesystem, forbidden network, infinite execution deadline, output cap and cancellation/child/container cleanup passed.');
