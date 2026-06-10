// services/auth-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AuthModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AuthModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}

void bootstrap();
