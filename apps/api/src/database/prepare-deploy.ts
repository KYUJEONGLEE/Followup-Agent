import { setTimeout as wait } from 'node:timers/promises';
import type { DataSource } from 'typeorm';
import { createAppDataSource } from './data-source';
import { seedDatabase } from './seed';

const defaultMaxAttempts = 6;
const defaultRetryDelayMs = 5_000;

interface DeploymentDatabaseLogger {
  log(message: string): void;
  error(message: string): void;
}

interface PrepareDeploymentDatabaseOptions {
  createDataSource?: () => DataSource;
  seed?: (dataSource: DataSource) => Promise<void>;
  waitForRetry?: (delayMs: number) => Promise<void>;
  logger?: DeploymentDatabaseLogger;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export async function prepareDeploymentDatabase(
  options: PrepareDeploymentDatabaseOptions = {},
): Promise<void> {
  const createDataSource = options.createDataSource ?? createAppDataSource;
  const seed = options.seed ?? seedDatabase;
  const waitForRetry = options.waitForRetry ?? wait;
  const logger = options.logger ?? console;
  const maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const dataSource = createDataSource();

    try {
      await dataSource.initialize();
      const appliedMigrations = await dataSource.runMigrations();
      await seed(dataSource);
      logger.log(
        `Database 준비 완료: Migration ${appliedMigrations.length}건 적용`,
      );
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 오류';

      logger.error(
        `Database 준비 실패 (${attempt}/${maxAttempts}): ${message}`,
      );

      if (attempt === maxAttempts) {
        throw error;
      }
    } finally {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    }

    await waitForRetry(retryDelayMs);
  }
}

if (require.main === module) {
  void prepareDeploymentDatabase().catch(() => {
    process.exitCode = 1;
  });
}
