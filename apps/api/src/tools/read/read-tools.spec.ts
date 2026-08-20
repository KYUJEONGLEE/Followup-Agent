import { describe, expect, it, jest } from '@jest/globals';
import type { ToolExecutionContext } from '../define-agent-tool';
import type { CustomerConsultationsReadModel } from '../repositories/consultation.repository';
import type { CustomerReadModel } from '../repositories/customer.repository';
import {
  createGetConsultationsTool,
  type ConsultationReader,
} from './get-consultations.tool';
import {
  createGetCustomerTool,
  type CustomerReader,
} from './get-customer.tool';

const context: ToolExecutionContext = {
  executionId: 'execution-1',
  callId: 'call-1',
};

const customer: CustomerReadModel = {
  id: 'C001',
  name: '김민수',
  status: 'active',
  lastVisitAt: '2026-08-01T01:00:00.000Z',
};

describe('get_customer', () => {
  it('단일 고객을 success 결과로 반환한다', async () => {
    const findActiveByName = jest.fn((name: string) => {
      void name;
      return Promise.resolve([customer]);
    });
    const repository: CustomerReader = { findActiveByName };
    const tool = createGetCustomerTool(repository);

    const result = await tool.invoke({ name: ' 김민수 ' }, context);

    expect(findActiveByName).toHaveBeenCalledWith('김민수');
    expect(result.result).toEqual({
      status: 'success',
      data: { match: 'single', customer },
    });
  });

  it('고객이 없으면 not_found 결과를 반환한다', async () => {
    const repository: CustomerReader = {
      findActiveByName: jest.fn(() => Promise.resolve([])),
    };
    const tool = createGetCustomerTool(repository);

    const result = await tool.invoke({ name: '없는 고객' }, context);

    expect(result.result).toMatchObject({
      status: 'not_found',
      data: null,
    });
  });

  it('동명이인은 임의 선택하지 않고 전체 후보를 반환한다', async () => {
    const customers: CustomerReadModel[] = [
      customer,
      { ...customer, id: 'C002' },
    ];
    const repository: CustomerReader = {
      findActiveByName: jest.fn(() => Promise.resolve(customers)),
    };
    const tool = createGetCustomerTool(repository);

    const result = await tool.invoke({ name: '김민수' }, context);

    expect(result.result).toEqual({
      status: 'success',
      data: { match: 'multiple', customers },
    });
  });
});

describe('get_consultations', () => {
  it('고객 상담 이력을 success 결과로 반환한다', async () => {
    const consultations: CustomerConsultationsReadModel = {
      customerId: 'C001',
      consultations: [
        {
          id: 'CONS001',
          consultedAt: '2026-08-01T01:00:00.000Z',
          summary: '다음 상담 전 생활 습관 확인 필요',
        },
      ],
    };
    const findByCustomerCode = jest.fn((customerCode: string) => {
      void customerCode;
      return Promise.resolve(consultations);
    });
    const repository: ConsultationReader = { findByCustomerCode };
    const tool = createGetConsultationsTool(repository);

    const result = await tool.invoke({ customer_id: ' C001 ' }, context);

    expect(findByCustomerCode).toHaveBeenCalledWith('C001');
    expect(result.result).toEqual({ status: 'success', data: consultations });
  });

  it('고객이 존재하지만 상담이 없으면 빈 배열을 success로 반환한다', async () => {
    const repository: ConsultationReader = {
      findByCustomerCode: jest.fn(() =>
        Promise.resolve({ customerId: 'C002', consultations: [] }),
      ),
    };
    const tool = createGetConsultationsTool(repository);

    const result = await tool.invoke({ customer_id: 'C002' }, context);

    expect(result.result).toEqual({
      status: 'success',
      data: { customerId: 'C002', consultations: [] },
    });
  });

  it('고객 자체가 없으면 not_found로 반환한다', async () => {
    const repository: ConsultationReader = {
      findByCustomerCode: jest.fn(() => Promise.resolve(null)),
    };
    const tool = createGetConsultationsTool(repository);

    const result = await tool.invoke({ customer_id: 'C999' }, context);

    expect(result.result).toMatchObject({
      status: 'not_found',
      data: null,
    });
  });
});
