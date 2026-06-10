// services/deposit-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DepositModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(DepositModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3007);
}

void bootstrap();
