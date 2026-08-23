import { createHash } from 'node:crypto';
import { z } from 'zod';
import { toolNotFound, toolSuccess } from '../contracts/tool-result';
import {
  defineAgentTool,
  type ToolExecutionContext,
} from '../define-agent-tool';
import {
  TOOL_ERROR_CODES,
  ToolExecutionError,
} from '../tool-execution.error';
import type {
  CreateFollowUpTaskInput,
  CreateFollowUpTaskResult,
} from '../repositories/follow-up-task.repository';

export interface FollowUpTaskWriter {
  create(input: CreateFollowUpTaskInput): Promise<CreateFollowUpTaskResult>;
}

export interface CreateFollowUpTaskData {
  created: boolean;
  task: Extract<
    CreateFollowUpTaskResult,
    { status: 'created' | 'existing' }
  >['task'];
}

const inputSchema = z
  .object({
    customer_id: z.string().trim().min(1).max(20),
    source_consultation_id: z.string().trim().min(1).max(20).nullable(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000).nullable(),
    due_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export function createWriteIdempotencyKey(
  context: ToolExecutionContext,
): string {
  const digest = createHash('sha256')
    .update(`${context.executionId}:${context.callId}`)
    .digest('hex');

  return `agent:${digest}`;
}

export function createFollowUpTaskTool(repository: FollowUpTaskWriter) {
  return defineAgentTool({
    effect: 'write',
    definition: {
      type: 'function',
      name: 'create_follow_up_task',
      description:
        '승인 정책이 허용한 경우 고객의 후속 관리 업무를 생성합니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: {
            type: 'string',
            description: 'C001 형식의 고객 ID',
          },
          source_consultation_id: {
            type: ['string', 'null'],
            description: '업무의 근거가 된 CONS001 형식의 상담 ID 또는 null',
          },
          title: {
            type: 'string',
            description: '생성할 업무 제목',
          },
          description: {
            type: ['string', 'null'],
            description: '업무 상세 설명 또는 null',
          },
          due_at: {
            type: ['string', 'null'],
            description: 'Timezone이 포함된 ISO 8601 기한 또는 null',
          },
        },
        required: [
          'customer_id',
          'source_consultation_id',
          'title',
          'description',
          'due_at',
        ],
        additionalProperties: false,
      },
      strict: true,
    },
    inputSchema,
    async handler(input, context) {
      const result = await repository.create({
        customerId: input.customer_id,
        sourceConsultationId: input.source_consultation_id,
        title: input.title,
        description: input.description,
        dueAt: input.due_at,
        idempotencyKey: createWriteIdempotencyKey(context),
      });

      if (result.status === 'customer_not_found') {
        return toolNotFound(
          `ID가 ${input.customer_id}인 활성 고객을 찾을 수 없습니다.`,
        );
      }

      if (result.status === 'consultation_not_found') {
        return toolNotFound(
          `고객 ${input.customer_id}의 상담 ${input.source_consultation_id ?? ''}을 찾을 수 없습니다.`,
        );
      }

      if (result.status === 'idempotency_conflict') {
        throw new ToolExecutionError(
          TOOL_ERROR_CODES.executionFailed,
          '같은 실행 키에 서로 다른 후속 업무 요청이 감지됐습니다.',
        );
      }

      return toolSuccess<CreateFollowUpTaskData>({
        created: result.status === 'created',
        task: result.task,
      });
    },
  });
}
