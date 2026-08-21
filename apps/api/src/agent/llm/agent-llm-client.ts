import type { AgentToolDefinition } from '../../tools/contracts/tool-definition';

export const AGENT_LLM_CLIENT = Symbol('AGENT_LLM_CLIENT');

export interface AgentFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface AgentToolOutput {
  callId: string;
  output: string;
}

export interface AgentLlmRequest {
  userMessage: string;
  previousResponseId: string | null;
  toolOutput: AgentToolOutput | null;
  tools: readonly AgentToolDefinition[];
}

export type AgentLlmResult =
  | {
      type: 'tool_call';
      responseId: string;
      toolCall: AgentFunctionCall;
    }
  | {
      type: 'final_answer';
      responseId: string;
      answer: string;
    };

export interface AgentLlmClient {
  createResponse(request: AgentLlmRequest): Promise<AgentLlmResult>;
}
