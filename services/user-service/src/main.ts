// services/user-service/src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpSecurity } from '@nexus/shared';
import { UserModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(UserModule);
  configureHttpSecurity(app);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3002);
}

void bootstrap();
