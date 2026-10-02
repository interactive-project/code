import {createWorkspacePorts,type CodeConfig,type WorkspaceState} from '../index.js';
import {validateCodeConfig} from '../validation/index.js';
import {createEditorBridge,type EditorDriver} from '../editor/index.js';
declare const config:CodeConfig;declare const workspace:WorkspaceState;declare const driver:EditorDriver;
createWorkspacePorts({activity:config,validateConfig:validateCodeConfig});
const bridge=createEditorBridge({getWorkspace:()=>workspace,applyEdit:()=>({status:'accepted',actionId:'id',revision:1})});bridge.replaceDriver(driver);bridge.dispose();
