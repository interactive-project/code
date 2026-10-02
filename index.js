import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
import {canonicalJson} from '@interactive-project/protocol/interoperability';
export class CodeError extends Error{constructor(code){super('Code operation rejected.');this.name='CodeError';this.code=code;}}
const ids=/^[A-Za-z][A-Za-z0-9._-]{0,63}$/,languages=/^[a-z][a-z0-9+-]{0,31}$/;
export function normalizePath(input){
 if(typeof input!=='string'||input.length<1||input.length>240||input.includes('\\'))throw new CodeError('code.path');
 const parts=input.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||p.length>64||!/^[A-Za-z0-9_.-]+$/.test(p)||p.endsWith('.')||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new CodeError('code.path');return input;
}
export function validSourceText(text){if(typeof text!=='string'||text.length>100000)return false;for(let i=0;i<text.length;i++){const u=text.charCodeAt(i);if(u>=0xD800&&u<=0xDBFF){const v=text.charCodeAt(++i);if(!(v>=0xDC00&&v<=0xDFFF))return false;}else if(u>=0xDC00&&u<=0xDFFF)return false;}return true;}
export function isTextBoundary(text,index){if(!Number.isSafeInteger(index)||index<0||index>text.length)return false;const a=text.charCodeAt(index-1),b=text.charCodeAt(index);return !(a>=0xD800&&a<=0xDBFF&&b>=0xDC00&&b<=0xDFFF);}
function copy(v){const r=copyGeneratedJson(v,{maxBytes:2097152,maxDepth:32,maxCollectionSize:1000,maxStringLength:100000,maxNodes:50000});if(!r.valid)throw new CodeError('code.nonJson');return r.value;}
export function sourceBytes(files){return files.reduce((sum,f)=>sum+new TextEncoder().encode(f.text).byteLength,0);}
export function createWorkspacePorts({activity:input,validateConfig}){
 const config=copy(input);let checked;try{checked=validateConfig?.(config);}catch{}if(checked&&typeof checked.then==='function'){Promise.resolve(checked).catch(()=>{});throw new CodeError('code.config');}if(checked?.valid!==true)throw new CodeError('code.config');
 const entrypointId=config.files.find(f=>f.path===config.entrypoint).id;
 function initialState(activity){if(activity.type!=='interactive-project/code'||canonicalJson(activity.config)!==canonicalJson(config))throw new CodeError('code.activity');return copy({stateVersion:'1.0.0',language:config.language,entrypointId,files:config.files.map(f=>({...f,language:f.language??config.language,version:0})),deletedFileIds:[]});}
 function reduce(state,action){
  if(!action.type.startsWith('interactive-project/code.'))return{accepted:false};const kind=action.type.slice('interactive-project/code.'.length),p=action.payload,next={...state,files:state.files.map(f=>({...f})),deletedFileIds:[...state.deletedFileIds]};
  const file=next.files.find(f=>f.id===p.fileId),keys=Object.keys(p).sort().join(',');
  if(kind==='edit'&&keys==='expectedVersion,fileId,from,insert,to'&&file?.editable&&p.expectedVersion===file.version&&typeof p.insert==='string'&&p.insert.length<=4000&&validSourceText(p.insert)&&isTextBoundary(file.text,p.from)&&isTextBoundary(file.text,p.to)&&p.from<=p.to){file.text=file.text.slice(0,p.from)+p.insert+file.text.slice(p.to);file.version++;}
  else if(kind==='rename'&&keys==='fileId,path'&&config.permissions.rename&&file?.editable){try{normalizePath(p.path);}catch{return{accepted:false};}if(next.files.some(f=>f.id!==file.id&&f.path.toLowerCase()===p.path.toLowerCase())||file.path===p.path)return{accepted:false};file.path=p.path;file.version++;}
  else if(kind==='delete'&&keys==='fileId'&&config.permissions.delete&&file?.editable&&file.id!==state.entrypointId&&next.deletedFileIds.length<1000){next.files=next.files.filter(f=>f.id!==file.id);next.deletedFileIds.push(file.id);}
  else if(kind==='create'&&keys==='file'&&config.permissions.create&&next.files.length<100){
   const f=p.file;if(!f||Object.keys(f).some(k=>!['id','path','language','encoding','text'].includes(k))||typeof f.id!=='string'||!ids.test(f.id)||f.encoding!=='utf-8'||!validSourceText(f.text)||f.text.length>4000||(f.language!==undefined&&(typeof f.language!=='string'||!languages.test(f.language)))||next.files.some(x=>x.id===f.id)||next.deletedFileIds.includes(f.id))return{accepted:false};
   try{normalizePath(f.path);}catch{return{accepted:false};}if(next.files.some(x=>x.path.toLowerCase()===f.path.toLowerCase()))return{accepted:false};next.files.push({...f,language:f.language??config.language,editable:true,version:0});
  }else return{accepted:false};
  if(next.files.some(f=>!validSourceText(f.text))||sourceBytes(next.files)>1048576)return{accepted:false};return{accepted:true,state:copy(next)};
 }
 function evaluate(_state,context,revision){return{protocolVersion:'1.0.0',resultVersion:'1.0.0',activityId:context.identity.activityId,sessionId:context.identity.sessionId,...(context.identity.attemptId!==undefined?{attemptId:context.identity.attemptId}:{}),revision,evidence:[],status:'unevaluable',reason:'unassessed'};}
 return Object.freeze({initialState,reduce,evaluate});
}
export function resolveEntrypoint(workspace){const file=workspace.files.find(f=>f.id===workspace.entrypointId);if(!file)throw new CodeError('code.entrypoint');return file.path;}
