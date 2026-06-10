// services/auth-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { KafkaModule } from '@nexus/shared';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';

@Module({ imports: [KafkaModule], controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
