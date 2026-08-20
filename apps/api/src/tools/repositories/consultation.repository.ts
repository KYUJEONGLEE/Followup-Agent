import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

interface CustomerCodeRow {
  customer_code: string;
}

interface ConsultationRow {
  consultation_code: string;
  consulted_at: Date;
  summary: string;
}

export interface ConsultationReadModel {
  id: string;
  consultedAt: string;
  summary: string;
}

export interface CustomerConsultationsReadModel {
  customerId: string;
  consultations: ConsultationReadModel[];
}

@Injectable()
export class ConsultationRepository {
  constructor(private readonly database: DatabaseService) {}

  async findByCustomerCode(
    customerCode: string,
  ): Promise<CustomerConsultationsReadModel | null> {
    const customers = await this.database.query<CustomerCodeRow>(
      `
        SELECT customer_code
        FROM customers
        WHERE customer_code = $1
      `,
      [customerCode],
    );

    if (!customers[0]) {
      return null;
    }

    const rows = await this.database.query<ConsultationRow>(
      `
        SELECT
          cs.consultation_code,
          cs.consulted_at,
          cs.summary
        FROM consultations AS cs
        JOIN customers AS c ON c.id = cs.customer_id
        WHERE c.customer_code = $1
        ORDER BY cs.consulted_at DESC, cs.id DESC
      `,
      [customerCode],
    );

    return {
      customerId: customerCode,
      consultations: rows.map((row) => ({
        id: row.consultation_code,
        consultedAt: row.consulted_at.toISOString(),
        summary: row.summary,
      })),
    };
  }
}
