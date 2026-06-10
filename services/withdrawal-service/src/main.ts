// services/withdrawal-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WithdrawalModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(WithdrawalModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3008);
}

void bootstrap();
