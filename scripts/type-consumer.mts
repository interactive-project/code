import {createWorkspacePorts,type CodeConfig,type WorkspaceState} from '../index.js';
import {validateCodeConfig} from '../validation/index.js';
import {createEditorBridge,type EditorDriver} from '../editor/index.js';
declare const config:CodeConfig;declare const workspace:WorkspaceState;declare const driver:EditorDriver;
createWorkspacePorts({activity:config,validateConfig:validateCodeConfig});
const bridge=createEditorBridge({getWorkspace:()=>workspace,applyEdit:()=>({status:'accepted',actionId:'id',revision:1})});bridge.replaceDriver(driver);bridge.dispose();

import {createExecutionCoordinator,type RunRequest} from '../execution/index.js';
import {createDockerProvider} from '../providers/docker/index.js';
declare const request:RunRequest;
const coordinator=createExecutionCoordinator({getCurrent:()=>request});coordinator.run(request);coordinator.dispose();void createDockerProvider;

import {createSubmission,createEvaluationClient} from '@interactive-project/code/evaluation';
import {createTrustedEvaluator} from '@interactive-project/code/evaluation/trusted';
void createSubmission;void createEvaluationClient;void createTrustedEvaluator;
