// services/compliance-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpSecurity } from '@nexus/shared';
import { ComplianceModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(ComplianceModule);
  configureHttpSecurity(app);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3009);
}

void bootstrap();
