import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { FollowUpTaskRepository } from '../src/tools/repositories/follow-up-task.repository';
import {
  createFollowUpTaskTool,
  createWriteIdempotencyKey,
  type CreateFollowUpTaskData,
} from '../src/tools/write/create-follow-up-task.tool';

const contexts = {
  create: { executionId: 'write-create', callId: 'call-create' },
  duplicate: { executionId: 'write-duplicate', callId: 'call-duplicate' },
  conflict: { executionId: 'write-conflict', callId: 'call-conflict' },
  missingCustomer: {
    executionId: 'write-missing-customer',
    callId: 'call-missing-customer',
  },
  wrongConsultation: {
    executionId: 'write-wrong-consultation',
    callId: 'call-wrong-consultation',
  },
} as const;

const idempotencyKeys = Object.values(contexts).map((context) =>
  createWriteIdempotencyKey(context),
);

const baseArguments = {
  customer_id: 'C001',
  source_consultation_id: 'CONS001',
  title: '[integration] 생활 습관 확인',
  description: '다음 상담 전에 최근 생활 습관을 확인합니다.',
  due_at: '2026-08-25T09:00:00+09:00',
};

describe('PostgreSQL Write Tool (integration)', () => {
  let moduleRef: TestingModule | undefined;
  let database: DatabaseService | undefined;
  let repository: FollowUpTaskRepository;
  let fixtureCreated = false;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule],
      providers: [FollowUpTaskRepository],
    }).compile();
    await moduleRef.init();

    const initializedDatabase = moduleRef.get(DatabaseService);
    database = initializedDatabase;
    repository = moduleRef.get(FollowUpTaskRepository);

    await initializedDatabase.query(
      `DELETE FROM follow_up_tasks WHERE idempotency_key = ANY($1::text[])`,
      [idempotencyKeys],
    );
    await initializedDatabase.query(
      `
        INSERT INTO customers (customer_code, name, status)
        VALUES ('C_WRITE_OTHER', '다른고객', 'active')
        ON CONFLICT (customer_code) DO UPDATE
        SET name = EXCLUDED.name, status = EXCLUDED.status
      `,
    );
    await initializedDatabase.query(
      `
        INSERT INTO consultations (
          consultation_code,
          customer_id,
          consulted_at,
          summary
        )
        SELECT
          'CONS_WRITE_OTHER',
          customer.id,
          '2026-08-10T09:00:00+09:00',
          '다른 고객의 상담'
        FROM customers AS customer
        WHERE customer.customer_code = 'C_WRITE_OTHER'
        ON CONFLICT (consultation_code) DO UPDATE
        SET
          customer_id = EXCLUDED.customer_id,
          consulted_at = EXCLUDED.consulted_at,
          summary = EXCLUDED.summary
      `,
    );
    fixtureCreated = true;
  });

  afterAll(async () => {
    try {
      if (database) {
        await database.query(
          `DELETE FROM follow_up_tasks WHERE idempotency_key = ANY($1::text[])`,
          [idempotencyKeys],
        );

        if (fixtureCreated) {
          await database.query(
            `DELETE FROM consultations WHERE consultation_code = 'CONS_WRITE_OTHER'`,
          );
          await database.query(
            `DELETE FROM customers WHERE customer_code = 'C_WRITE_OTHER'`,
          );
        }
      }
    } finally {
      await moduleRef?.close();
    }
  });

  it('C001 고객에게 CONS001 기반 후속 업무를 생성한다', async () => {
    const tool = createFollowUpTaskTool(repository);

    const result = await tool.invoke(baseArguments, contexts.create);

    expect(result.result).toMatchObject({
      status: 'success',
      data: {
        created: true,
        task: {
          customerId: 'C001',
          sourceConsultationId: 'CONS001',
          title: baseArguments.title,
          status: 'pending',
          dueAt: '2026-08-25T00:00:00.000Z',
        },
      },
    });
  });

  it('같은 실행을 재시도해도 기존 업무 한 건만 반환한다', async () => {
    const tool = createFollowUpTaskTool(repository);

    const first = await tool.invoke(baseArguments, contexts.duplicate);
    const second = await tool.invoke(baseArguments, contexts.duplicate);
    const rows = await database?.query<{ id: string }>(
      `SELECT id FROM follow_up_tasks WHERE idempotency_key = $1`,
      [createWriteIdempotencyKey(contexts.duplicate)],
    );

    expect(first.result).toMatchObject({
      status: 'success',
      data: { created: true },
    });
    expect(second.result).toMatchObject({
      status: 'success',
      data: { created: false },
    });

    if (first.result.status !== 'success' || second.result.status !== 'success') {
      throw new Error('멱등성 검증 결과가 success가 아닙니다.');
    }

    const firstData = first.result.data as CreateFollowUpTaskData;
    const secondData = second.result.data as CreateFollowUpTaskData;

    expect(secondData.task.id).toBe(firstData.task.id);
    expect(rows).toHaveLength(1);
  });

  it('같은 실행 키의 다른 업무 내용을 거부한다', async () => {
    const tool = createFollowUpTaskTool(repository);

    await tool.invoke(baseArguments, contexts.conflict);

    await expect(
      tool.invoke(
        { ...baseArguments, title: '[integration] 변경된 제목' },
        contexts.conflict,
      ),
    ).rejects.toThrow('같은 실행 키에 서로 다른 후속 업무 요청');
  });

  it('없는 고객에는 후속 업무를 생성하지 않는다', async () => {
    const tool = createFollowUpTaskTool(repository);

    const result = await tool.invoke(
      { ...baseArguments, customer_id: 'C999' },
      contexts.missingCustomer,
    );

    expect(result.result).toMatchObject({ status: 'not_found' });
  });

  it('다른 고객 소유 상담을 원본으로 연결하지 않는다', async () => {
    const tool = createFollowUpTaskTool(repository);

    const result = await tool.invoke(
      {
        ...baseArguments,
        source_consultation_id: 'CONS_WRITE_OTHER',
      },
      contexts.wrongConsultation,
    );

    expect(result.result).toMatchObject({ status: 'not_found' });
  });
});
