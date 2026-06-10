// packages/shared/src/modules/DatabaseModule.ts
import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createDatabaseConfig, getDatabaseEntities } from '../config/database';

@Module({})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [TypeOrmModule.forRoot(createDatabaseConfig()), TypeOrmModule.forFeature(getDatabaseEntities())],
      exports: [TypeOrmModule]
    };
  }
}
