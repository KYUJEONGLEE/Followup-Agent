import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentWorkflowService } from './agent-workflow.service';
import { AGENT_LLM_CLIENT } from './llm/agent-llm-client';
import { OpenAiAgentLlmClient } from './llm/openai-agent-llm.client';

@Module({
  imports: [ToolsModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentWorkflowService,
    {
      provide: AGENT_LLM_CLIENT,
      useClass: OpenAiAgentLlmClient,
    },
  ],
  exports: [AgentWorkflowService],
})
export class AgentModule {}
