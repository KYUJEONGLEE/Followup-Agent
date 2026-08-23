import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { AgentRunResponse } from './contracts/agent-run-response';
import { ResumeAgentRequestDto } from './contracts/resume-agent-request.dto';
import { RunAgentRequestDto } from './contracts/run-agent-request.dto';
import { AgentService } from './agent.service';

@Controller('agent/runs')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post()
  @HttpCode(200)
  run(@Body() request: RunAgentRequestDto): Promise<AgentRunResponse> {
    return this.agentService.run(request);
  }

  @Post(':executionId/approval')
  @HttpCode(200)
  resume(
    @Param('executionId', new ParseUUIDPipe({ version: '4' }))
    executionId: string,
    @Body() request: ResumeAgentRequestDto,
  ): Promise<AgentRunResponse> {
    return this.agentService.resume(executionId, request.decision);
  }
}
