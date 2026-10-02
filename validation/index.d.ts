export interface Diagnostic{code:string;path:string;severity:'error';message:string}
export declare function validateCodeConfig(input:unknown):{valid:boolean;diagnostics:Diagnostic[]};
