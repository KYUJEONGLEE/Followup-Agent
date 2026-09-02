import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request, { type Response } from 'supertest';
import type { AgentRunResponse } from '../src/agent/contracts/agent-run-response';
import { AgentModule } from '../src/agent/agent.module';
import {
  AGENT_LLM_CLIENT,
  type AgentLlmClient,
  type AgentLlmRequest,
  type AgentLlmResult,
} from '../src/agent/llm/agent-llm-client';
import { validateEnvironment } from '../src/config/env.validation';
import { DatabaseService } from '../src/database/database.service';

const E2E_TITLE_PREFIX = '[AGENT-20 E2E]';
const approvedTaskTitle = `${E2E_TITLE_PREFIX} 승인 업무`;
const rejectedTaskTitle = `${E2E_TITLE_PREFIX} 거절 업무`;
const missingCustomerTaskTitle = `${E2E_TITLE_PREFIX} 미존재 고객 업무`;
const duplicateTaskTitle = `${E2E_TITLE_PREFIX} 중복 승인 업무`;

interface FollowUpTaskRow {
  title: string;
  description: string | null;
  status: string;
  customer_code: string;
  consultation_code: string | null;
}

interface CountRow {
  count: string;
}

class CoreScenarioLlmClient implements AgentLlmClient {
  createResponse(request: AgentLlmRequest): Promise<AgentLlmResult> {
    switch (request.userMessage) {
      case '안녕하세요.':
        return Promise.resolve({
          type: 'final_answer',
          responseId: 'e2e-greeting-final',
          answer: '안녕하세요!',
        });
      case '김민수 고객의 기본 정보와 상담 이력을 조회해줘.':
        return Promise.resolve(this.createReadScenarioResponse(request));
      case '김민수 고객을 조회하고 상담을 확인한 뒤 후속 업무를 만들어줘.':
        return Promise.resolve(this.createApprovedWriteResponse(request));
      case '김민수 고객의 후속 업무를 제안하고 승인을 기다려줘.':
        return Promise.resolve(
          this.createSingleWriteResponse(request, {
            scenario: 'reject',
            customerId: 'C001',
            consultationId: 'CONS001',
            title: rejectedTaskTitle,
            finalAnswer: '이 응답은 거절 경로에서 생성되면 안 됩니다.',
          }),
        );
      case 'C999 고객에게 후속 업무를 만들어줘.':
        return Promise.resolve(
          this.createSingleWriteResponse(request, {
            scenario: 'missing',
            customerId: 'C999',
            consultationId: null,
            title: missingCustomerTaskTitle,
            finalAnswer: 'C999 활성 고객을 찾을 수 없어 업무를 생성하지 않았습니다.',
            expectedToolOutput: 'not_found',
          }),
        );
      case '김민수 고객에게 중복 없이 후속 업무를 만들어줘.':
        return Promise.resolve(
          this.createSingleWriteResponse(request, {
            scenario: 'duplicate',
            customerId: 'C001',
            consultationId: 'CONS001',
            title: duplicateTaskTitle,
            finalAnswer: '중복 없이 후속 업무를 생성했습니다.',
            expectedToolOutput: duplicateTaskTitle,
          }),
        );
      default:
        throw new Error(`정의하지 않은 E2E 요청입니다: ${request.userMessage}`);
    }
  }

  private createReadScenarioResponse(
    request: AgentLlmRequest,
  ): AgentLlmResult {
    if (!request.previousResponseId) {
      return this.getCustomerCall('read');
    }

    if (request.previousResponseId === 'e2e-read-customer') {
      this.requireToolOutput(request, 'C001');

      return this.getConsultationsCall('read');
    }

    if (request.previousResponseId === 'e2e-read-consultations') {
      this.requireToolOutput(request, 'CONS001');

      return {
        type: 'final_answer',
        responseId: 'e2e-read-final',
        answer:
          '김민수 고객은 active 상태이며 최근 상담 2건을 확인했습니다.',
      };
    }

    throw new Error('Read E2E 시나리오의 이전 응답 ID가 올바르지 않습니다.');
  }

