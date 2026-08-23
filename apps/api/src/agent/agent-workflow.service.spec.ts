import { describe, expect, it } from '@jest/globals';
import { createGetConsultationsTool } from '../tools/read/get-consultations.tool';
import { createGetCustomerTool } from '../tools/read/get-customer.tool';
import { ToolRegistry } from '../tools/tool-registry';
import {
  createFollowUpTaskTool,
  type FollowUpTaskWriter,
} from '../tools/write/create-follow-up-task.tool';
import type {
  AgentLlmClient,
  AgentLlmRequest,
  AgentLlmResult,
} from './llm/agent-llm-client';
import { AgentWorkflowService } from './agent-workflow.service';

class ScriptedLlmClient implements AgentLlmClient {
  readonly requests: AgentLlmRequest[] = [];
  private nextResultIndex = 0;

  constructor(private readonly results: readonly AgentLlmResult[]) {}

  createResponse(request: AgentLlmRequest): Promise<AgentLlmResult> {
    this.requests.push(request);
    const result = this.results[this.nextResultIndex];
    this.nextResultIndex += 1;

    if (!result) {
      throw new Error('준비된 LLM 응답이 없습니다.');
    }

    return Promise.resolve(result);
  }
}

function createReadTools() {
  const customerTool = createGetCustomerTool({
    findActiveByName(name) {
      return Promise.resolve(
        name === '김민수'
        ? [
            {
              id: 'C001',
              name: '김민수',
              status: 'active',
              lastVisitAt: '2026-08-01T00:00:00.000Z',
            },
          ]
        : [],
      );
    },
  });
  const consultationsTool = createGetConsultationsTool({
    findByCustomerCode(customerId) {
      return Promise.resolve(
        customerId === 'C001'
        ? {
            customerId,
            consultations: [
              {
                id: 'CONS001',
                consultedAt: '2026-08-01T00:00:00.000Z',
                summary: '다음 상담 전 생활 습관 확인 필요',
              },
            ],
          }
        : null,
      );
    },
  });

  return [customerTool, consultationsTool];
}

function createToolRegistry(): ToolRegistry {
  return new ToolRegistry(createReadTools());
}

class RecordingFollowUpTaskWriter implements FollowUpTaskWriter {
  readonly inputs: Parameters<FollowUpTaskWriter['create']>[0][] = [];

  create(
    input: Parameters<FollowUpTaskWriter['create']>[0],
  ): ReturnType<FollowUpTaskWriter['create']> {
    this.inputs.push(input);

    return Promise.resolve({
      status: this.inputs.length === 1 ? 'created' : 'existing',
      task: {
        id: 'task-1',
        customerId: input.customerId,
        sourceConsultationId: input.sourceConsultationId,
        title: input.title,
        description: input.description,
        status: 'pending',
        dueAt: input.dueAt,
        createdAt: '2026-08-23T00:00:00.000Z',
      },
    });
  }
}

function createWriteToolRegistry(writer: FollowUpTaskWriter): ToolRegistry {
  return new ToolRegistry([
    ...createReadTools(),
    createFollowUpTaskTool(writer),
  ]);
}

