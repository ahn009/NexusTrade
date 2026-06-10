// services/notification-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpSecurity } from '@nexus/shared';
import { NotificationModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(NotificationModule);
  configureHttpSecurity(app);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3010);
}

void bootstrap();
