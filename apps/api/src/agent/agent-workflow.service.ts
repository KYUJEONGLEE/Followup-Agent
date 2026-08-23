import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Command,
  END,
  interrupt,
  MemorySaver,
  START,
  type GraphNode,
  StateGraph,
  StateSchema,
} from '@langchain/langgraph';
import { z } from 'zod/v4';
import { ToolRegistry } from '../tools/tool-registry';
import type {
  AgentRunResponse,
  AgentTraceEntry,
  PendingApproval,
} from './contracts/agent-run-response';
import type {
  ApprovalDecision,
  WriteApprovalMode,
} from './contracts/write-approval';
import {
  AGENT_LLM_CLIENT,
  type AgentLlmClient,
} from './llm/agent-llm-client';

const AGENT_RECURSION_LIMIT = 20;

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

const approvalStateSchema = z.object({
  status: z.enum(['none', 'pending', 'approved', 'rejected']),
  mode: z.enum(['required', 'auto']).nullable(),
  toolName: z.string().nullable(),
  arguments: z.record(z.string(), z.unknown()).nullable(),
});

const emptyApprovalState = {
  status: 'none',
  mode: null,
  toolName: null,
  arguments: null,
} as const;

const agentStateFields = {
  executionId: z.string(),
  userMessage: z.string(),
  writeApprovalMode: z.enum(['required', 'auto']).default('required'),
  previousResponseId: z.string().nullable().default(null),
  pendingToolCall: pendingToolCallSchema.nullable().default(null),
  toolOutput: toolOutputSchema.nullable().default(null),
  approval: approvalStateSchema.default(emptyApprovalState),
  finalAnswer: z.string().default(''),
  trace: z.array(traceEntrySchema).default([]),
};

