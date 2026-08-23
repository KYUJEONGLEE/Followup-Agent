import { z } from 'zod';
import { toolNotFound, toolSuccess } from '../contracts/tool-result';
import { defineAgentTool } from '../define-agent-tool';
import type { CustomerReadModel } from '../repositories/customer.repository';

export interface CustomerReader {
  findActiveByName(name: string): Promise<CustomerReadModel[]>;
}

export type GetCustomerData =
  | { match: 'single'; customer: CustomerReadModel }
  | { match: 'multiple'; customers: CustomerReadModel[] };

const inputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
  })
  .strict();

export function createGetCustomerTool(repository: CustomerReader) {
  return defineAgentTool({
    effect: 'read',
    definition: {
      type: 'function',
      name: 'get_customer',
      description:
        '고객 이름으로 활성 고객의 기본 정보와 최근 상담 시각을 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '조회할 고객의 정확한 이름',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      strict: true,
    },
    inputSchema,
    async handler({ name }) {
      const customers = await repository.findActiveByName(name);

      if (customers.length === 0) {
        return toolNotFound(`이름이 ${name}인 활성 고객을 찾을 수 없습니다.`);
      }

      if (customers.length === 1) {
        return toolSuccess<GetCustomerData>({
          match: 'single',
          customer: customers[0],
        });
      }

      return toolSuccess<GetCustomerData>({
        match: 'multiple',
        customers,
      });
    },
  });
}
