// services/risk-engine/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpSecurity } from '@nexus/shared';
import { RiskModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(RiskModule);
  configureHttpSecurity(app);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3006);
}

void bootstrap();
