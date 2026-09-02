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
import type { AgentRunResponse } from './contracts/agent-run-response';

function approvalIdOf(response: AgentRunResponse): string {
  if (response.status !== 'awaiting_approval') {
    throw new Error('승인 대기 응답이 아닙니다.');
  }
  return response.approval.id;
}

class ScriptedLlmClient implements AgentLlmClient {
  readonly requests: AgentLlmRequest[] = [];
  private nextResultIndex = 0;

  constructor(private readonly results: readonly (AgentLlmResult | Error)[]) {}

  createResponse(request: AgentLlmRequest): Promise<AgentLlmResult> {
    this.requests.push(request);
    const result = this.results[this.nextResultIndex];
    this.nextResultIndex += 1;

    if (!result) {
      throw new Error('준비된 LLM 응답이 없습니다.');
    }

    if (result instanceof Error) {
      return Promise.reject(result);
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
        id: expect.any(String),
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
      workflow.resume('execution-write-required', approvalIdOf(awaiting), 'approve'),
      workflow.resume('execution-write-required', approvalIdOf(awaiting), 'approve'),
      expect(workflow.resume('execution-write-required', 'another-id', 'approve'))
        .rejects.toThrow('다른 승인 요청을 이미 처리하고 있습니다.'),
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
      approvalIdOf(awaiting),
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

    const pendingRejected = await workflow.run(
      'execution-write-reject',
      '후속 업무를 만들어줘.',
      'required',
    );
    const rejected = await workflow.resume(
      'execution-write-reject',
      approvalIdOf(pendingRejected),
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
      workflow.resume('execution-write-reject', approvalIdOf(pendingRejected), 'approve'),
    ).rejects.toThrow('이미 반대 승인 결정이 적용된 실행입니다.');
  });

  it.each(['tool', 'final_answer'] as const)(
    '승인 후 %s 단계가 실패하면 재승인을 완료로 오인하지 않는다',
    async (failureStage) => {
      const recordedWriter = new RecordingFollowUpTaskWriter();
      let writeAttempts = 0;
      const writer: FollowUpTaskWriter = {
        create(input) {
          writeAttempts += 1;
          if (failureStage === 'tool') {
            return Promise.reject(new Error('테스트 DB 연결 실패'));
          }
          return recordedWriter.create(input);
        },
      };
      const llm = new ScriptedLlmClient([
        {
          type: 'tool_call',
          responseId: 'response-failure-1',
          toolCall: {
            callId: 'call-failure-1',
            name: 'create_follow_up_task',
            arguments: JSON.stringify({
              customer_id: 'C001',
              source_consultation_id: null,
              title: '실패 경로 검증',
              description: null,
              due_at: null,
            }),
          },
        },
        new Error('최종 응답 생성 실패'),
      ]);
      const workflow = new AgentWorkflowService(
        llm,
        createWriteToolRegistry(writer),
      );
      const executionId = `execution-failed-${failureStage}`;

      const pending = await workflow.run(executionId, '후속 업무를 만들어줘.');
      await expect(workflow.resume(executionId, approvalIdOf(pending), 'approve')).rejects.toThrow(
        failureStage === 'tool'
          ? 'create_follow_up_task Tool 실행에 실패했습니다.'
          : '최종 응답 생성 실패',
      );

      await expect(workflow.resume(executionId, approvalIdOf(pending), 'approve')).rejects.toThrow(
        '이전 승인 실행이 완료되지 않았습니다.',
      );
      await expect(workflow.resume(executionId, approvalIdOf(pending), 'reject')).rejects.toThrow(
        '이미 반대 승인 결정이 적용된 실행입니다.',
      );
      expect(writeAttempts).toBe(1);
      expect(recordedWriter.inputs).toHaveLength(failureStage === 'tool' ? 0 : 1);
      expect(llm.requests).toHaveLength(failureStage === 'tool' ? 1 : 2);
    },
  );

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

  it('첫 승인을 재전송해도 다음 Write를 승인하지 않는다', async () => {
    const writer = new RecordingFollowUpTaskWriter();
    const llm = new ScriptedLlmClient([
      ...['첫 번째 업무', '두 번째 업무'].map((title, index): AgentLlmResult => ({
        type: 'tool_call',
        responseId: `response-multiple-${index}`,
        toolCall: {
          callId: `call-multiple-${index}`,
          name: 'create_follow_up_task',
          arguments: JSON.stringify({
            customer_id: 'C001',
            source_consultation_id: null,
            title,
            description: null,
            due_at: null,
          }),
        },
      })),
      { type: 'final_answer', responseId: 'response-done', answer: '두 업무를 생성했습니다.' },
    ]);
    const workflow = new AgentWorkflowService(llm, createWriteToolRegistry(writer));
    const firstApproval = await workflow.run('execution-multiple-writes', '후속 업무 두 개를 만들어줘.');
    const firstApprovalId = approvalIdOf(firstApproval);

    await expect(workflow.resume('execution-multiple-writes', 'wrong-id', 'approve'))
      .rejects.toThrow('현재 승인 대상과 일치하지 않는 승인 ID입니다.');
    expect(writer.inputs).toHaveLength(0);

    const secondApproval = await workflow.resume('execution-multiple-writes', firstApprovalId, 'approve');
    expect(secondApproval.status).toBe('awaiting_approval');
    expect(approvalIdOf(secondApproval)).not.toBe(firstApprovalId);
    expect(writer.inputs).toHaveLength(1);

    await expect(workflow.resume('execution-multiple-writes', firstApprovalId, 'approve'))
      .rejects.toThrow('현재 승인 대상과 일치하지 않는 승인 ID입니다.');
    await expect(workflow.resume('execution-multiple-writes', firstApprovalId, 'reject'))
      .rejects.toThrow('현재 승인 대상과 일치하지 않는 승인 ID입니다.');
    expect(writer.inputs).toHaveLength(1);

    const completed = await workflow.resume('execution-multiple-writes', approvalIdOf(secondApproval), 'approve');
    expect(completed.status).toBe('completed');
    expect(writer.inputs).toHaveLength(2);
    expect(await workflow.resume('execution-multiple-writes', approvalIdOf(secondApproval), 'approve')).toEqual(completed);
    expect(writer.inputs).toHaveLength(2);
  });
});
