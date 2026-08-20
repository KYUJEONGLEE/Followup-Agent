import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { AgentToolDefinition } from '../../tools/contracts/tool-definition';
import type {
  AgentLlmClient,
  AgentLlmRequest,
  AgentLlmResult,
} from './agent-llm-client';

const AGENT_INSTRUCTIONS = [
  '사용자 요청에 정확히 답하기 위해 필요한 경우에만 제공된 Tool을 사용하세요.',
  'Tool 결과가 없으면 고객 정보나 상담 이력을 추측하거나 만들어내지 마세요.',
  'Tool 결과를 받으면 그 결과를 바탕으로 짧고 명확하게 답하세요.',
].join(' ');

@Injectable()
export class OpenAiAgentLlmClient implements AgentLlmClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(configService: ConfigService<EnvironmentVariables, true>) {
    this.client = new OpenAI({
      apiKey: configService.get('OPENAI_API_KEY', { infer: true }),
    });
    this.model = configService.get('OPENAI_MODEL', { infer: true });
  }

  async createResponse(request: AgentLlmRequest): Promise<AgentLlmResult> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: AGENT_INSTRUCTIONS,
      input: this.createInput(request),
      ...(request.previousResponseId
        ? { previous_response_id: request.previousResponseId }
        : {}),
      tools: this.toOpenAiTools(request.tools),
      parallel_tool_calls: false,
    });
    const functionCall = response.output.find(
      (item) => item.type === 'function_call',
    );

    if (!functionCall) {
      return {
        type: 'final_answer',
        responseId: response.id,
        answer: response.output_text,
      };
    }

    return {
      type: 'tool_call',
      responseId: response.id,
      toolCall: {
        callId: functionCall.call_id,
        name: functionCall.name,
        arguments: functionCall.arguments,
      },
    };
  }

  private createInput(
    request: AgentLlmRequest,
  ): string | OpenAI.Responses.ResponseInput {
    if (!request.previousResponseId) {
      return request.userMessage;
    }

    if (!request.toolOutput) {
      throw new Error('이전 LLM 응답에 전달할 Tool 결과가 없습니다.');
    }

    return [
      {
        type: 'function_call_output',
        call_id: request.toolOutput.callId,
        output: request.toolOutput.output,
      },
    ];
  }

  private toOpenAiTools(
    tools: readonly AgentToolDefinition[],
  ): OpenAI.Responses.Tool[] {
    return tools.map((tool) => ({
      type: tool.type,
      name: tool.name,
      description: tool.description,
      parameters: { ...tool.parameters },
      strict: tool.strict,
    }));
  }
}
