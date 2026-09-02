import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { AgentWorkflowService } from '../src/agent/agent-workflow.service';
import {
  AGENT_LLM_CLIENT,
  type AgentLlmClient,
  type AgentLlmResult,
} from '../src/agent/llm/agent-llm-client';
import { DatabaseService } from '../src/database/database.service';
import { ToolsModule } from '../src/tools/tools.module';
import { createWriteIdempotencyKey } from '../src/tools/write/create-follow-up-task.tool';

interface CountRow {
  count: string;
}

class MutableScriptedLlmClient implements AgentLlmClient {
  private results: AgentLlmResult[] = [];

  setResults(results: AgentLlmResult[]): void {
    this.results = [...results];
  }

  createResponse(): Promise<AgentLlmResult> {
    const result = this.results.shift();

    if (!result) {
      throw new Error('준비된 통합 테스트 LLM 응답이 없습니다.');
    }

    return Promise.resolve(result);
  }
}

const executions = {
  required: { executionId: 'approval-db-required', callId: 'call-db-required' },
  rejected: { executionId: 'approval-db-rejected', callId: 'call-db-rejected' },
  auto: { executionId: 'approval-db-auto', callId: 'call-db-auto' },
} as const;

const idempotencyKeys = Object.values(executions).map((context) =>
  createWriteIdempotencyKey(context),
);

function writeToolCall(callId: string, title: string): AgentLlmResult {
  return {
    type: 'tool_call',
    responseId: `response-${callId}`,
    toolCall: {
      callId,
      name: 'create_follow_up_task',
      arguments: JSON.stringify({
        customer_id: 'C001',
        source_consultation_id: 'CONS001',
        title,
        description: 'AGENT-19 승인 Workflow 통합 테스트',
        due_at: null,
      }),
    },
  };
}

describe('PostgreSQL Approval Workflow (integration)', () => {
  let moduleRef: TestingModule | undefined;
  let database: DatabaseService | undefined;
  let workflow: AgentWorkflowService;
  const llm = new MutableScriptedLlmClient();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), ToolsModule],
      providers: [
        AgentWorkflowService,
        { provide: AGENT_LLM_CLIENT, useValue: llm },
      ],
    }).compile();
    await moduleRef.init();

    const initializedDatabase = moduleRef.get(DatabaseService);
    database = initializedDatabase;
    workflow = moduleRef.get(AgentWorkflowService);

    await initializedDatabase.query(
      `DELETE FROM follow_up_tasks WHERE idempotency_key = ANY($1::text[])`,
      [idempotencyKeys],
    );
  });

  afterAll(async () => {
    try {
      if (database) {
        await database.query(
          `DELETE FROM follow_up_tasks WHERE idempotency_key = ANY($1::text[])`,
          [idempotencyKeys],
        );
      }
    } finally {
      await moduleRef?.close();
    }
  });

  it('승인 전에는 0건이고 승인 후 중복 재개해도 정확히 1건이다', async () => {
    llm.setResults([
      writeToolCall(executions.required.callId, '[integration] 승인 업무'),
      {
        type: 'final_answer',
        responseId: 'response-db-required-final',
        answer: '승인된 후속 업무를 생성했습니다.',
      },
    ]);

    const pending = await workflow.run(
      executions.required.executionId,
      '김민수 고객의 후속 업무를 만들어줘.',
      'required',
    );

    expect(pending.status).toBe('awaiting_approval');
    await expect(countTasks(executions.required)).resolves.toBe(0);

    const [approved, concurrentDuplicate] = await Promise.all([
      workflow.resume(executions.required.executionId, pending.approval!.id, 'approve'),
      workflow.resume(executions.required.executionId, pending.approval!.id, 'approve'),
    ]);

    expect(approved.status).toBe('completed');
    expect(concurrentDuplicate).toEqual(approved);
    await expect(countTasks(executions.required)).resolves.toBe(1);

    const duplicate = await workflow.resume(
      executions.required.executionId,
      pending.approval!.id,
      'approve',
    );

    expect(duplicate).toEqual(approved);
    await expect(countTasks(executions.required)).resolves.toBe(1);
  });

  it('거절하면 PostgreSQL 데이터를 변경하지 않는다', async () => {
    llm.setResults([
      writeToolCall(executions.rejected.callId, '[integration] 거절 업무'),
    ]);

    const pending = await workflow.run(
      executions.rejected.executionId,
      '거절할 후속 업무를 만들어줘.',
      'required',
    );
    const rejected = await workflow.resume(
      executions.rejected.executionId,
      pending.approval!.id,
      'reject',
    );

    expect(rejected.status).toBe('rejected');
    await expect(countTasks(executions.rejected)).resolves.toBe(0);
  });

  it('auto 정책은 중단 없이 PostgreSQL에 한 건을 생성한다', async () => {
    llm.setResults([
      writeToolCall(executions.auto.callId, '[integration] 자동 승인 업무'),
      {
        type: 'final_answer',
        responseId: 'response-db-auto-final',
        answer: '자동 승인된 후속 업무를 생성했습니다.',
      },
    ]);

    const result = await workflow.run(
      executions.auto.executionId,
      '후속 업무를 바로 만들어줘.',
      'auto',
    );

    expect(result.status).toBe('completed');
    expect(result.writeApprovalMode).toBe('auto');
    await expect(countTasks(executions.auto)).resolves.toBe(1);
  });

  async function countTasks(context: {
    executionId: string;
    callId: string;
  }): Promise<number> {
    if (!database) {
      throw new Error('통합 테스트 Database가 초기화되지 않았습니다.');
    }

    const rows = await database.query<CountRow>(
      `SELECT COUNT(*)::text AS count FROM follow_up_tasks WHERE idempotency_key = $1`,
      [createWriteIdempotencyKey(context)],
    );

    return Number(rows[0]?.count ?? 0);
  }
});
