import { beforeEach, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('정상 상태를 반환한다', () => {
    expect(controller.getHealth()).toEqual({
      status: 'ok',
    });
  });
});
