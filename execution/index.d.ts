import type {CancellationSignal,MaybePromise} from '@interactive-project/protocol/interoperability';
export interface RunLimits{wallTimeMs:number;memoryBytes:number;outputBytes:number;workspaceBytes:number;processes:number;scratchBytes:number}
export interface RunRequest{executionVersion:'1.0.0';executionId:string;activityId:string;sessionId:string;attemptId?:string;generation:string;revision:number;language:string;runtime:{id:string;version:string};entrypoint:string;files:{id:string;path:string;encoding:'utf-8';text:string}[];limits:RunLimits;filesystem:'read-only-workspace';network:'none'}
export interface OutputMessage{executionVersion:'1.0.0';executionId:string;sequence:number;channel:'stdout'|'stderr';text:string}
export interface Terminal{executionVersion:'1.0.0';executionId:string;status:'completed'|'failed'|'timed-out'|'cancelled';reason?:'runtime-error'|'provider-error'|'output-limit'|'memory-limit'|'cancelled'|'timeout'|'permission'|'driver-missing'|'cleanup-incomplete';exitCode?:number;cleanupComplete:boolean}
export interface ExecutionManifest{providerVersion:'1.0.0';id:string;isolation:'container'|'remote-sandbox';enforced:Record<'time'|'memory'|'output'|'filesystem'|'network'|'processes',true>;limits?:RunLimits;requiredPermissions?:('execution'|'network')[];runtimes:{id:string;version:string;languages:string[]}[]}
export interface ExecutionProvider{manifest:ExecutionManifest;run(request:RunRequest,options:{signal:CancellationSignal;onMessage(message:OutputMessage):void}):MaybePromise<Terminal>}
export interface ExecutionOutcome{terminal:Terminal;messages:readonly OutputMessage[];ignored:boolean;duplicate?:boolean}
export declare const executionLimits:Readonly<RunLimits>;
export declare function prepareRunRequest(input:unknown):Readonly<RunRequest>;
export declare function validateTerminal(input:unknown,request:RunRequest):{valid:boolean};
export declare function createExecutionCoordinator(options:{getCurrent():{activityId:string;sessionId:string;attemptId?:string;generation:string;revision:number};provider?:ExecutionProvider;policy?:{execution?:boolean;network?:boolean};maxRecords?:number;cleanupTimeoutMs?:number;onMessage?(message:OutputMessage):unknown;onTerminal?(outcome:ExecutionOutcome):unknown}):Readonly<{run(request:RunRequest):Promise<ExecutionOutcome>;cancel():void;dispose():void;getRecords():readonly ExecutionOutcome[]}>;