const agentStateSchema = new StateSchema(agentStateFields);
const agentStateValueSchema = z.object(agentStateFields);
type AgentWorkflowState = z.infer<typeof agentStateValueSchema>;

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

  const requestApproval: GraphNode<typeof agentStateSchema> = (state) => {
    if (!state.pendingToolCall) {
      throw new Error('승인을 요청할 Write Tool 호출이 없습니다.');
    }

    const toolArguments = toolRegistry.parseCallArguments(
      state.pendingToolCall,
    );

    return {
      approval: {
        status: 'pending',
        mode: 'required',
        toolName: state.pendingToolCall.name,
        arguments: toolArguments,
      },
      trace: [
        ...state.trace,
        {
          sequence: state.trace.length + 1,
          type: 'approval',
          decision: 'requested',
          mode: 'required',
          toolName: state.pendingToolCall.name,
        },
      ],
    };
  };

  const awaitApproval: GraphNode<typeof agentStateSchema> = (state) => {
    if (
      state.approval.status !== 'pending' ||
      !state.approval.toolName ||
      !state.approval.arguments
    ) {
      throw new Error('재개할 승인 대기 상태가 없습니다.');
    }

    const decision = interrupt<PendingApproval, ApprovalDecision>({
      toolName: state.approval.toolName,
      arguments: state.approval.arguments,
    });
    const isApproved = decision === 'approve';

    return {
      ...(isApproved
        ? {}
        : {
            pendingToolCall: null,
            finalAnswer: '사용자가 데이터 변경 요청을 거절했습니다.',
          }),
      approval: {
        ...state.approval,
        status: isApproved ? ('approved' as const) : ('rejected' as const),
      },
      trace: [
        ...state.trace,
        {
          sequence: state.trace.length + 1,
          type: 'approval',
          decision: isApproved ? ('approved' as const) : ('rejected' as const),
          mode: 'required',
          toolName: state.approval.toolName,
        },
      ],
    };
  };

  const approveWriteAutomatically: GraphNode<typeof agentStateSchema> = (
    state,
  ) => {
    if (!state.pendingToolCall) {
      throw new Error('자동 승인할 Write Tool 호출이 없습니다.');
    }

    const toolArguments = toolRegistry.parseCallArguments(
      state.pendingToolCall,
    );

    return {
      approval: {
        status: 'approved',
        mode: 'auto',
        toolName: state.pendingToolCall.name,
        arguments: toolArguments,
      },
      trace: [
        ...state.trace,
        {
          sequence: state.trace.length + 1,
          type: 'approval',
          decision: 'approved',
          mode: 'auto',
          toolName: state.pendingToolCall.name,
        },
      ],
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
    .addNode('request_approval', requestApproval)
    .addNode('await_approval', awaitApproval)
    .addNode('approve_write_automatically', approveWriteAutomatically)
    .addNode('execute_tool', executeTool)
    .addEdge(START, 'call_llm')
    .addConditionalEdges('call_llm', (state) => {
      if (!state.pendingToolCall) {
        return END;
      }

      if (toolRegistry.getEffect(state.pendingToolCall.name) === 'read') {
        return 'execute_tool';
      }

      return state.writeApprovalMode === 'auto'
        ? 'approve_write_automatically'
        : 'request_approval';
    })
    .addEdge('request_approval', 'await_approval')
    .addConditionalEdges('await_approval', (state) =>
      state.approval.status === 'approved' ? 'execute_tool' : END,
    )
    .addEdge('approve_write_automatically', 'execute_tool')
    .addEdge('execute_tool', 'call_llm')
    .compile({ checkpointer: new MemorySaver() });
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
    await this.graph.invoke(
      {
        executionId,
        userMessage,
        writeApprovalMode,
      },
      this.createGraphConfig(executionId),
    );

    return this.getResponse(executionId);
  }

  async resume(
    executionId: string,
    decision: ApprovalDecision,
  ): Promise<AgentRunResponse> {
    const state = await this.getState(executionId);

    if (state.approval.mode !== 'required') {
      throw new ConflictException('사용자 승인이 필요한 실행이 아닙니다.');
    }

    if (state.approval.status !== 'pending') {
      const previousDecision =
        state.approval.status === 'approved' ? 'approve' : 'reject';

      if (previousDecision === decision) {
        return this.toResponse(state);
      }

      throw new ConflictException('이미 반대 승인 결정으로 완료된 실행입니다.');
    }

    await this.graph.invoke(
      new Command({ resume: decision }),
      this.createGraphConfig(executionId),
    );

    return this.getResponse(executionId);
  }

  private async getResponse(executionId: string): Promise<AgentRunResponse> {
    return this.toResponse(await this.getState(executionId));
  }

  private async getState(executionId: string): Promise<AgentWorkflowState> {
    const snapshot = await this.graph.getState(
      this.createGraphConfig(executionId),
    );
    const parsed = agentStateValueSchema.safeParse(snapshot.values);

    if (!parsed.success || parsed.data.executionId !== executionId) {
      throw new NotFoundException(
        `실행 ID ${executionId}의 승인 대기 상태를 찾을 수 없습니다.`,
      );
    }

    return parsed.data;
  }

  private toResponse(state: AgentWorkflowState): AgentRunResponse {
    if (
      state.approval.status === 'pending' &&
      state.approval.toolName &&
      state.approval.arguments
    ) {
      return {
        executionId: state.executionId,
        status: 'awaiting_approval',
        answer: null,
        approval: {
          toolName: state.approval.toolName,
          arguments: state.approval.arguments,
        },
        writeApprovalMode: state.writeApprovalMode,
        trace: state.trace,
      };
    }

    if (state.approval.status === 'rejected') {
      return {
        executionId: state.executionId,
        status: 'rejected',
        answer: state.finalAnswer,
        approval: null,
        writeApprovalMode: state.writeApprovalMode,
        trace: state.trace,
      };
    }

    return {
      executionId: state.executionId,
      status: 'completed',
      answer: state.finalAnswer,
      approval: null,
      writeApprovalMode: state.writeApprovalMode,
      trace: state.trace,
    };
  }

  private createGraphConfig(executionId: string) {
    return {
      configurable: { thread_id: executionId },
      recursionLimit: AGENT_RECURSION_LIMIT,
    };
  }
}