  private createApprovedWriteResponse(
    request: AgentLlmRequest,
  ): AgentLlmResult {
    if (!request.previousResponseId) {
      return this.getCustomerCall('write');
    }

    if (request.previousResponseId === 'e2e-write-customer') {
      this.requireToolOutput(request, 'C001');

      return this.getConsultationsCall('write');
    }

    if (request.previousResponseId === 'e2e-write-consultations') {
      this.requireToolOutput(request, 'CONS001');

      return {
        type: 'tool_call',
        responseId: 'e2e-write-create-task',
        toolCall: {
          callId: 'call-e2e-create-task',
          name: 'create_follow_up_task',
          arguments: JSON.stringify({
            customer_id: 'C001',
            source_consultation_id: 'CONS001',
            title: approvedTaskTitle,
            description: '상담 결과에 따른 생활 습관 확인',
            due_at: null,
          }),
        },
      };
    }

    if (request.previousResponseId === 'e2e-write-create-task') {
      this.requireToolOutput(request, approvedTaskTitle);

      return {
        type: 'final_answer',
        responseId: 'e2e-write-final',
        answer: '승인된 후속 업무를 생성했습니다.',
      };
    }

    throw new Error('Write E2E 시나리오의 이전 응답 ID가 올바르지 않습니다.');
  }

  private createSingleWriteResponse(
    request: AgentLlmRequest,
    scenario: {
      scenario: 'reject' | 'missing' | 'duplicate';
      customerId: string;
      consultationId: string | null;
      title: string;
      finalAnswer: string;
      expectedToolOutput?: string;
    },
  ): AgentLlmResult {
    const responseId = `e2e-${scenario.scenario}-create-task`;

    if (!request.previousResponseId) {
      return {
        type: 'tool_call',
        responseId,
        toolCall: {
          callId: `call-${responseId}`,
          name: 'create_follow_up_task',
          arguments: JSON.stringify({
            customer_id: scenario.customerId,
            source_consultation_id: scenario.consultationId,
            title: scenario.title,
            description: 'AGENT-20 예외 및 중복 E2E 검증',
            due_at: null,
          }),
        },
      };
    }

    if (
      request.previousResponseId === responseId &&
      scenario.expectedToolOutput
    ) {
      this.requireToolOutput(request, scenario.expectedToolOutput);

      return {
        type: 'final_answer',
        responseId: `e2e-${scenario.scenario}-final`,
        answer: scenario.finalAnswer,
      };
    }

    throw new Error(
      `${scenario.scenario} E2E 시나리오의 이전 응답 ID가 올바르지 않습니다.`,
    );
  }

  private getCustomerCall(scenario: 'read' | 'write'): AgentLlmResult {
    return {
      type: 'tool_call',
      responseId: `e2e-${scenario}-customer`,
      toolCall: {
        callId: `call-e2e-${scenario}-customer`,
        name: 'get_customer',
        arguments: JSON.stringify({ name: '김민수' }),
      },
    };
  }

  private getConsultationsCall(scenario: 'read' | 'write'): AgentLlmResult {
    return {
      type: 'tool_call',
      responseId: `e2e-${scenario}-consultations`,
      toolCall: {
        callId: `call-e2e-${scenario}-consultations`,
        name: 'get_consultations',
        arguments: JSON.stringify({ customer_id: 'C001' }),
      },
    };
  }

  private requireToolOutput(
    request: AgentLlmRequest,
    expectedValue: string,
  ): void {
    if (!request.toolOutput?.output.includes(expectedValue)) {
      throw new Error(
        `이전 Tool 결과에서 ${expectedValue} 값을 확인할 수 없습니다.`,
      );
    }
  }
}

