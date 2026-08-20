import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

interface CustomerRow {
  customer_code: string;
  name: string;
  status: string;
  last_visit_at: Date | null;
}

export interface CustomerReadModel {
  id: string;
  name: string;
  status: string;
  lastVisitAt: string | null;
}

@Injectable()
export class CustomerRepository {
  constructor(private readonly database: DatabaseService) {}

  async findActiveByName(name: string): Promise<CustomerReadModel[]> {
    const rows = await this.database.query<CustomerRow>(
      `
        SELECT
          c.customer_code,
          c.name,
          c.status,
          latest.consulted_at AS last_visit_at
        FROM customers AS c
        LEFT JOIN LATERAL (
          SELECT cs.consulted_at
          FROM consultations AS cs
          WHERE cs.customer_id = c.id
          ORDER BY cs.consulted_at DESC, cs.id DESC
          LIMIT 1
        ) AS latest ON true
        WHERE c.name = $1
          AND c.status = 'active'
        ORDER BY c.customer_code
      `,
      [name],
    );

    return rows.map((row) => ({
      id: row.customer_code,
      name: row.name,
      status: row.status,
      lastVisitAt: row.last_visit_at?.toISOString() ?? null,
    }));
  }
}
