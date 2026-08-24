import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGENT_LLM_CLIENT } from '../src/agent/llm/agent-llm-client';
import { DatabaseService } from '../src/database/database.service';
import { FollowUpTaskRepository } from '../src/tools/repositories/follow-up-task.repository';

const writeArguments = {
  customer_id: 'C001',
  source_consultation_id: 'CONS001',
  title: '생활 습관 확인',
  description: '다음 상담 전에 확인합니다.',
  due_at: null,
};

describe('Agent API (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const writeInputs: unknown[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AGENT_LLM_CLIENT)
      .useValue({
        createResponse(request: {
          userMessage: string;
          previousResponseId: string | null;
        }) {
          if (
            request.userMessage.includes('후속 업무') &&
            !request.previousResponseId
          ) {
            return Promise.resolve({
              type: 'tool_call',
              responseId: 'response-write-1',
              toolCall: {
                callId: 'call-write-1',
                name: 'create_follow_up_task',
                arguments: JSON.stringify(writeArguments),
              },
            } as const);
          }

          if (request.userMessage.includes('후속 업무')) {
            return Promise.resolve({
              type: 'final_answer',
              responseId: 'response-write-2',
              answer: '후속 업무를 생성했습니다.',
            } as const);
          }

          return Promise.resolve({
            type: 'final_answer',
            responseId: 'response-1',
            answer: '안녕하세요!',
          } as const);
        },
      })
      .overrideProvider(FollowUpTaskRepository)
      .useValue({
        create(input: unknown) {
          writeInputs.push(input);

          return Promise.resolve({
            status: 'created',
            task: {
              id: 'task-e2e-1',
              customerId: 'C001',
              sourceConsultationId: 'CONS001',
              title: '생활 습관 확인',
              description: '다음 상담 전에 확인합니다.',
              status: 'pending',
              dueAt: null,
              createdAt: '2026-08-23T00:00:00.000Z',
            },
          });
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
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

  it('POST /agent/runs는 executionId, answer, trace를 반환한다', async () => {
    const response = await request(server)
      .post('/agent/runs')
      .send({ message: '안녕하세요.' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({
      executionId: expect.any(String),
      status: 'completed',
      answer: '안녕하세요!',
      approval: null,
      writeApprovalMode: 'required',
      trace: [{ sequence: 1, type: 'node', name: 'llm' }],
    });
  });

  it('빈 message는 400으로 거부한다', async () => {
    await request(server)
      .post('/agent/runs')
      .send({ message: '   ' })
      .expect(400);
  });

  it('Write 요청은 승인 전 대기하고 승인 후 한 번만 실행한다', async () => {
    const pendingResponse = await request(server)
      .post('/agent/runs')
      .send({ message: '김민수 고객의 후속 업무를 만들어줘.' })
      .expect(200);

    expect(pendingResponse.body).toEqual({
      executionId: expect.any(String),
      status: 'awaiting_approval',
      answer: null,
      approval: {
        toolName: 'create_follow_up_task',
        arguments: writeArguments,
      },
      writeApprovalMode: 'required',
      trace: expect.arrayContaining([
        expect.objectContaining({
          type: 'approval',
          decision: 'requested',
        }),
      ]),
    });
    expect(writeInputs).toHaveLength(0);

    const executionId = (
      pendingResponse.body as unknown as { executionId: string }
    ).executionId;
    const approvedResponse = await request(server)
      .post(`/agent/runs/${executionId}/approval`)
      .send({ decision: 'approve' })
      .expect(200);

    expect(approvedResponse.body).toEqual(
      expect.objectContaining({
        executionId,
        status: 'completed',
        answer: '후속 업무를 생성했습니다.',
      }),
    );
    expect(writeInputs).toHaveLength(1);

    await request(server)
      .post(`/agent/runs/${executionId}/approval`)
      .send({ decision: 'approve' })
      .expect(200);

    expect(writeInputs).toHaveLength(1);
  });

  it('Write 요청을 거절하면 실행하지 않는다', async () => {
    const beforeCount = writeInputs.length;
    const pendingResponse = await request(server)
      .post('/agent/runs')
      .send({ message: '거절할 후속 업무를 만들어줘.' })
      .expect(200);
    const executionId = (
      pendingResponse.body as unknown as { executionId: string }
    ).executionId;

    const rejectedResponse = await request(server)
      .post(`/agent/runs/${executionId}/approval`)
      .send({ decision: 'reject' })
      .expect(200);

    expect(rejectedResponse.body).toEqual(
      expect.objectContaining({
        executionId,
        status: 'rejected',
      }),
    );
    expect(writeInputs).toHaveLength(beforeCount);
  });

  it('서버가 허용하지 않으면 auto 요청을 required로 낮춘다', async () => {
    const response = await request(server)
      .post('/agent/runs')
      .send({
        message: '자동 실행할 후속 업무를 만들어줘.',
        writeApprovalMode: 'auto',
      })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'awaiting_approval',
        writeApprovalMode: 'required',
      }),
    );
  });

  it('동일 IP의 Agent 실행 요청은 분당 5회로 제한한다', async () => {
    await request(server)
      .post('/agent/runs')
      .send({ message: '요청 제한 확인' })
      .expect(429);
  });
});
