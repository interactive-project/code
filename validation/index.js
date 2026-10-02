import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
import {validateContent} from '@interactive-project/content-node/validation';
import {normalizePath,validSourceText,sourceBytes} from '../index.js';
const require=createRequire(import.meta.url),ajv=new Ajv2020({strict:true,allErrors:true,ownProperties:true});addFormats(ajv);
for(const name of ['@interactive-project/protocol/schemas/shared-content.v1.schema.json','@interactive-project/content-node/schemas/content-node.v1.schema.json'])ajv.addSchema(JSON.parse(readFileSync(require.resolve(name))));
const validate=ajv.compile(JSON.parse(readFileSync(new URL('../schemas/code-activity.v1.schema.json',import.meta.url))));
const error=(code,path)=>({code,path,severity:'error',message:'The code activity violates its declared contract.'});
export function validateCodeConfig(input){
 const copied=copyGeneratedJson(input,{maxBytes:2097152,maxDepth:32,maxCollectionSize:1000,maxStringLength:100000,maxNodes:50000});if(!copied.valid)return{valid:false,diagnostics:copied.diagnostics};const config=copied.value;if(!validate(config))return{valid:false,diagnostics:[error('code.schema','')]};
 const diagnostics=[],ids=new Set(),paths=new Set();const content=validateContent(config.prompt);if(!content.valid)diagnostics.push(...content.diagnostics.map(d=>({...d,path:'/prompt'+d.path})));
 config.files.forEach((f,i)=>{const path='/files/'+i;if(ids.has(f.id))diagnostics.push(error('code.duplicateId',path+'/id'));ids.add(f.id);try{normalizePath(f.path);}catch{diagnostics.push(error('code.path',path+'/path'));}const canonical=f.path.toLowerCase();if(paths.has(canonical))diagnostics.push(error('code.duplicatePath',path+'/path'));paths.add(canonical);if(!validSourceText(f.text))diagnostics.push(error('code.text',path+'/text'));});
 try{normalizePath(config.entrypoint);}catch{diagnostics.push(error('code.path','/entrypoint'));}
 if(!config.files.some(f=>f.path===config.entrypoint))diagnostics.push(error('code.entrypoint','/entrypoint'));if(sourceBytes(config.files)>1048576)diagnostics.push(error('code.size','/files'));
 return diagnostics.length?{valid:false,diagnostics}:{valid:true,diagnostics:[]};
}
