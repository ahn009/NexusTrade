// services/trading-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { TradingModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(TradingModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3003);
}

void bootstrap();
