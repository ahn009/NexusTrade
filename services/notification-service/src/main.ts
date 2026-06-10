// services/notification-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NotificationModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(NotificationModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3010);
}

void bootstrap();
