import { describe, expect, it } from '@jest/globals';
import {
  BadRequestException,
  ValidationPipe,
  type ArgumentMetadata,
} from '@nestjs/common';
import { ResumeAgentRequestDto } from './resume-agent-request.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: ResumeAgentRequestDto,
};

const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const approvalId = '5225e953-e55c-4e9c-9507-65d9d1d860b2';

describe('ResumeAgentRequestDto', () => {
  it.each(['approve', 'reject'] as const)('%s 결정을 허용한다', async (decision) => {
    const result: unknown = await validationPipe.transform(
      { approvalId, decision },
      metadata,
    );

    expect(result).toEqual({ approvalId, decision });
  });

  it.each([
    { approvalId, decision: 'later' },
    { approvalId },
    { approvalId, decision: true },
    { decision: 'approve' },
    { approvalId: 'invalid', decision: 'approve' },
  ])(
    '지원하지 않는 결정을 거부한다: %p',
    async (payload) => {
      await expect(validationPipe.transform(payload, metadata)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
});
