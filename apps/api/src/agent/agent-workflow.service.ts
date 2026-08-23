import { Inject, Injectable } from '@nestjs/common';
import {
  END,
  START,
  type GraphNode,
  StateGraph,
  StateSchema,
} from '@langchain/langgraph';
import { z } from 'zod/v4';
import type {
  AgentRunResponse,
  AgentTraceEntry,
} from './contracts/agent-run-response';
import {
  AGENT_LLM_CLIENT,
  type AgentLlmClient,
} from './llm/agent-llm-client';
import { ToolRegistry } from '../tools/tool-registry';
import type { WriteApprovalMode } from './contracts/write-approval';

const AGENT_RECURSION_LIMIT = 10;

const pendingToolCallSchema = z.object({
  callId: z.string(),
  name: z.string(),
  arguments: z.string(),
});

const toolOutputSchema = z.object({
  callId: z.string(),
  output: z.string(),
});

const traceEntrySchema = z.discriminatedUnion('type', [
  z.object({
    sequence: z.number().int().positive(),
    type: z.literal('node'),
    name: z.string(),
  }),
  z.object({
    sequence: z.number().int().positive(),
    type: z.literal('tool'),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
  z.object({
    sequence: z.number().int().positive(),
    type: z.literal('approval'),
    decision: z.enum(['requested', 'approved', 'rejected']),
    mode: z.enum(['required', 'auto']),
    toolName: z.string(),
  }),
]);

const agentStateSchema = new StateSchema({
  executionId: z.string(),
  userMessage: z.string(),
  previousResponseId: z.string().nullable().default(null),
  pendingToolCall: pendingToolCallSchema.nullable().default(null),
  toolOutput: toolOutputSchema.nullable().default(null),
  finalAnswer: z.string().default(''),
  trace: z.array(traceEntrySchema).default([]),
});

function createAgentGraph(
  llmClient: AgentLlmClient,
  toolRegistry: ToolRegistry,
) {
  const callLlm: GraphNode<typeof agentStateSchema> = async (state) => {
    const result = await llmClient.createResponse({
      userMessage: state.userMessage,
      previousResponseId: state.previousResponseId,
      toolOutput: state.toolOutput,
      tools: toolRegistry.listDefinitions(),
    });
    const trace: AgentTraceEntry[] = [
      ...state.trace,
      {
        sequence: state.trace.length + 1,
        type: 'node',
        name: 'llm',
      },
    ];

    if (result.type === 'final_answer') {
      return {
        previousResponseId: result.responseId,
        pendingToolCall: null,
        toolOutput: null,
        finalAnswer: result.answer,
        trace,
      };
    }

    return {
      previousResponseId: result.responseId,
      pendingToolCall: result.toolCall,
      toolOutput: null,
      trace,
    };
  };

  const executeTool: GraphNode<typeof agentStateSchema> = async (state) => {
    if (!state.pendingToolCall) {
      throw new Error('실행할 Tool 호출이 없습니다.');
    }

    const toolResult = await toolRegistry.execute(
      state.pendingToolCall,
      state.executionId,
    );
    const trace: AgentTraceEntry[] = [
      ...state.trace,
      {
        sequence: state.trace.length + 1,
        type: 'tool',
        name: toolResult.name,
        arguments: toolResult.arguments,
      },
    ];

    return {
      pendingToolCall: null,
      toolOutput: {
        callId: toolResult.callId,
        output: JSON.stringify(toolResult.result),
      },
      trace,
    };
  };

  return new StateGraph(agentStateSchema)
    .addNode('call_llm', callLlm)
    .addNode('execute_tool', executeTool)
    .addEdge(START, 'call_llm')
    .addConditionalEdges('call_llm', (state) =>
      state.pendingToolCall ? 'execute_tool' : END,
    )
    .addEdge('execute_tool', 'call_llm')
    .compile();
}

@Injectable()
export class AgentWorkflowService {
  private readonly graph: ReturnType<typeof createAgentGraph>;

  constructor(
    @Inject(AGENT_LLM_CLIENT) llmClient: AgentLlmClient,
    toolRegistry: ToolRegistry,
  ) {
    this.graph = createAgentGraph(llmClient, toolRegistry);
  }

  async run(
    executionId: string,
    userMessage: string,
    writeApprovalMode: WriteApprovalMode = 'required',
  ): Promise<AgentRunResponse> {
    const state = await this.graph.invoke(
      {
        executionId,
        userMessage,
      },
      { recursionLimit: AGENT_RECURSION_LIMIT },
    );

    return {
      executionId,
      status: 'completed',
      answer: state.finalAnswer,
      approval: null,
      writeApprovalMode,
      trace: state.trace,
    };
  }
}
