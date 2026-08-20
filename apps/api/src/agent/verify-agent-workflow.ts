import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { AppModule } from '../app.module';
import { AgentWorkflowService } from './agent-workflow.service';

interface VerificationCase {
  title: string;
  message: string;
  expectedTrace: string[];
}

const cases: VerificationCase[] = [
  {
    title: 'Tool 미사용',
    message: '안녕하세요.',
    expectedTrace: ['node:llm'],
  },
  {
    title: '단일 Tool',
    message: '김민수 고객 정보를 알려줘.',
    expectedTrace: ['node:llm', 'tool:get_customer', 'node:llm'],
  },
  {
    title: '다단계 Tool',
    message: '김민수 고객의 기본 정보와 최근 상담 내용을 같이 알려줘.',
    expectedTrace: [
      'node:llm',
      'tool:get_customer',
      'node:llm',
      'tool:get_consultations',
      'node:llm',
    ],
  },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const workflow = app.get(AgentWorkflowService);

    for (const verificationCase of cases) {
      const result = await workflow.run(randomUUID(), verificationCase.message);
      const trace = result.trace.map(
        (entry) => `${entry.type}:${entry.name}`,
      );

      assert.deepEqual(trace, verificationCase.expectedTrace);

      if (verificationCase.title === '다단계 Tool') {
        const consultationsCall = result.trace.find(
          (entry) =>
            entry.type === 'tool' && entry.name === 'get_consultations',
        );

        assert.equal(
          consultationsCall?.type === 'tool'
            ? consultationsCall.arguments.customer_id
            : undefined,
          'C001',
        );
      }

      console.log(
        JSON.stringify(
          {
            title: verificationCase.title,
            message: verificationCase.message,
            answer: result.answer,
            trace: result.trace,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
