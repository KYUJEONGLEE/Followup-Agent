import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../src/database/database.service';
import { ToolRegistry } from '../src/tools/tool-registry';
import { ToolsModule } from '../src/tools/tools.module';

describe('PostgreSQL Read Tools (integration)', () => {
  let moduleRef: TestingModule;
  let registry: ToolRegistry;
  let database: DatabaseService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ToolsModule,
      ],
    }).compile();
    await moduleRef.init();

    registry = moduleRef.get(ToolRegistry);
    database = moduleRef.get(DatabaseService);

    await database.query(
      `
        INSERT INTO customers (customer_code, name, status)
        VALUES ('C_EMPTY', '상담없는고객', 'active')
        ON CONFLICT (customer_code) DO UPDATE
        SET name = EXCLUDED.name, status = EXCLUDED.status
      `,
    );
  });

  afterAll(async () => {
    await database.query(
      `DELETE FROM customers WHERE customer_code = 'C_EMPTY'`,
    );
    await moduleRef.close();
  });

  it('get_customer가 실제 Seed의 C001 고객을 조회한다', async () => {
    const result = await registry.execute(
      {
        callId: 'call-customer',
        name: 'get_customer',
        arguments: { name: '김민수' },
      },
      'execution-integration',
    );

    expect(result.result).toEqual({
      status: 'success',
      data: {
        match: 'single',
        customer: {
          id: 'C001',
          name: '김민수',
          status: 'active',
          lastVisitAt: '2026-08-01T01:00:00.000Z',
        },
      },
    });
  });

  it('get_consultations가 C001의 실제 상담 2건을 조회한다', async () => {
    const result = await registry.execute(
      {
        callId: 'call-consultations',
        name: 'get_consultations',
        arguments: { customer_id: 'C001' },
      },
      'execution-integration',
    );

    expect(result.result).toMatchObject({
      status: 'success',
      data: {
        customerId: 'C001',
        consultations: [
          { id: 'CONS001' },
          { id: 'CONS002' },
        ],
      },
    });
  });

  it('상담이 없는 고객과 존재하지 않는 고객을 구분한다', async () => {
    const emptyResult = await registry.execute(
      {
        callId: 'call-empty',
        name: 'get_consultations',
        arguments: { customer_id: 'C_EMPTY' },
      },
      'execution-integration',
    );
    const missingResult = await registry.execute(
      {
        callId: 'call-missing',
        name: 'get_consultations',
        arguments: { customer_id: 'C999' },
      },
      'execution-integration',
    );

    expect(emptyResult.result).toEqual({
      status: 'success',
      data: { customerId: 'C_EMPTY', consultations: [] },
    });
    expect(missingResult.result).toMatchObject({ status: 'not_found' });
  });
});
