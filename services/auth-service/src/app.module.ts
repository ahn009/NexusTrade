// services/auth-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';

@Module({ imports: [KafkaModule], controllers: [AuthController], providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class AuthModule {}
