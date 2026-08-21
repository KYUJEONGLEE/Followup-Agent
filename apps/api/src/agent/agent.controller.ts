import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { AgentRunResponse } from './contracts/agent-run-response';
import { RunAgentRequestDto } from './contracts/run-agent-request.dto';
import { AgentService } from './agent.service';

@Controller('agent/runs')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post()
  @HttpCode(200)
  run(@Body() request: RunAgentRequestDto): Promise<AgentRunResponse> {
    return this.agentService.run(request.message);
  }
}
