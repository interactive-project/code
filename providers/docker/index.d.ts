import type {ExecutionProvider} from '../../execution/index.js';
export declare function createDockerProvider(options:{image:string;runtimeVersion:string;binary?:string}):Promise<ExecutionProvider>;
