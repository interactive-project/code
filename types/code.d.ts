import type {ContentNode} from '@interactive-project/content-node';
import type {StatePorts} from '@interactive-project/core';
export interface CodeFile{id:string;path:string;language?:string;encoding:'utf-8';text:string;editable:boolean}
export interface CodeConfig{schemaVersion:'1.0.0';prompt:ContentNode;language:string;entrypoint:string;files:CodeFile[];permissions:{create:boolean;rename:boolean;delete:boolean}}
export interface WorkspaceFile extends CodeFile{language:string;version:number}
export interface WorkspaceState{stateVersion:'1.0.0';language:string;entrypointId:string;files:WorkspaceFile[];deletedFileIds:string[]}
export interface TextEdit{fileId:string;expectedVersion:number;from:number;to:number;insert:string}
export declare class CodeError extends Error{readonly code:string}
export declare function normalizePath(input:string):string;
export declare function validSourceText(input:unknown):boolean;
export declare function isTextBoundary(text:string,index:number):boolean;
export declare function sourceBytes(files:readonly {text:string}[]):number;
export declare function createWorkspacePorts(options:{activity:CodeConfig;validateConfig(input:unknown):{valid:boolean}}):StatePorts;
export declare function resolveEntrypoint(workspace:WorkspaceState):string;
