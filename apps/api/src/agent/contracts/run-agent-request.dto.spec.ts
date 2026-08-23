import { describe, expect, it } from '@jest/globals';
import {
  BadRequestException,
  ValidationPipe,
  type ArgumentMetadata,
} from '@nestjs/common';
import {
  AGENT_MESSAGE_MAX_LENGTH,
  RunAgentRequestDto,
} from './run-agent-request.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: RunAgentRequestDto,
};

function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}

describe('RunAgentRequestDto', () => {
  it('앞뒤 공백을 제거한 유효한 메시지를 허용한다', async () => {
    const result: unknown = await createValidationPipe().transform(
      { message: '  김민수 고객 정보를 알려줘.  ' },
      metadata,
    );

    expect(result).toEqual({
      message: '김민수 고객 정보를 알려줘.',
      writeApprovalMode: 'required',
    });
  });

  it('요청자가 auto Write 정책을 선택할 수 있다', async () => {
    const result: unknown = await createValidationPipe().transform(
      {
        message: '김민수 고객의 후속 업무를 만들어줘.',
        writeApprovalMode: 'auto',
      },
      metadata,
    );

    expect(result).toEqual({
      message: '김민수 고객의 후속 업무를 만들어줘.',
      writeApprovalMode: 'auto',
    });
  });

  it('지원하지 않는 Write 승인 정책을 거부한다', async () => {
    await expect(
      createValidationPipe().transform(
        { message: '후속 업무를 만들어줘.', writeApprovalMode: 'always' },
        metadata,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([{ message: '' }, { message: '   ' }, { message: 123 }])(
    '비어 있거나 문자열이 아닌 메시지를 거부한다: %p',
    async (payload) => {
      await expect(
        createValidationPipe().transform(payload, metadata),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('최대 길이를 초과한 메시지를 거부한다', async () => {
    await expect(
      createValidationPipe().transform(
        { message: '가'.repeat(AGENT_MESSAGE_MAX_LENGTH + 1) },
        metadata,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('계약에 없는 필드를 거부한다', async () => {
    await expect(
      createValidationPipe().transform(
        { message: '안녕하세요.', unexpected: true },
        metadata,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