describe('AgentWorkflowService', () => {
  it('Tool 호출이 없으면 LLM Node에서 바로 종료한다', async () => {
    const llm = new ScriptedLlmClient([
      {
        type: 'final_answer',
        responseId: 'response-1',
        answer: '안녕하세요!',
      },
    ]);
    const workflow = new AgentWorkflowService(llm, createToolRegistry());

    const result = await workflow.run('execution-1', '안녕하세요.');

    expect(result).toEqual({
      executionId: 'execution-1',
      status: 'completed',
      answer: '안녕하세요!',
      approval: null,
      writeApprovalMode: 'required',
      trace: [{ sequence: 1, type: 'node', name: 'llm' }],
    });
    expect(llm.requests).toHaveLength(1);
  });

  it('단일 Tool 결과를 LLM에 반환한 뒤 최종 답변으로 종료한다', async () => {
    const llm = new ScriptedLlmClient([
      {
        type: 'tool_call',
        responseId: 'response-1',
        toolCall: {
          callId: 'call-1',
          name: 'get_customer',
          arguments: JSON.stringify({ name: '김민수' }),
        },
      },
      {
        type: 'final_answer',
        responseId: 'response-2',
        answer: '김민수 고객은 active 상태입니다.',
      },
    ]);
    const workflow = new AgentWorkflowService(llm, createToolRegistry());

    const result = await workflow.run(
      'execution-2',
      '김민수 고객 정보를 알려줘.',
    );

    expect(result.trace).toEqual([
      { sequence: 1, type: 'node', name: 'llm' },
      {
        sequence: 2,
        type: 'tool',
        name: 'get_customer',
        arguments: { name: '김민수' },
      },
      { sequence: 3, type: 'node', name: 'llm' },
    ]);
    expect(llm.requests[1]?.previousResponseId).toBe('response-1');
    expect(llm.requests[1]?.toolOutput).toEqual(
      expect.objectContaining({ callId: 'call-1' }),
    );
    expect(llm.requests[1]?.toolOutput?.output).toContain('C001');
  });

  it('첫 Tool의 C001을 전달하고 모델이 선택한 두 번째 Tool을 실행한다', async () => {
    const llm = new ScriptedLlmClient([
      {
        type: 'tool_call',
        responseId: 'response-1',
        toolCall: {
          callId: 'call-1',
          name: 'get_customer',
          arguments: JSON.stringify({ name: '김민수' }),
        },
      },
      {
        type: 'tool_call',
        responseId: 'response-2',
        toolCall: {
          callId: 'call-2',
          name: 'get_consultations',
          arguments: JSON.stringify({ customer_id: 'C001' }),
        },
      },
      {
        type: 'final_answer',
        responseId: 'response-3',
        answer: '김민수 고객의 기본 정보와 최근 상담 내용입니다.',
      },
    ]);
    const workflow = new AgentWorkflowService(llm, createToolRegistry());

    const result = await workflow.run(
      'execution-3',
      '김민수 고객의 기본 정보와 최근 상담 내용을 같이 알려줘.',
    );

    expect(result.trace).toEqual([
      { sequence: 1, type: 'node', name: 'llm' },
      {
        sequence: 2,
        type: 'tool',
        name: 'get_customer',
        arguments: { name: '김민수' },
      },
      { sequence: 3, type: 'node', name: 'llm' },
      {
        sequence: 4,
        type: 'tool',
        name: 'get_consultations',
        arguments: { customer_id: 'C001' },
      },
      { sequence: 5, type: 'node', name: 'llm' },
    ]);
    expect(llm.requests[1]?.toolOutput?.output).toContain('C001');
    expect(llm.requests[2]?.toolOutput?.output).toContain('CONS001');
  });

  it('required Write는 중단되고 승인 후 정확히 한 번 실행된다', async () => {
    const writer = new RecordingFollowUpTaskWriter();
    const llm = new ScriptedLlmClient([
      {
        type: 'tool_call',
        responseId: 'response-write-1',
        toolCall: {
          callId: 'call-write-1',
          name: 'create_follow_up_task',
          arguments: JSON.stringify({
            customer_id: 'C001',
            source_consultation_id: 'CONS001',
            title: '생활 습관 확인',
            description: '다음 상담 전 확인',
            due_at: null,
          }),
        },
      },
      {
        type: 'final_answer',
        responseId: 'response-write-2',
        answer: '후속 업무를 생성했습니다.',
      },
    ]);
    const workflow = new AgentWorkflowService(
      llm,
      createWriteToolRegistry(writer),
    );

    const awaiting = await workflow.run(
      'execution-write-required',
      '김민수 고객의 후속 업무를 만들어줘.',
      'required',
    );

    expect(awaiting).toEqual({
      executionId: 'execution-write-required',
      status: 'awaiting_approval',
      answer: null,
      approval: {
        toolName: 'create_follow_up_task',
        arguments: {
          customer_id: 'C001',
          source_consultation_id: 'CONS001',
          title: '생활 습관 확인',
          description: '다음 상담 전 확인',
          due_at: null,
        },
      },
      writeApprovalMode: 'required',
      trace: [
        { sequence: 1, type: 'node', name: 'llm' },
        {
          sequence: 2,
          type: 'approval',
          decision: 'requested',
          mode: 'required',
          toolName: 'create_follow_up_task',
        },
      ],
    });
    expect(writer.inputs).toHaveLength(0);
    expect(llm.requests).toHaveLength(1);

    const [approved, concurrentDuplicate] = await Promise.all([
      workflow.resume('execution-write-required', 'approve'),
      workflow.resume('execution-write-required', 'approve'),
    ]);

    expect(approved.status).toBe('completed');
    expect(approved.answer).toBe('후속 업무를 생성했습니다.');
    expect(approved.trace).toEqual([
      { sequence: 1, type: 'node', name: 'llm' },
      {
        sequence: 2,
        type: 'approval',
        decision: 'requested',
        mode: 'required',
        toolName: 'create_follow_up_task',
      },
      {
        sequence: 3,
        type: 'approval',
        decision: 'approved',
        mode: 'required',
        toolName: 'create_follow_up_task',
      },
      {
        sequence: 4,
        type: 'tool',
        name: 'create_follow_up_task',
        arguments: expect.objectContaining({ customer_id: 'C001' }),
      },
      { sequence: 5, type: 'node', name: 'llm' },
    ]);
    expect(writer.inputs).toHaveLength(1);
    expect(llm.requests[1]?.toolOutput?.output).toContain('task-1');
    expect(concurrentDuplicate).toEqual(approved);

    const sequentialDuplicate = await workflow.resume(
      'execution-write-required',
      'approve',
    );

    expect(sequentialDuplicate).toEqual(approved);
    expect(writer.inputs).toHaveLength(1);
    expect(llm.requests).toHaveLength(2);
  });

  it('Write 요청을 거절하면 Tool을 실행하지 않고 종료한다', async () => {
    const writer = new RecordingFollowUpTaskWriter();
    const llm = new ScriptedLlmClient([
      {
        type: 'tool_call',
        responseId: 'response-reject-1',
        toolCall: {
          callId: 'call-reject-1',
          name: 'create_follow_up_task',
          arguments: JSON.stringify({
            customer_id: 'C001',
            source_consultation_id: null,
            title: '거절할 업무',
            description: null,
            due_at: null,
          }),
        },
      },
    ]);
    const workflow = new AgentWorkflowService(
      llm,
      createWriteToolRegistry(writer),
    );

    await workflow.run(
      'execution-write-reject',
      '후속 업무를 만들어줘.',
      'required',
    );
    const rejected = await workflow.resume(
      'execution-write-reject',
      'reject',
    );

    expect(rejected.status).toBe('rejected');
    expect(rejected.answer).toContain('거절');
    expect(rejected.trace.at(-1)).toEqual({
      sequence: 3,
      type: 'approval',
      decision: 'rejected',
      mode: 'required',
      toolName: 'create_follow_up_task',
    });
    expect(writer.inputs).toHaveLength(0);
    expect(llm.requests).toHaveLength(1);

    await expect(
      workflow.resume('execution-write-reject', 'approve'),
    ).rejects.toThrow('이미 반대 승인 결정으로 완료된 실행입니다.');
  });

  it('auto Write는 승인 중단 없이 즉시 실행된다', async () => {
    const writer = new RecordingFollowUpTaskWriter();
    const llm = new ScriptedLlmClient([
      {
        type: 'tool_call',
        responseId: 'response-auto-1',
        toolCall: {
          callId: 'call-auto-1',
          name: 'create_follow_up_task',
          arguments: JSON.stringify({
            customer_id: 'C001',
            source_consultation_id: null,
            title: '자동 실행 업무',
            description: null,
            due_at: null,
          }),
        },
      },
      {
        type: 'final_answer',
        responseId: 'response-auto-2',
        answer: '자동으로 후속 업무를 생성했습니다.',
      },
    ]);
    const workflow = new AgentWorkflowService(
      llm,
      createWriteToolRegistry(writer),
    );

    const result = await workflow.run(
      'execution-write-auto',
      '후속 업무를 바로 만들어줘.',
      'auto',
    );

    expect(result.status).toBe('completed');
    expect(result.writeApprovalMode).toBe('auto');
    expect(result.trace).toEqual([
      { sequence: 1, type: 'node', name: 'llm' },
      {
        sequence: 2,
        type: 'approval',
        decision: 'approved',
        mode: 'auto',
        toolName: 'create_follow_up_task',
      },
      {
        sequence: 3,
        type: 'tool',
        name: 'create_follow_up_task',
        arguments: expect.objectContaining({ customer_id: 'C001' }),
      },
      { sequence: 4, type: 'node', name: 'llm' },
    ]);
    expect(writer.inputs).toHaveLength(1);
  });
});
