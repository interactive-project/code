import type {RunRequest} from '../execution/index.js';
import type {JsonValue} from '@interactive-project/protocol/types';
export interface EvaluationSignal {readonly aborted:boolean;addEventListener(type:'abort',listener:()=>void,options?:{once?:boolean}):void;removeEventListener(type:'abort',listener:()=>void):void}
export interface CryptoProvider {subtle:{digest(algorithm:string,data:Uint8Array):Promise<ArrayBuffer>}}
export interface Submission {readonly submissionVersion:'1.0.0';readonly submissionId:string;readonly fileDigest:string;readonly request:RunRequest}
export interface EvaluationReport {readonly submissionId:string;readonly fileDigest:string;readonly category:'completed'|'assertion-failed'|'compile-error'|'runtime-error'|'infrastructure-error'|'pending'|'cancelled'|'timed-out';readonly result:JsonValue}
export function createSubmission(request:RunRequest,submissionId:string,cryptoProvider:CryptoProvider):Promise<Submission>;
export function verifySubmission(input:unknown,cryptoProvider:CryptoProvider):Promise<Submission>;
export function createEvaluationClient(options:{remote:(submission:Submission,options:{signal:EvaluationSignal})=>unknown|Promise<unknown>;getCurrent:()=>{activityId:string;sessionId:string;attemptId?:string;generation:string;revision:number};cryptoProvider:CryptoProvider;validateResult:(input:unknown,expected:{activityId:string;sessionId:string;attemptId?:string})=>{valid:boolean};timeoutMs?:number;maxRecords?:number}):{evaluate(input:unknown):Promise<{ignored:boolean;duplicate?:boolean;report:EvaluationReport}>;getStatus():EvaluationReport|null;cancel():void;dispose():void;getRecords():readonly unknown[]};
