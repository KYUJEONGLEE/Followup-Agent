import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { AwaitingApprovalAgentRunResponse } from '../src/agent/contracts/agent-run-response';
import {
  AGENT_LLM_CLIENT,
  type AgentLlmRequest,
} from '../src/agent/llm/agent-llm-client';
import { DatabaseService } from '../src/database/database.service';
import {
  FollowUpTaskRepository,
  type CreateFollowUpTaskInput,
} from '../src/tools/repositories/follow-up-task.repository';

describe('연속 Write 승인 격리 (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const writes: CreateFollowUpTaskInput[] = [];
  let llmCalls = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AGENT_LLM_CLIENT)
      .useValue({
        createResponse(input: AgentLlmRequest) {
          llmCalls += 1;
          const step = input.previousResponseId === null ? 1 : 2;
          if (input.previousResponseId === 'response-2') {
            return Promise.resolve({
              type: 'final_answer',
              responseId: 'response-3',
              answer: '두 업무를 생성했습니다.',
            });
          }
          return Promise.resolve({
            type: 'tool_call',
            responseId: `response-${step}`,
            toolCall: {
              callId: `call-${step}`,
              name: 'create_follow_up_task',
              arguments: JSON.stringify({
                customer_id: 'C001',
                source_consultation_id: null,
                title: `후속 업무 ${step}`,
                description: null,
                due_at: null,
              }),
            },
          });
        },
      })
      .overrideProvider(FollowUpTaskRepository)
      .useValue({
        create(input: CreateFollowUpTaskInput) {
          writes.push(input);
          return Promise.resolve({
            status: 'created',
            task: {
              id: `task-${writes.length}`,
              customerId: input.customerId,
              sourceConsultationId: input.sourceConsultationId,
              title: input.title,
              description: input.description,
              status: 'pending',
              dueAt: input.dueAt,
              createdAt: '2026-09-02T00:00:00.000Z',
            },
          });
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('이전 승인 재전송은 409이며 새 ID의 승인만 다음 Write를 실행한다', async () => {
    const pending = await request(server)
      .post('/agent/runs')
      .send({ message: '후속 업무 두 개를 만들어줘.' })
      .expect(200);
    const first = pending.body as AwaitingApprovalAgentRunResponse;
    expect(first.status).toBe('awaiting_approval');
    const approvalUrl = `/agent/runs/${first.executionId}/approval`;

    await request(server).post(approvalUrl)
      .send({ decision: 'approve' }).expect(400);
    await request(server).post(approvalUrl)
      .send({ approvalId: 'invalid', decision: 'approve' }).expect(400);
    await request(server).post(approvalUrl)
      .send({
        approvalId: 'f342f0b7-9b79-468d-aee2-af11bcebcfa5',
        decision: 'approve',
      }).expect(409);
    expect(writes).toHaveLength(0);

    const firstDecision = { approvalId: first.approval.id, decision: 'approve' };
    const next = await request(server).post(approvalUrl).send(firstDecision).expect(200);
    const second = next.body as AwaitingApprovalAgentRunResponse;
    expect(second.status).toBe('awaiting_approval');
    expect(second.approval.id).not.toBe(first.approval.id);
    expect(writes).toHaveLength(1);

    await request(server).post(approvalUrl).send(firstDecision).expect(409);
    await request(server).post(approvalUrl)
      .send({ approvalId: first.approval.id, decision: 'reject' }).expect(409);
    expect(writes).toHaveLength(1);
    expect(llmCalls).toBe(2);

    const secondDecision = { approvalId: second.approval.id, decision: 'approve' };
    const completed = await request(server).post(approvalUrl).send(secondDecision).expect(200);
    expect(completed.body).toHaveProperty('status', 'completed');
    const duplicate = await request(server).post(approvalUrl).send(secondDecision).expect(200);
    expect(duplicate.body).toEqual(completed.body);
    expect(writes.map((input) => input.title)).toEqual(['후속 업무 1', '후속 업무 2']);
    expect(llmCalls).toBe(3);
  });
});
