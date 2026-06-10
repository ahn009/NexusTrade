// services/user-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { UserModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(UserModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3002);
}

void bootstrap();
