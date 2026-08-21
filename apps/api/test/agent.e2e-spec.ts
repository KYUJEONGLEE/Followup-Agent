import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGENT_LLM_CLIENT } from '../src/agent/llm/agent-llm-client';
import { DatabaseService } from '../src/database/database.service';

describe('Agent API (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AGENT_LLM_CLIENT)
      .useValue({
        createResponse() {
          return Promise.resolve({
            type: 'final_answer',
            responseId: 'response-1',
            answer: '안녕하세요!',
          } as const);
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
      answer: '안녕하세요!',
      trace: [{ sequence: 1, type: 'node', name: 'llm' }],
    });
  });

  it('빈 message는 400으로 거부한다', async () => {
    await request(server)
      .post('/agent/runs')
      .send({ message: '   ' })
      .expect(400);
  });
});
