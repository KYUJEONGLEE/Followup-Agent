import { Logger, ValidationPipe } from '@nestjs/common';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('PORT');
  const corsOrigin = configService.get<string>('CORS_ORIGIN');

  app.use(helmet());

  if (corsOrigin) {
    const validateOrigin: CustomOrigin = (requestOrigin, callback) => {
      const isAllowed =
        requestOrigin === undefined || requestOrigin === corsOrigin;

      callback(null, isAllowed);
    };

    app.enableCors({
      origin: validateOrigin,
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`FollowUp Agent API listening on port ${port}`);
}

void bootstrap();
