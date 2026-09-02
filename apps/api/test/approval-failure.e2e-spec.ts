import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  AGENT_LLM_CLIENT,
  type AgentLlmRequest,
} from '../src/agent/llm/agent-llm-client';
import { DatabaseService } from '../src/database/database.service';
import { FollowUpTaskRepository } from '../src/tools/repositories/follow-up-task.repository';

describe('승인 후 실패 응답 (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let failWrite = false;
  let writeAttempts = 0;
  let llmCalls = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AGENT_LLM_CLIENT)
      .useValue({
        createResponse(input: AgentLlmRequest) {
          llmCalls += 1;
          if (input.previousResponseId) {
            return Promise.reject(new Error('최종 응답 생성 실패'));
          }
          return Promise.resolve({
            type: 'tool_call',
            responseId: 'response-failure-1',
            toolCall: {
              callId: 'call-failure-1',
              name: 'create_follow_up_task',
              arguments: JSON.stringify({
                customer_id: 'C001',
                source_consultation_id: null,
                title: '실패 경로 검증',
                description: null,
                due_at: null,
              }),
            },
          });
        },
      })
      .overrideProvider(FollowUpTaskRepository)
      .useValue({
        create() {
          writeAttempts += 1;
          if (failWrite) {
            return Promise.reject(new Error('테스트 DB 연결 실패'));
          }
          return Promise.resolve({
            status: 'created',
            task: {
              id: 'task-failure-1',
              customerId: 'C001',
              sourceConsultationId: null,
              title: '실패 경로 검증',
              description: null,
              status: 'pending',
              dueAt: null,
              createdAt: '2026-09-02T00:00:00.000Z',
            },
          });
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['tool', 'final_answer'] as const)(
    '%s 실패 이후 재승인은 완료 응답 대신 409를 반환한다',
    async (failureStage) => {
      failWrite = failureStage === 'tool';
      writeAttempts = 0;
      llmCalls = 0;
      const pending = await request(server)
        .post('/agent/runs')
        .send({ message: '후속 업무를 만들어줘.' })
        .expect(200);
      const { executionId, approval } = pending.body as {
        executionId: string;
        approval: { id: string };
      };

      await request(server)
        .post(`/agent/runs/${executionId}/approval`)
        .send({ approvalId: approval.id, decision: 'approve' })
        .expect(500);
      const repeated = await request(server)
        .post(`/agent/runs/${executionId}/approval`)
        .send({ approvalId: approval.id, decision: 'approve' })
        .expect(409);

      expect(repeated.body).toHaveProperty(
        'message',
        '이전 승인 실행이 완료되지 않았습니다. 업무가 이미 생성됐을 수 있으니 실행 결과를 확인하세요.',
      );
      expect(repeated.body).not.toHaveProperty('status', 'completed');
      expect(writeAttempts).toBe(1);
      expect(llmCalls).toBe(failWrite ? 1 : 2);
    },
  );
});
