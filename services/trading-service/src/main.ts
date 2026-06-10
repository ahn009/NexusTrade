// services/trading-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpSecurity } from '@nexus/shared';
import { TradingModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(TradingModule);
  configureHttpSecurity(app);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3003);
}

void bootstrap();
