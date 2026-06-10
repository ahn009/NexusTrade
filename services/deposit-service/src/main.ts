// services/deposit-service/src/main.ts
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DepositModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(DepositModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3007);
}

void bootstrap();
