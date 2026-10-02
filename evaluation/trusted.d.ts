import type {Submission,CryptoProvider,EvaluationReport,EvaluationSignal} from './index.js';
export interface TestCase {readonly id:string;readonly input:string;readonly expected:string;readonly weight:number}
export interface TestSuite {readonly testVersion:'1.0.0';readonly cases:readonly TestCase[]}
export function prepareTests(input:unknown):TestSuite;
export function createTrustedEvaluator(options:{tests:unknown;visibility?:'public'|'private';cryptoProvider:CryptoProvider;retries?:number;runCase:(submission:Submission,test:TestCase,options:{signal?:EvaluationSignal;attempt:number})=>unknown|Promise<unknown>}):{evaluate(input:unknown,options?:{signal?:EvaluationSignal}):Promise<EvaluationReport & {cases?:readonly {id:string;status:string;credit:number}[]}>};
