import appDataSource from './data-source';
import type { DataSource } from 'typeorm';

interface CustomerIdRow {
  id: string;
}

const customerSeed = {
  id: '00000000-0000-4000-8000-000000000001',
  customerCode: 'C001',
  name: '김민수',
  status: 'active',
} as const;

const consultationSeeds = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    consultationCode: 'CONS001',
    consultedAt: '2026-08-01T10:00:00+09:00',
    summary: '다음 상담 전 생활 습관 확인 필요',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    consultationCode: 'CONS002',
    consultedAt: '2026-07-15T14:00:00+09:00',
    summary: '최근 상태 변화 확인',
  },
] as const;

export async function seedDatabase(
  dataSource: DataSource = appDataSource,
): Promise<void> {
  const managesConnection = !dataSource.isInitialized;

  if (managesConnection) {
    await dataSource.initialize();
  }

  try {
    await dataSource.transaction(async (manager) => {
      const customerRows = await manager.query<CustomerIdRow[]>(
        `
          INSERT INTO customers (id, customer_code, name, status)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (customer_code) DO UPDATE
          SET
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            updated_at = now()
          RETURNING id
        `,
        [
          customerSeed.id,
          customerSeed.customerCode,
          customerSeed.name,
          customerSeed.status,
        ],
      );

      const customerId = customerRows[0]?.id;

      if (!customerId) {
        throw new Error('C001 고객 Seed 결과를 확인할 수 없습니다.');
      }

      for (const consultation of consultationSeeds) {
        await manager.query(
          `
            INSERT INTO consultations (
              id,
              consultation_code,
              customer_id,
              consulted_at,
              summary
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (consultation_code) DO UPDATE
            SET
              customer_id = EXCLUDED.customer_id,
              consulted_at = EXCLUDED.consulted_at,
              summary = EXCLUDED.summary,
              updated_at = now()
          `,
          [
            consultation.id,
            consultation.consultationCode,
            customerId,
            consultation.consultedAt,
            consultation.summary,
          ],
        );
      }
    });

    console.log('Seed 완료: C001 고객 1건, 상담 이력 2건');
  } finally {
    if (managesConnection && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

if (require.main === module) {
  void seedDatabase().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : '알 수 없는 오류';

    console.error(`Seed 실패: ${message}`);
    process.exitCode = 1;
  });
}
