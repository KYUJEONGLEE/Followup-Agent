import 'dotenv/config';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL 환경변수가 필요합니다.');
}

export const appDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  synchronize: false,
  migrationsRun: false,
  migrationsTableName: 'schema_migrations',
  migrationsTransactionMode: 'each',
  entities: [],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
});

export default appDataSource;
