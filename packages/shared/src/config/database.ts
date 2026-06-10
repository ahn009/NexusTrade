// packages/shared/src/config/database.ts
import { DataSourceOptions } from 'typeorm';

export function getDatabaseEntities(): Function[] {
  const databasePackage = require('@nexus/database') as Record<string, Function>;
  return [
    databasePackage.AccountEntity,
    databasePackage.AuditLogEntity,
    databasePackage.DepositEntity,
    databasePackage.KycRecordEntity,
    databasePackage.LedgerTransactionEntity,
    databasePackage.OrderEntity,
    databasePackage.TradeEntity,
    databasePackage.UserEntity,
    databasePackage.UserProfileEntity,
    databasePackage.WalletEntity,
    databasePackage.WithdrawalEntity
  ];
}

export function createDatabaseConfig(): DataSourceOptions {
  const databaseType = process.env.DATABASE_TYPE ?? (process.env.NODE_ENV === 'test' ? 'sqlite' : 'postgres');
  if (databaseType === 'sqlite') {
    return {
      type: 'sqlite',
      database: process.env.SQLITE_DATABASE ?? ':memory:',
      entities: getDatabaseEntities(),
      synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true' || process.env.NODE_ENV === 'test'
    };
  }

  return {
    type: 'postgres',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? '5432'),
    username: process.env.DATABASE_USER ?? 'nexus',
    password: process.env.DATABASE_PASSWORD ?? 'nexus',
    database: process.env.DATABASE_NAME ?? 'nexus',
    entities: getDatabaseEntities(),
    synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : false
  };
}
