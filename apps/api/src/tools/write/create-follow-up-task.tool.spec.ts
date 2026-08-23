import { describe, expect, it, jest } from '@jest/globals';
import type { ToolExecutionContext } from '../define-agent-tool';
import { TOOL_ERROR_CODES } from '../tool-execution.error';
import type {
  CreateFollowUpTaskInput,
  CreateFollowUpTaskResult,
  FollowUpTaskReadModel,
} from '../repositories/follow-up-task.repository';
import {
  createFollowUpTaskTool,
  createWriteIdempotencyKey,
  type FollowUpTaskWriter,
} from './create-follow-up-task.tool';

const context: ToolExecutionContext = {
  executionId: 'execution-1',
  callId: 'call-1',
};

const task: FollowUpTaskReadModel = {
  id: '9e7f6178-4f89-4f09-a989-e215441c21b9',
  customerId: 'C001',
  sourceConsultationId: 'CONS001',
  title: '생활 습관 확인',
  description: '다음 상담 전에 확인합니다.',
  status: 'pending',
  dueAt: '2026-08-25T00:00:00.000Z',
  createdAt: '2026-08-23T00:00:00.000Z',
};

function createRepository(result: CreateFollowUpTaskResult) {
  const create = jest.fn((input: CreateFollowUpTaskInput) => {
    void input;
    return Promise.resolve(result);
  });

  return {
    repository: { create } satisfies FollowUpTaskWriter,
    create,
  };
}

describe('create_follow_up_task', () => {
  it('write effect와 strict Function Schema를 제공한다', () => {
    const { repository } = createRepository({ status: 'created', task });
    const tool = createFollowUpTaskTool(repository);

    expect(tool.effect).toBe('write');
    expect(tool.definition).toMatchObject({
      name: 'create_follow_up_task',
      strict: true,
      parameters: {
        required: [
          'customer_id',
          'source_consultation_id',
          'title',
          'description',
          'due_at',
        ],
        additionalProperties: false,
      },
    });
  });

  it('입력을 정규화하고 실행 문맥 기반 멱등성 키로 Repository를 호출한다', async () => {
    const { repository, create } = createRepository({
      status: 'created',
      task,
    });
    const tool = createFollowUpTaskTool(repository);

    const result = await tool.invoke(
      {
        customer_id: ' C001 ',
        source_consultation_id: ' CONS001 ',
        title: ' 생활 습관 확인 ',
        description: ' 다음 상담 전에 확인합니다. ',
        due_at: '2026-08-25T09:00:00+09:00',
      },
      context,
    );

    expect(create).toHaveBeenCalledWith({
      customerId: 'C001',
      sourceConsultationId: 'CONS001',
      title: '생활 습관 확인',
      description: '다음 상담 전에 확인합니다.',
      dueAt: '2026-08-25T09:00:00+09:00',
      idempotencyKey: createWriteIdempotencyKey(context),
    });
    expect(result.result).toEqual({
      status: 'success',
      data: { created: true, task },
    });
  });

  it('재시도된 기존 업무는 created false로 반환한다', async () => {
    const { repository } = createRepository({ status: 'existing', task });
    const tool = createFollowUpTaskTool(repository);

    const result = await tool.invoke(
      {
        customer_id: 'C001',
        source_consultation_id: 'CONS001',
        title: '생활 습관 확인',
        description: '다음 상담 전에 확인합니다.',
        due_at: '2026-08-25T09:00:00+09:00',
      },
      context,
    );

    expect(result.result).toEqual({
      status: 'success',
      data: { created: false, task },
    });
  });

  it.each([
    ['customer_not_found', '활성 고객을 찾을 수 없습니다.'],
    ['consultation_not_found', '상담 CONS001을 찾을 수 없습니다.'],
  ] as const)('%s를 not_found 결과로 반환한다', async (status, message) => {
    const { repository } = createRepository({ status });
    const tool = createFollowUpTaskTool(repository);

    const result = await tool.invoke(
      {
        customer_id: 'C001',
        source_consultation_id: 'CONS001',
        title: '생활 습관 확인',
        description: null,
        due_at: null,
      },
      context,
    );

    expect(result.result).toMatchObject({
      status: 'not_found',
      message: expect.stringContaining(message),
    });
  });

  it('같은 멱등성 키의 다른 요청을 실행 오류로 거부한다', async () => {
    const { repository } = createRepository({
      status: 'idempotency_conflict',
      task,
    });
    const tool = createFollowUpTaskTool(repository);

    await expect(
      tool.invoke(
        {
          customer_id: 'C001',
          source_consultation_id: null,
          title: '다른 업무',
          description: null,
          due_at: null,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.executionFailed });
  });

  it.each([
    {
      customer_id: 'C001',
      source_consultation_id: null,
      title: '   ',
      description: null,
      due_at: null,
    },
    {
      customer_id: 'C001',
      source_consultation_id: null,
      title: '후속 업무',
      description: null,
      due_at: '2026-08-25T09:00:00',
    },
    {
      customer_id: 'C001',
      source_consultation_id: null,
      title: '후속 업무',
      description: null,
      due_at: null,
      unexpected: true,
    },
  ])('잘못된 arguments를 Repository 실행 전에 거부한다', async (input) => {
    const { repository, create } = createRepository({
      status: 'created',
      task,
    });
    const tool = createFollowUpTaskTool(repository);

    await expect(tool.invoke(input, context)).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.invalidArguments,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('같은 실행 문맥에는 항상 같은 100자 이하 키를 생성한다', () => {
    const first = createWriteIdempotencyKey(context);
    const second = createWriteIdempotencyKey(context);

    expect(first).toBe(second);
    expect(first).toMatch(/^agent:[a-f0-9]{64}$/);
    expect(first.length).toBeLessThanOrEqual(100);
  });
});
