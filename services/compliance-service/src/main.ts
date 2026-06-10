// services/compliance-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ComplianceModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(ComplianceModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3009);
}

void bootstrap();
