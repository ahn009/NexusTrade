// services/user-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule, JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { UserController } from './controllers/user.controller';
import { UserService } from './services/user.service';

@Module({ imports: [DatabaseModule.forRoot(), KafkaModule], controllers: [UserController], providers: [UserService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class UserModule {}
