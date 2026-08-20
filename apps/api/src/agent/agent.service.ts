import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AgentRunResponse } from './contracts/agent-run-response';
import { AgentWorkflowService } from './agent-workflow.service';

@Injectable()
export class AgentService {
  constructor(private readonly workflow: AgentWorkflowService) {}

  run(message: string): Promise<AgentRunResponse> {
    return this.workflow.run(randomUUID(), message);
  }
}
