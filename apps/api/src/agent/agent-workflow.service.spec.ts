import { describe, expect, it } from '@jest/globals';
import { createGetConsultationsTool } from '../tools/read/get-consultations.tool';
import { createGetCustomerTool } from '../tools/read/get-customer.tool';
import { ToolRegistry } from '../tools/tool-registry';
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

function createToolRegistry(): ToolRegistry {
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

  return new ToolRegistry([customerTool, consultationsTool]);
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
});
