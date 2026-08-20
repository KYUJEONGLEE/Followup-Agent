import { z } from 'zod';
import { toolNotFound, toolSuccess } from '../contracts/tool-result';
import { defineAgentTool } from '../define-agent-tool';
import type { CustomerConsultationsReadModel } from '../repositories/consultation.repository';

export interface ConsultationReader {
  findByCustomerCode(
    customerCode: string,
  ): Promise<CustomerConsultationsReadModel | null>;
}

const inputSchema = z
  .object({
    customer_id: z.string().trim().min(1).max(20),
  })
  .strict();

export function createGetConsultationsTool(repository: ConsultationReader) {
  return defineAgentTool({
    definition: {
      type: 'function',
      name: 'get_consultations',
      description:
        '고객 ID로 상담 이력을 최근 순서대로 조회합니다. 고객 ID를 모르면 고객 조회 Tool로 먼저 확인할 수 있습니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: {
            type: 'string',
            description: 'C001 형식의 고객 ID',
          },
        },
        required: ['customer_id'],
        additionalProperties: false,
      },
      strict: true,
    },
    inputSchema,
    async handler({ customer_id: customerId }) {
      const result = await repository.findByCustomerCode(customerId);

      if (!result) {
        return toolNotFound(`ID가 ${customerId}인 고객을 찾을 수 없습니다.`);
      }

      return toolSuccess(result);
    },
  });
}
