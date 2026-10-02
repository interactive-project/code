import type {MaybePromise,DispatchResult} from '@interactive-project/protocol/interoperability';
import type {WorkspaceState,TextEdit} from '../types/code.js';
export interface EditorFile{id:string;path:string;language:string;text:string;readOnly:boolean;version:number}
export interface Selection{fileId:string;anchor:number;head:number}
export interface EditorDiagnostic{fileId:string;from:number;to:number;severity:'error'|'warning'|'info';message:string}
export interface EditorSession{updateFiles(files:readonly EditorFile[]):MaybePromise<void>;setSelection(selection:Selection):MaybePromise<void>;setDiagnostics(diagnostics:readonly EditorDiagnostic[]):MaybePromise<void>;dispose():MaybePromise<void>}
export interface EditorDriver{id:string;create(context:{mount:unknown;files:readonly EditorFile[];onEdit(edit:TextEdit):Promise<boolean>;onSelection(selection:Selection):void}):MaybePromise<EditorSession>}
export declare function createEditorBridge(options:{getWorkspace():WorkspaceState;applyEdit(edit:TextEdit):MaybePromise<DispatchResult>;onSelection?(selection:Selection):unknown;onDiagnostic?(diagnostic:Readonly<{code:string}>):unknown}):Readonly<{replaceDriver(driver:EditorDriver,mount?:unknown):Promise<{installed:boolean;reason?:string}>;refresh():Promise<void>;setSelection(selection:Selection):Promise<void>;setDiagnostics(diagnostics:EditorDiagnostic[]):Promise<void>;dispose():void;getDriverId():string|null}>;
