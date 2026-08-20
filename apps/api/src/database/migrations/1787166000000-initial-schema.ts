import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1787166000000 implements MigrationInterface {
  name = 'InitialSchema1787166000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_code varchar(20) NOT NULL,
        name varchar(100) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_customers_customer_code UNIQUE (customer_code),
        CONSTRAINT ck_customers_customer_code_not_blank
          CHECK (btrim(customer_code) <> ''),
        CONSTRAINT ck_customers_name_not_blank
          CHECK (btrim(name) <> ''),
        CONSTRAINT ck_customers_status
          CHECK (status IN ('active', 'inactive'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE consultations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        consultation_code varchar(20) NOT NULL,
        customer_id uuid NOT NULL,
        consulted_at timestamptz NOT NULL,
        summary text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_consultations_consultation_code
          UNIQUE (consultation_code),
        CONSTRAINT uq_consultations_id_customer
          UNIQUE (id, customer_id),
        CONSTRAINT fk_consultations_customer
          FOREIGN KEY (customer_id)
          REFERENCES customers (id)
          ON DELETE RESTRICT,
        CONSTRAINT ck_consultations_code_not_blank
          CHECK (btrim(consultation_code) <> ''),
        CONSTRAINT ck_consultations_summary_not_blank
          CHECK (btrim(summary) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE follow_up_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL,
        source_consultation_id uuid,
        title varchar(200) NOT NULL,
        description text,
        status varchar(20) NOT NULL DEFAULT 'pending',
        due_at timestamptz,
        completed_at timestamptz,
        idempotency_key varchar(100),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_follow_up_tasks_customer
          FOREIGN KEY (customer_id)
          REFERENCES customers (id)
          ON DELETE RESTRICT,
        CONSTRAINT fk_follow_up_tasks_source_consultation
          FOREIGN KEY (source_consultation_id, customer_id)
          REFERENCES consultations (id, customer_id)
          ON DELETE RESTRICT,
        CONSTRAINT ck_follow_up_tasks_title_not_blank
          CHECK (btrim(title) <> ''),
        CONSTRAINT ck_follow_up_tasks_status
          CHECK (
            status IN ('pending', 'in_progress', 'completed', 'cancelled')
          ),
        CONSTRAINT ck_follow_up_tasks_completion
          CHECK (
            (status = 'completed' AND completed_at IS NOT NULL)
            OR (status <> 'completed' AND completed_at IS NULL)
          ),
        CONSTRAINT ck_follow_up_tasks_idempotency_key_not_blank
          CHECK (idempotency_key IS NULL OR btrim(idempotency_key) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_customers_name
        ON customers (name)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_consultations_customer_recent
        ON consultations (customer_id, consulted_at DESC, id DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_consultations_recent
        ON consultations (consulted_at DESC, id DESC, customer_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_follow_up_tasks_customer_created
        ON follow_up_tasks (customer_id, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_follow_up_tasks_open_by_customer
        ON follow_up_tasks (
          customer_id,
          due_at ASC NULLS LAST,
          created_at DESC
        )
        WHERE status IN ('pending', 'in_progress')
    `);

    await queryRunner.query(`
      CREATE INDEX idx_follow_up_tasks_source_consultation
        ON follow_up_tasks (source_consultation_id, customer_id)
        WHERE source_consultation_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_follow_up_tasks_idempotency_key
        ON follow_up_tasks (idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS follow_up_tasks');
    await queryRunner.query('DROP TABLE IF EXISTS consultations');
    await queryRunner.query('DROP TABLE IF EXISTS customers');
  }
}