describe('핵심 Agent 시나리오 (API → PostgreSQL)', () => {
  let moduleRef: TestingModule | undefined;
  let app: INestApplication | undefined;
  let server: Server;
  let database: DatabaseService | undefined;
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    AGENT_ALLOW_AUTO_WRITE: process.env.AGENT_ALLOW_AUTO_WRITE,
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.OPENAI_API_KEY = 'agent-20-scripted-llm';
    process.env.OPENAI_MODEL = 'gpt-5.6';
    process.env.AGENT_ALLOW_AUTO_WRITE = 'false';

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: validateEnvironment,
        }),
        AgentModule,
      ],
    })
      .overrideProvider(AGENT_LLM_CLIENT)
      .useValue(new CoreScenarioLlmClient())
      .compile();

    const initializedApp = moduleRef.createNestApplication();
    initializedApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await initializedApp.init();

    app = initializedApp;
    server = initializedApp.getHttpServer() as Server;
    const initializedDatabase = initializedApp.get(DatabaseService);
    database = initializedDatabase;
    await deleteScenarioTasks(initializedDatabase);
  });

  afterAll(async () => {
    try {
      if (database) {
        await deleteScenarioTasks(database);
      }
    } finally {
      await app?.close();
      restoreEnvironment(previousEnvironment);
    }
  });

  it('Tool이 필요 없는 인사 요청은 DB 변경 없이 완료한다', async () => {
    const beforeCount = await countScenarioTasks();
    const response = await request(server)
      .post('/agent/runs')
      .send({ message: '안녕하세요.' })
      .expect(200);
    const body = toAgentRunResponse(response);

    expect(body).toEqual({
      executionId: expect.any(String),
      status: 'completed',
      answer: '안녕하세요!',
      approval: null,
      writeApprovalMode: 'required',
      trace: [{ sequence: 1, type: 'node', name: 'llm' }],
    });
    await expect(countScenarioTasks()).resolves.toBe(beforeCount);
  });

  it('고객 조회 결과 C001로 실제 상담 이력 2건을 조회한다', async () => {
    const response = await request(server)
      .post('/agent/runs')
      .send({
        message: '김민수 고객의 기본 정보와 상담 이력을 조회해줘.',
      })
      .expect(200);
    const body = toAgentRunResponse(response);

    expect(body.status).toBe('completed');
    expect(body.answer).toContain('최근 상담 2건');
    expect(body.trace).toEqual([
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
  });

  it('조회 후 Write 승인을 기다리고 승인 뒤 PostgreSQL에 생성한다', async () => {
    const pendingResponse = await request(server)
      .post('/agent/runs')
      .send({
        message:
          '김민수 고객을 조회하고 상담을 확인한 뒤 후속 업무를 만들어줘.',
      })
      .expect(200);
    const pendingBody = toAgentRunResponse(pendingResponse);

    expect(pendingBody.status).toBe('awaiting_approval');
    expect(pendingBody.approval).toEqual({
      id: expect.any(String),
      toolName: 'create_follow_up_task',
      arguments: expect.objectContaining({
        customer_id: 'C001',
        source_consultation_id: 'CONS001',
        title: approvedTaskTitle,
      }),
    });
    expect(pendingBody.trace.map(traceLabel)).toEqual([
      'node:llm',
      'tool:get_customer',
      'node:llm',
      'tool:get_consultations',
      'node:llm',
      'approval:requested:create_follow_up_task',
    ]);
    await expect(findTask(approvedTaskTitle)).resolves.toBeUndefined();

    const approvedResponse = await request(server)
      .post(`/agent/runs/${pendingBody.executionId}/approval`)
      .send({ approvalId: pendingBody.approval?.id, decision: 'approve' })
      .expect(200);
    const approvedBody = toAgentRunResponse(approvedResponse);

    expect(approvedBody.status).toBe('completed');
    expect(approvedBody.answer).toBe('승인된 후속 업무를 생성했습니다.');
    expect(approvedBody.trace.map(traceLabel)).toEqual([
      'node:llm',
      'tool:get_customer',
      'node:llm',
      'tool:get_consultations',
      'node:llm',
      'approval:requested:create_follow_up_task',
      'approval:approved:create_follow_up_task',
      'tool:create_follow_up_task',
      'node:llm',
    ]);
    await expect(findTask(approvedTaskTitle)).resolves.toEqual({
      title: approvedTaskTitle,
      description: '상담 결과에 따른 생활 습관 확인',
      status: 'pending',
      customer_code: 'C001',
      consultation_code: 'CONS001',
    });
  });

  it('사용자가 거절하면 Write Tool 실행과 DB 변경 없이 종료한다', async () => {
    const beforeCount = await countScenarioTasks();
    const pendingResponse = await request(server)
      .post('/agent/runs')
      .send({
        message: '김민수 고객의 후속 업무를 제안하고 승인을 기다려줘.',
      })
      .expect(200);
    const pendingBody = toAgentRunResponse(pendingResponse);

    expect(pendingBody.status).toBe('awaiting_approval');
    await expect(findTask(rejectedTaskTitle)).resolves.toBeUndefined();

    const rejectedResponse = await request(server)
      .post(`/agent/runs/${pendingBody.executionId}/approval`)
      .send({ approvalId: pendingBody.approval?.id, decision: 'reject' })
      .expect(200);
    const rejectedBody = toAgentRunResponse(rejectedResponse);

    expect(rejectedBody.status).toBe('rejected');
    expect(rejectedBody.trace.map(traceLabel)).toEqual([
      'node:llm',
      'approval:requested:create_follow_up_task',
      'approval:rejected:create_follow_up_task',
    ]);
    expect(
      rejectedBody.trace.some(
        (trace) =>
          trace.type === 'tool' && trace.name === 'create_follow_up_task',
      ),
    ).toBe(false);
    await expect(findTask(rejectedTaskTitle)).resolves.toBeUndefined();
    await expect(countScenarioTasks()).resolves.toBe(beforeCount);
  });

  it('미존재 고객 C999는 승인 후에도 업무를 저장하지 않는다', async () => {
    const beforeCount = await countScenarioTasks();
    const pendingResponse = await request(server)
      .post('/agent/runs')
      .send({ message: 'C999 고객에게 후속 업무를 만들어줘.' })
      .expect(200);
    const pendingBody = toAgentRunResponse(pendingResponse);

    expect(pendingBody.status).toBe('awaiting_approval');
    expect(pendingBody.approval).toEqual(
      expect.objectContaining({
        arguments: expect.objectContaining({ customer_id: 'C999' }),
      }),
    );

    const completedResponse = await request(server)
      .post(`/agent/runs/${pendingBody.executionId}/approval`)
      .send({ approvalId: pendingBody.approval?.id, decision: 'approve' })
      .expect(200);
    const completedBody = toAgentRunResponse(completedResponse);

    expect(completedBody.status).toBe('completed');
    expect(completedBody.answer).toContain('찾을 수 없어');
    expect(completedBody.trace.map(traceLabel)).toEqual([
      'node:llm',
      'approval:requested:create_follow_up_task',
      'approval:approved:create_follow_up_task',
      'tool:create_follow_up_task',
      'node:llm',
    ]);
    await expect(findTask(missingCustomerTaskTitle)).resolves.toBeUndefined();
    await expect(countScenarioTasks()).resolves.toBe(beforeCount);
  });

  it('같은 실행을 다시 승인해도 응답과 DB 한 건을 유지한다', async () => {
    const pendingResponse = await request(server)
      .post('/agent/runs')
      .send({ message: '김민수 고객에게 중복 없이 후속 업무를 만들어줘.' })
      .expect(200);
    const pendingBody = toAgentRunResponse(pendingResponse);

    expect(pendingBody.status).toBe('awaiting_approval');

    const firstApprovalResponse = await request(server)
      .post(`/agent/runs/${pendingBody.executionId}/approval`)
      .send({ approvalId: pendingBody.approval?.id, decision: 'approve' })
      .expect(200);
    const firstApprovalBody = toAgentRunResponse(firstApprovalResponse);

    expect(firstApprovalBody.status).toBe('completed');
    await expect(countTasksByTitle(duplicateTaskTitle)).resolves.toBe(1);

    const duplicateApprovalResponse = await request(server)
      .post(`/agent/runs/${pendingBody.executionId}/approval`)
      .send({ approvalId: pendingBody.approval?.id, decision: 'approve' })
      .expect(200);
    const duplicateApprovalBody = toAgentRunResponse(
      duplicateApprovalResponse,
    );

    expect(duplicateApprovalBody).toEqual(firstApprovalBody);
    await expect(countTasksByTitle(duplicateTaskTitle)).resolves.toBe(1);
  });

  async function countScenarioTasks(): Promise<number> {
    const initializedDatabase = requireDatabase(database);
    const rows = await initializedDatabase.query<CountRow>(
      `SELECT COUNT(*)::text AS count FROM follow_up_tasks WHERE title LIKE $1`,
      [`${E2E_TITLE_PREFIX}%`],
    );

    return Number(rows[0]?.count ?? 0);
  }

  async function findTask(title: string): Promise<FollowUpTaskRow | undefined> {
    const initializedDatabase = requireDatabase(database);
    const rows = await initializedDatabase.query<FollowUpTaskRow>(
      `
        SELECT
          task.title,
          task.description,
          task.status,
          customer.customer_code,
          consultation.consultation_code
        FROM follow_up_tasks AS task
        JOIN customers AS customer ON customer.id = task.customer_id
        LEFT JOIN consultations AS consultation
          ON consultation.id = task.source_consultation_id
        WHERE task.title = $1
      `,
      [title],
    );

    return rows[0];
  }

  async function countTasksByTitle(title: string): Promise<number> {
    const initializedDatabase = requireDatabase(database);
    const rows = await initializedDatabase.query<CountRow>(
      `SELECT COUNT(*)::text AS count FROM follow_up_tasks WHERE title = $1`,
      [title],
    );

    return Number(rows[0]?.count ?? 0);
  }
});

function toAgentRunResponse(response: Response): AgentRunResponse {
  return response.body as AgentRunResponse;
}

function traceLabel(trace: AgentRunResponse['trace'][number]): string {
  if (trace.type === 'approval') {
    return `approval:${trace.decision}:${trace.toolName}`;
  }

  return `${trace.type}:${trace.name}`;
}

function requireDatabase(
  database: DatabaseService | undefined,
): DatabaseService {
  if (!database) {
    throw new Error('E2E Database가 초기화되지 않았습니다.');
  }

  return database;
}

async function deleteScenarioTasks(database: DatabaseService): Promise<void> {
  await database.query(`DELETE FROM follow_up_tasks WHERE title LIKE $1`, [
    `${E2E_TITLE_PREFIX}%`,
  ]);
}

function restoreEnvironment(environment: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
