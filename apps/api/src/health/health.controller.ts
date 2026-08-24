import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

interface HealthResponse {
  status: 'ok';
}

@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
    };
  }
}
