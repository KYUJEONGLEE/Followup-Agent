import { afterAll, beforeAll, describe, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health API (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health는 정상 상태를 반환한다', async () => {
    await request(server)
      .get('/health')
      .expect('Content-Type', /json/)
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('등록되지 않은 경로는 404를 반환한다', async () => {
    await request(server).get('/unknown').expect(404);
  });
});
