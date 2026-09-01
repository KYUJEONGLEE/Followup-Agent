import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { databaseDriverOptions } from './database-options';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly dataSource: DataSource;

  constructor(configService: ConfigService) {
    this.dataSource = new DataSource({
      type: 'postgres',
      url: configService.getOrThrow<string>('DATABASE_URL'),
      synchronize: false,
      migrationsRun: false,
      entities: [],
      extra: databaseDriverOptions,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.dataSource.isInitialized) {
      await this.dataSource.initialize();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  async query<TRow extends object>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<TRow[]> {
    if (!this.dataSource.isInitialized) {
      throw new Error('Database 연결이 초기화되지 않았습니다.');
    }

    return this.dataSource.query<TRow[]>(sql, [...parameters]);
  }
}
