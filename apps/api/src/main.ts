import { Logger, ValidationPipe } from '@nestjs/common';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('PORT');
  const corsOrigin = configService.get<string>('CORS_ORIGIN');

  app.use(helmet());
  app.set('trust proxy', 1);

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

  await app.listen(port, '0.0.0.0');
  logger.log(`FollowUp Agent API listening on port ${port}`);
}

void bootstrap();
