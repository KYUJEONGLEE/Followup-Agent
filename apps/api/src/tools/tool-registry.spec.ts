import { describe, expect, it, jest } from '@jest/globals';
import { z } from 'zod';
import { toolNotFound, toolSuccess } from './contracts/tool-result';
import {
  defineAgentTool,
  type ToolExecutionContext,
} from './define-agent-tool';
import { TOOL_ERROR_CODES } from './tool-execution.error';
import { ToolRegistry } from './tool-registry';

const customerInputSchema = z.object({
  name: z.string().trim().min(1),
});

const customerDefinition = {
  type: 'function',
  name: 'get_customer',
  description: '고객 이름으로 고객 정보를 조회합니다.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '조회할 고객 이름' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  strict: true,
} as const;

describe('ToolRegistry', () => {
  it('등록된 Tool 정의를 LLM에 전달할 형태로 반환한다', () => {
    const tool = defineAgentTool({
      effect: 'read',
      definition: customerDefinition,
      inputSchema: customerInputSchema,
      handler: ({ name }) =>
        Promise.resolve(toolSuccess({ id: 'C001', name })),
    });
    const registry = new ToolRegistry([tool]);

    expect(registry.listDefinitions()).toEqual([customerDefinition]);
    expect(registry.getEffect('get_customer')).toBe('read');
  });

  it('JSON arguments를 검증한 뒤 Handler를 실행한다', async () => {
    const handler = jest.fn(
      ({ name }: { name: string }, context: ToolExecutionContext) => {
        void context;
        return Promise.resolve(toolSuccess({ id: 'C001', name }));
      },
    );
    const registry = new ToolRegistry([
      defineAgentTool({
        effect: 'read',
        definition: customerDefinition,
        inputSchema: customerInputSchema,
        handler,
      }),
    ]);

    const result = await registry.execute(
      {
        callId: 'call-1',
        name: 'get_customer',
        arguments: '{"name":"김민수"}',
      },
      'execution-1',
    );

    expect(handler).toHaveBeenCalledWith(
      { name: '김민수' },
      { callId: 'call-1', executionId: 'execution-1' },
    );
    expect(result).toEqual({
      callId: 'call-1',
      name: 'get_customer',
      arguments: { name: '김민수' },
      result: {
        status: 'success',
        data: { id: 'C001', name: '김민수' },
      },
    });
  });

  it('입력 검증 실패 시 Handler를 실행하지 않는다', async () => {
    const handler = jest.fn(
      ({ name }: { name: string }, context: ToolExecutionContext) => {
        void context;
        return Promise.resolve(toolSuccess({ id: 'C001', name }));
      },
    );
    const registry = new ToolRegistry([
      defineAgentTool({
        effect: 'read',
        definition: customerDefinition,
        inputSchema: customerInputSchema,
        handler,
      }),
    ]);

    await expect(
      registry.execute(
        {
          callId: 'call-1',
          name: 'get_customer',
          arguments: '{"name":123}',
        },
        'execution-1',
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.invalidArguments,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('데이터 미존재를 실행 오류와 다른 결과로 반환한다', async () => {
    const registry = new ToolRegistry([
      defineAgentTool({
        effect: 'read',
        definition: customerDefinition,
        inputSchema: customerInputSchema,
        handler: () =>
          Promise.resolve(toolNotFound('고객을 찾을 수 없습니다.')),
      }),
    ]);

    const result = await registry.execute(
      {
        callId: 'call-1',
        name: 'get_customer',
        arguments: { name: '없는 고객' },
      },
      'execution-1',
    );

    expect(result.result).toEqual({
      status: 'not_found',
      data: null,
      message: '고객을 찾을 수 없습니다.',
    });
  });

  it('등록되지 않은 Tool 호출을 명확한 오류로 거부한다', async () => {
    const registry = new ToolRegistry([]);

    await expect(
      registry.execute(
        { callId: 'call-1', name: 'unknown', arguments: {} },
        'execution-1',
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: TOOL_ERROR_CODES.notSupported,
      }),
    );
  });

  it('중복된 Tool 이름 등록을 거부한다', () => {
    const createTool = () =>
      defineAgentTool({
        effect: 'read',
        definition: customerDefinition,
        inputSchema: customerInputSchema,
        handler: () =>
          Promise.resolve(toolNotFound('고객을 찾을 수 없습니다.')),
      });

    expect(() => new ToolRegistry([createTool(), createTool()])).toThrow(
      '중복된 Tool 이름',
    );
  });

  it('등록되지 않은 Tool의 effect 조회를 거부한다', () => {
    const registry = new ToolRegistry([]);

    expect(() => registry.getEffect('unknown')).toThrow(
      '지원하지 않는 Tool입니다: unknown',
    );
  });
});
