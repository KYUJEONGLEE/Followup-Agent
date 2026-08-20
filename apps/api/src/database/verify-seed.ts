import appDataSource from './data-source';

interface CustomerRow {
  customer_code: string;
  name: string;
  status: string;
}

interface ConsultationRow {
  consultation_code: string;
  consulted_at: Date;
  summary: string;
}

async function verifySeed(): Promise<void> {
  await appDataSource.initialize();

  try {
    const customers = await appDataSource.query<CustomerRow[]>(
      `
        SELECT customer_code, name, status
        FROM customers
        WHERE customer_code = $1
      `,
      ['C001'],
    );

    if (customers.length !== 1 || customers[0]?.name !== '김민수') {
      throw new Error('C001 김민수 고객이 정확히 1건이어야 합니다.');
    }

    const consultations = await appDataSource.query<ConsultationRow[]>(
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
      ['C001'],
    );

    if (consultations.length !== 2) {
      throw new Error('C001 상담 이력이 정확히 2건이어야 합니다.');
    }

    console.log(
      JSON.stringify(
        {
          customer: customers[0],
          consultations,
        },
        null,
        2,
      ),
    );
  } finally {
    await appDataSource.destroy();
  }
}

void verifySeed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '알 수 없는 오류';

  console.error(`Seed 검증 실패: ${message}`);
  process.exitCode = 1;
});
