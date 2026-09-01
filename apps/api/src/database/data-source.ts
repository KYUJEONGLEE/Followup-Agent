import 'dotenv/config';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { databaseDriverOptions } from './database-options';

export function createAppDataSource(
  databaseUrl = process.env.DATABASE_URL,
): DataSource {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL 환경변수가 필요합니다.');
  }

  return new DataSource({
    type: 'postgres',
    url: databaseUrl,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'each',
    entities: [],
    migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
    extra: databaseDriverOptions,
  });
}

const appDataSource = createAppDataSource();

export default appDataSource;
