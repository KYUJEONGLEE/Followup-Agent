import type { DataSource } from 'typeorm';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

let prepareDeploymentDatabase: typeof import('./prepare-deploy').prepareDeploymentDatabase;
let createAppDataSource: typeof import('./data-source').createAppDataSource;

beforeAll(async () => {
  process.env.DATABASE_URL =
    'postgresql://test:test@localhost:5432/followup_agent_test';

  ({ prepareDeploymentDatabase } = await import('./prepare-deploy'));
  ({ createAppDataSource } = await import('./data-source'));
});

function createDataSourceStub(initializeError?: Error) {
  let initialized = false;
  const runMigrations = jest.fn(() => Promise.resolve([]));
  const destroy = jest.fn(() => {
    initialized = false;
    return Promise.resolve();
  });
  const dataSource = {
    get isInitialized() {
      return initialized;
    },
    initialize: jest.fn(() => {
      if (initializeError) {
        return Promise.reject(initializeError);
      }

      initialized = true;
      return Promise.resolve(dataSource);
    }),
    runMigrations,
    destroy,
  };

  return {
    dataSource: dataSource as unknown as DataSource,
    runMigrations,
    destroy,
  };
}

describe('배포 Database 준비', () => {
  it('PostgreSQL 연결을 10초로 제한한다', () => {
    const dataSource = createAppDataSource(
      'postgresql://test:test@localhost:5432/followup_agent_test',
    );

    expect(dataSource.options.extra).toMatchObject({
      connectionTimeoutMillis: 10_000,
    });
  });

  it('일시적인 연결 실패 후 Migration과 Seed를 다시 시도한다', async () => {
    const firstDataSource = createDataSourceStub(
      new Error('Database가 아직 준비되지 않았습니다.'),
    );
    const secondDataSource = createDataSourceStub();
    const createDataSource = jest
      .fn<() => DataSource>()
      .mockReturnValueOnce(firstDataSource.dataSource)
      .mockReturnValueOnce(secondDataSource.dataSource);
    const seed = jest.fn<(dataSource: DataSource) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const waitForRetry = jest.fn<(delayMs: number) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const logger = { log: jest.fn(), error: jest.fn() };

    await prepareDeploymentDatabase({
      createDataSource,
      seed,
      waitForRetry,
      logger,
      maxAttempts: 2,
      retryDelayMs: 5_000,
    });

    expect(createDataSource).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledWith(5_000);
    expect(secondDataSource.runMigrations).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith(secondDataSource.dataSource);
    expect(secondDataSource.destroy).toHaveBeenCalledTimes(1);
  });

  it('최대 횟수까지 실패하면 마지막 오류를 반환한다', async () => {
    const createDataSource = jest.fn(
      () => createDataSourceStub(new Error('연결 실패')).dataSource,
    );

    await expect(
      prepareDeploymentDatabase({
        createDataSource,
        seed: jest.fn(() => Promise.resolve()),
        waitForRetry: jest.fn(() => Promise.resolve()),
        logger: { log: jest.fn(), error: jest.fn() },
        maxAttempts: 2,
      }),
    ).rejects.toThrow('연결 실패');

    expect(createDataSource).toHaveBeenCalledTimes(2);
  });
});
