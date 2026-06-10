// services/wallet-service/src/main.ts
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WalletModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(WalletModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3004);
}

void bootstrap();
