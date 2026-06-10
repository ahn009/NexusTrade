// packages/database/src/seeds/seed.ts
import 'reflect-metadata';
import { AccountTier, KycLevel, UserStatus } from '@nexus/shared';
import { DataSource } from 'typeorm';
import { AccountEntity, UserEntity, WalletEntity } from '../entities/exchange.entities';

export const currencies = ['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'MATIC', 'DOT', 'LINK'];

export const tradingPairs = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'BNB-USDT',
  'XRP-USDT',
  'ADA-USDT',
  'DOGE-USDT',
  'MATIC-USDT',
  'DOT-USDT',
  'LINK-USDT',
  'BTC-USDC',
  'ETH-USDC',
  'SOL-USDC',
  'BNB-BTC',
  'ETH-BTC',
  'SOL-BTC',
  'ADA-BTC',
  'XRP-BTC',
  'LINK-ETH',
  'DOT-ETH'
];

export const feeSchedules = [
  { tier: 'RETAIL', makerBps: '10', takerBps: '10' },
  { tier: 'VIP_1', makerBps: '8', takerBps: '9' },
  { tier: 'VIP_2', makerBps: '6', takerBps: '8' },
  { tier: 'INSTITUTIONAL', makerBps: '2', takerBps: '5' }
];

export const sampleUsers = [
  { email: 'retail@nexustrade.local', kycLevel: KycLevel.Level1, accountTier: AccountTier.Retail },
  { email: 'vip@nexustrade.local', kycLevel: KycLevel.Level3, accountTier: AccountTier.Vip2 },
  { email: 'institution@nexustrade.local', kycLevel: KycLevel.Institutional, accountTier: AccountTier.Institutional }
];

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? '5432'),
    username: process.env.DATABASE_USER ?? 'nexus',
    password: process.env.DATABASE_PASSWORD ?? 'nexus',
    database: process.env.DATABASE_NAME ?? 'nexus',
    entities: [UserEntity, AccountEntity, WalletEntity]
  });
  await dataSource.initialize();
  try {
    for (const user of sampleUsers) {
      let entity = await dataSource.getRepository(UserEntity).findOne({ where: { email: user.email } });
      if (!entity) {
        entity = await dataSource.getRepository(UserEntity).save(dataSource.getRepository(UserEntity).create({
          email: user.email,
          passwordHash: 'seeded-disabled-login',
          status: UserStatus.Active,
          kycLevel: user.kycLevel,
          accountTier: user.accountTier,
          referralCode: user.email.split('@')[0].toUpperCase()
        }));
      }
      const accountRepository = dataSource.getRepository(AccountEntity);
      const existingAccount = await accountRepository.findOne({ where: { userId: entity.id, accountType: 'SPOT' } });
      if (!existingAccount) {
        await accountRepository.save(accountRepository.create({ userId: entity.id, accountType: 'SPOT', tier: user.accountTier, isFrozen: false }));
      }
      for (const asset of ['BTC', 'ETH', 'USDT']) {
        const walletRepository = dataSource.getRepository(WalletEntity);
        const existingWallet = await walletRepository.findOne({ where: { userId: entity.id, asset } });
        if (!existingWallet) {
          await walletRepository.save(walletRepository.create({ userId: entity.id, asset, available: '0', locked: '0' }));
        }
      }
    }
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
