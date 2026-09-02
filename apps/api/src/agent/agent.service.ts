import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { EnvironmentVariables } from '../config/env.validation';
import type { AgentRunResponse } from './contracts/agent-run-response';
import type { RunAgentRequestDto } from './contracts/run-agent-request.dto';
import type {
  ApprovalDecision,
  WriteApprovalMode,
} from './contracts/write-approval';
import { AgentWorkflowService } from './agent-workflow.service';

@Injectable()
export class AgentService {
  constructor(
    private readonly workflow: AgentWorkflowService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  run(request: RunAgentRequestDto): Promise<AgentRunResponse> {
    return this.workflow.run(
      randomUUID(),
      request.message,
      this.resolveWriteApprovalMode(request.writeApprovalMode),
    );
  }

  resume(
    executionId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<AgentRunResponse> {
    return this.workflow.resume(executionId, approvalId, decision);
  }

  private resolveWriteApprovalMode(
    requestedMode: WriteApprovalMode,
  ): WriteApprovalMode {
    const allowAutoWrite = this.config.get('AGENT_ALLOW_AUTO_WRITE', {
      infer: true,
    });

    return requestedMode === 'auto' && allowAutoWrite ? 'auto' : 'required';
  }
}
