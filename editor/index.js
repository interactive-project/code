import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
import {CodeError,isTextBoundary,normalizePath,validSourceText,sourceBytes} from '../index.js';
const idPattern=/^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
function copy(v){const r=copyGeneratedJson(v,{maxBytes:2097152,maxDepth:16,maxCollectionSize:1000,maxStringLength:100000,maxNodes:50000});if(!r.valid)throw new CodeError('editor.nonJson');return r.value;}
export function createEditorBridge(options){
 if(!options||typeof options.getWorkspace!=='function'||typeof options.applyEdit!=='function')throw new CodeError('editor.options');
 const getWorkspace=options.getWorkspace,applyEdit=options.applyEdit,onSelection=options.onSelection,onDiagnostic=options.onDiagnostic;
 let active=null,generation=0,disposed=false;
 const diagnostic=code=>{try{const r=onDiagnostic?.(Object.freeze({code}));if(r&&typeof r.then==='function')Promise.resolve(r).catch(()=>{});}catch{}};
 function workspace(){
  let state;try{state=copy(getWorkspace());}catch{throw new CodeError('editor.workspace');}
  if(!state||Object.keys(state).sort().join(',')!=='deletedFileIds,entrypointId,files,language,stateVersion'||state.stateVersion!=='1.0.0'||!Array.isArray(state.files)||state.files.length<1||state.files.length>100||!Array.isArray(state.deletedFileIds))throw new CodeError('editor.workspace');
  const ids=new Set(),paths=new Set();
  for(const f of state.files){if(!f||Object.keys(f).some(k=>!['id','path','language','encoding','text','editable','version'].includes(k))||typeof f.id!=='string'||!idPattern.test(f.id)||ids.has(f.id)||f.encoding!=='utf-8'||typeof f.editable!=='boolean'||typeof f.language!=='string'||!Number.isSafeInteger(f.version)||f.version<0||!validSourceText(f.text))throw new CodeError('editor.workspace');normalizePath(f.path);if(paths.has(f.path.toLowerCase()))throw new CodeError('editor.workspace');ids.add(f.id);paths.add(f.path.toLowerCase());}
  if(!ids.has(state.entrypointId)||sourceBytes(state.files)>1048576)throw new CodeError('editor.workspace');return state;
 }
 function files(){return copy(workspace().files.map(f=>({id:f.id,path:f.path,language:f.language,text:f.text,readOnly:!f.editable,version:f.version})));}
 function safeDispose(handle){try{const r=handle?.dispose?.();if(r&&typeof r.then==='function')Promise.resolve(r).catch(()=>diagnostic('editor.cleanup'));}catch{diagnostic('editor.cleanup');}}
 function range(input,selection=false){
  const r=copy(input);if(!r||typeof r!=='object'||Array.isArray(r))throw new CodeError('editor.range');const state=workspace(),f=state.files.find(f=>f.id===r.fileId);if(!f)throw new CodeError('editor.range');
  const keys=selection?'anchor,fileId,head':'fileId,from,message,severity,to';
  if(Object.keys(r).sort().join(',')!==keys||!(selection?isTextBoundary(f.text,r.anchor)&&isTextBoundary(f.text,r.head):isTextBoundary(f.text,r.from)&&isTextBoundary(f.text,r.to)&&r.from<=r.to&&['error','warning','info'].includes(r.severity)&&typeof r.message==='string'&&r.message.length<=256))throw new CodeError('editor.range');return r;
 }
 async function replaceDriver(driver,mount){
  if(disposed)throw new CodeError('editor.disposed');if(!driver||typeof driver.id!=='string'||typeof driver.create!=='function')throw new CodeError('editor.driver');const request=++generation;let handle=null;
  const onEdit=async input=>{
   if(disposed||!handle||active?.handle!==handle)return false;
   let accepted=false;try{const edit=copy(input),state=workspace(),f=state.files.find(f=>f.id===edit.fileId);if(!f||!f.editable||Object.keys(edit).sort().join(',')!=='expectedVersion,fileId,from,insert,to'||edit.expectedVersion!==f.version||!isTextBoundary(f.text,edit.from)||!isTextBoundary(f.text,edit.to)||edit.from>edit.to||typeof edit.insert!=='string'||edit.insert.length>4000||!validSourceText(edit.insert))throw new CodeError('editor.edit');const result=await applyEdit(edit);accepted=result?.status==='accepted';}catch{diagnostic('editor.editRejected');}
   if(!disposed&&active?.handle===handle)try{await handle.updateFiles(files());}catch{diagnostic('editor.update');}return accepted;
  };
  const selection=input=>{if(disposed||!handle||active?.handle!==handle)return;try{const value=range(input,true),r=onSelection?.(value);if(r&&typeof r.then==='function')Promise.resolve(r).catch(()=>diagnostic('editor.selection'));}catch{diagnostic('editor.selection');}};
  try{handle=await driver.create({mount,files:files(),onEdit,onSelection:selection});if(!handle||!['updateFiles','setSelection','setDiagnostics','dispose'].every(k=>typeof handle[k]==='function'))throw new CodeError('editor.driver');if(disposed||request!==generation){safeDispose(handle);return{installed:false,reason:'editor.stale'};}for(let attempt=0;attempt<3;attempt++){const rendered=files();await handle.updateFiles(rendered);const current=files();if(JSON.stringify(rendered)===JSON.stringify(current))break;if(attempt===2)throw new CodeError('editor.busy');}if(disposed||request!==generation){safeDispose(handle);return{installed:false,reason:'editor.stale'};}const previous=active;active={id:driver.id,handle};safeDispose(previous?.handle);return{installed:true};}
  catch{safeDispose(handle);throw new CodeError('editor.driver');}
 }
 async function refresh(){if(disposed)throw new CodeError('editor.disposed');const current=active;if(!current)return;try{await current.handle.updateFiles(files());}catch{throw new CodeError('editor.update');}}
 async function setSelection(input){if(disposed)throw new CodeError('editor.disposed');const value=range(input,true);if(!active)throw new CodeError('editor.unmounted');try{await active.handle.setSelection(value);}catch{throw new CodeError('editor.selection');}}
 async function setDiagnostics(input){if(disposed)throw new CodeError('editor.disposed');const prepared=copy(input);if(!Array.isArray(prepared)||prepared.length>1000)throw new CodeError('editor.diagnostics');const values=prepared.map(r=>range(r));if(!active)throw new CodeError('editor.unmounted');try{await active.handle.setDiagnostics(Object.freeze(values));}catch{throw new CodeError('editor.diagnostics');}}
 function dispose(){if(disposed)return;disposed=true;generation++;const previous=active;active=null;safeDispose(previous?.handle);}
 return Object.freeze({replaceDriver,refresh,setSelection,setDiagnostics,dispose,getDriverId:()=>active?.id??null});
}
