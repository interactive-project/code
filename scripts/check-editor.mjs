import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWorkspacePorts} from '../index.js';
import {createEditorBridge} from '../editor/index.js';
import {validateCodeConfig} from '../validation/index.js';
const config=JSON.parse(readFileSync(new URL('../fixtures/config.valid.json',import.meta.url))),originalSpec=JSON.stringify(config),ports=createWorkspacePorts({activity:config,validateConfig:validateCodeConfig});let workspace=ports.initialState({type:'interactive-project/code',config}),disposedA=0,disposedB=0,callbacksA,callbacksB;
const applyEdit=edit=>{const r=ports.reduce(workspace,{type:'interactive-project/code.edit',payload:edit});if(r.accepted)workspace=r.state;return r.accepted?{status:'accepted',revision:workspace.files[0].version}:{status:'rejected'};};
const diagnostics=[],bridge=createEditorBridge({getWorkspace:()=>workspace,applyEdit,onDiagnostic:d=>diagnostics.push(d.code)});
function driver(id,assign,onDispose){return{id,create:context=>{assign(context);return{updateFiles:files=>{assert(files.every(f=>!Object.hasOwn(f,'editorModel')));},setSelection:s=>{assert.equal(s.fileId,'main');},setDiagnostics:d=>{assert(d.length<=1);},dispose:onDispose};}};}
assert((await bridge.replaceDriver(driver('fixtures/codemirror6-standin',c=>callbacksA=c,()=>disposedA++),{fixtureMount:true})).installed);
assert(await callbacksA.onEdit({fileId:'main',expectedVersion:0,from:0,to:0,insert:'// from A\n'}));const afterEdit=JSON.stringify(workspace);
assert((await bridge.replaceDriver(driver('fixtures/monaco-standin',c=>callbacksB=c,()=>disposedB++))).installed);assert.equal(disposedA,1);assert.equal(JSON.stringify(workspace),afterEdit);assert.equal(JSON.stringify(config),originalSpec);
assert.equal(await callbacksA.onEdit({fileId:'main',expectedVersion:1,from:0,to:0,insert:'late'}),false);
assert.equal(await callbacksB.onEdit({fileId:'tests',expectedVersion:0,from:0,to:0,insert:'attack'}),false);assert.equal(JSON.stringify(workspace),afterEdit);
await bridge.setSelection({fileId:'main',anchor:0,head:2});await bridge.setDiagnostics([{fileId:'main',from:0,to:2,severity:'warning',message:'Fixture warning'}]);await assert.rejects(bridge.setSelection({fileId:'main',anchor:-1,head:0}),e=>e.code==='editor.range');
await assert.rejects(bridge.setDiagnostics([null]),e=>e.code==='editor.range');
await assert.rejects(bridge.replaceDriver({id:'fixtures/broken',create:()=>{throw Error('private editor internals')}}),e=>e.code==='editor.driver');assert.equal(bridge.getDriverId(),'fixtures/monaco-standin');assert.equal(JSON.stringify(workspace),afterEdit);
let resolve,lateDisposed=0;const delayed=bridge.replaceDriver({id:'fixtures/delayed',create:()=>new Promise(r=>resolve=r)});bridge.dispose();resolve({updateFiles(){},setSelection(){},setDiagnostics(){},dispose(){lateDisposed++}});assert.equal((await delayed).installed,false);assert.equal(lateDisposed,1);assert.equal(disposedB,1);bridge.dispose();assert.equal(disposedB,1);
console.log('Editor bridge: driver replacement preserves spec/files, stale/disposed callbacks rejected, read-only edits restored and selection/diagnostic boundaries passed.');
