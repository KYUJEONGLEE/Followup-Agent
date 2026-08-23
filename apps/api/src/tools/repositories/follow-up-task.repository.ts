import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

interface CustomerIdRow {
  id: string;
}

interface ConsultationIdRow {
  id: string;
}

interface InsertedTaskRow {
  id: string;
}

interface FollowUpTaskRow {
  id: string;
  customer_code: string;
  consultation_code: string | null;
  title: string;
  description: string | null;
  status: string;
  due_at: Date | null;
  created_at: Date;
}

export interface CreateFollowUpTaskInput {
  customerId: string;
  sourceConsultationId: string | null;
  title: string;
  description: string | null;
  dueAt: string | null;
  idempotencyKey: string;
}

export interface FollowUpTaskReadModel {
  id: string;
  customerId: string;
  sourceConsultationId: string | null;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  createdAt: string;
}

export type CreateFollowUpTaskResult =
  | { status: 'created'; task: FollowUpTaskReadModel }
  | { status: 'existing'; task: FollowUpTaskReadModel }
  | { status: 'customer_not_found' }
  | { status: 'consultation_not_found' }
  | { status: 'idempotency_conflict'; task: FollowUpTaskReadModel };

@Injectable()
export class FollowUpTaskRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(
    input: CreateFollowUpTaskInput,
  ): Promise<CreateFollowUpTaskResult> {
    const existingTask = await this.findByIdempotencyKey(
      input.idempotencyKey,
    );

    if (existingTask) {
      return this.resolveExistingTask(existingTask, input);
    }

    const customerRows = await this.database.query<CustomerIdRow>(
      `
        SELECT id
        FROM customers
        WHERE customer_code = $1
          AND status = 'active'
      `,
      [input.customerId],
    );
    const customer = customerRows[0];

    if (!customer) {
      return { status: 'customer_not_found' };
    }

    const sourceConsultationInternalId = await this.findConsultationId(
      input.sourceConsultationId,
      customer.id,
    );

    if (
      input.sourceConsultationId !== null &&
      sourceConsultationInternalId === null
    ) {
      return { status: 'consultation_not_found' };
    }

    const insertedRows = await this.database.query<InsertedTaskRow>(
      `
        INSERT INTO follow_up_tasks (
          customer_id,
          source_consultation_id,
          title,
          description,
          status,
          due_at,
          idempotency_key
        )
        VALUES ($1, $2, $3, $4, 'pending', $5, $6)
        ON CONFLICT (idempotency_key)
          WHERE idempotency_key IS NOT NULL
          DO NOTHING
        RETURNING id
      `,
      [
        customer.id,
        sourceConsultationInternalId,
        input.title,
        input.description,
        input.dueAt,
        input.idempotencyKey,
      ],
    );
    const task = await this.findByIdempotencyKey(input.idempotencyKey);

    if (!task) {
      throw new Error('생성 또는 재조회할 후속 업무를 찾을 수 없습니다.');
    }

    if (insertedRows[0]) {
      return { status: 'created', task };
    }

    return this.resolveExistingTask(task, input);
  }

  private async findConsultationId(
    consultationCode: string | null,
    customerInternalId: string,
  ): Promise<string | null> {
    if (consultationCode === null) {
      return null;
    }

    const rows = await this.database.query<ConsultationIdRow>(
      `
        SELECT id
        FROM consultations
        WHERE consultation_code = $1
          AND customer_id = $2
      `,
      [consultationCode, customerInternalId],
    );

    return rows[0]?.id ?? null;
  }

  private async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<FollowUpTaskReadModel | null> {
    const rows = await this.database.query<FollowUpTaskRow>(
      `
        SELECT
          task.id,
          customer.customer_code,
          consultation.consultation_code,
          task.title,
          task.description,
          task.status,
          task.due_at,
          task.created_at
        FROM follow_up_tasks AS task
        JOIN customers AS customer ON customer.id = task.customer_id
        LEFT JOIN consultations AS consultation
          ON consultation.id = task.source_consultation_id
        WHERE task.idempotency_key = $1
      `,
      [idempotencyKey],
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      customerId: row.customer_code,
      sourceConsultationId: row.consultation_code,
      title: row.title,
      description: row.description,
      status: row.status,
      dueAt: row.due_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }

  private resolveExistingTask(
    task: FollowUpTaskReadModel,
    input: CreateFollowUpTaskInput,
  ): CreateFollowUpTaskResult {
    const normalizedDueAt = input.dueAt
      ? new Date(input.dueAt).toISOString()
      : null;
    const hasSamePayload =
      task.customerId === input.customerId &&
      task.sourceConsultationId === input.sourceConsultationId &&
      task.title === input.title &&
      task.description === input.description &&
      task.dueAt === normalizedDueAt;

    return hasSamePayload
      ? { status: 'existing', task }
      : { status: 'idempotency_conflict', task };
  }
}
