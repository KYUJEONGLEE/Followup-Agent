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

describe('ResumeAgentRequestDto', () => {
  it.each(['approve', 'reject'] as const)('%s 결정을 허용한다', async (decision) => {
    const result: unknown = await validationPipe.transform(
      { decision },
      metadata,
    );

    expect(result).toEqual({ decision });
  });

  it.each([{ decision: 'later' }, {}, { decision: true }])(
    '지원하지 않는 결정을 거부한다: %p',
    async (payload) => {
      await expect(validationPipe.transform(payload, metadata)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
});
