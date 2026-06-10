// services/user-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { KafkaModule } from '@nexus/shared';
import { UserController } from './controllers/user.controller';
import { UserService } from './services/user.service';

@Module({ imports: [KafkaModule], controllers: [UserController], providers: [UserService] })
export class UserModule {}
