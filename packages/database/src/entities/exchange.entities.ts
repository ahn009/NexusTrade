// packages/database/src/entities/exchange.entities.ts
import {
  AccountTier,
  KycLevel,
  KycStatus,
  OrderSide,
  OrderStatus,
  OrderType,
  TransactionStatus,
  TransactionType,
  UserStatus,
  WalletType
} from '@nexus/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';

@Entity('users')
@Unique(['email'])
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'citext' })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PendingEmail })
  status!: UserStatus;

  @Column({ name: 'kyc_level', type: 'int', default: KycLevel.None })
  kycLevel!: KycLevel;

  @Column({ name: 'account_tier', type: 'enum', enum: AccountTier, default: AccountTier.Retail })
  accountTier!: AccountTier;

  @Column({ name: 'referral_code', type: 'varchar', length: 32, unique: true })
  referralCode!: string;

  @Column({ name: 'totp_secret', type: 'text', nullable: true })
  totpSecret?: string | null;

  @Column({ name: 'webauthn_credentials', type: 'jsonb', default: () => "'[]'::jsonb" })
  webauthnCredentials!: unknown[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

@Entity('user_profiles')
@Index(['userId'])
export class UserProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'first_name', type: 'varchar', length: 120 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 120 })
  lastName!: string;

  @Column({ type: 'varchar', length: 2 })
  country!: string;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth?: string | null;

  @Column({ name: 'phone_number', type: 'varchar', length: 40, nullable: true })
  phoneNumber?: string | null;
}

@Entity('accounts')
@Index(['userId'])
export class AccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'account_type', type: 'varchar', length: 16 })
  accountType!: 'SPOT' | 'MARGIN' | 'FUTURES' | 'OPTIONS';

  @Column({ type: 'enum', enum: AccountTier, default: AccountTier.Retail })
  tier!: AccountTier;

  @Column({ name: 'is_frozen', type: 'boolean', default: false })
  isFrozen!: boolean;
}

@Entity('orders')
@Index(['symbol', 'status', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['clientOrderId'])
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ type: 'varchar', length: 24 })
  symbol!: string;

  @Column({ type: 'enum', enum: OrderSide })
  side!: OrderSide;

  @Column({ type: 'enum', enum: OrderType })
  type!: OrderType;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  price?: string | null;

  @Column({ name: 'stop_price', type: 'numeric', precision: 38, scale: 18, nullable: true })
  stopPrice?: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  quantity!: string;

  @Column({ name: 'filled_quantity', type: 'numeric', precision: 38, scale: 18, default: '0' })
  filledQuantity!: string;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.New })
  status!: OrderStatus;

  @Column({ name: 'client_order_id', type: 'varchar', length: 80, nullable: true })
  clientOrderId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

@Entity('trades')
@Index(['symbol', 'executedAt'])
export class TradeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 24 })
  symbol!: string;

  @Column({ name: 'maker_order_id', type: 'uuid' })
  makerOrderId!: string;

  @Column({ name: 'taker_order_id', type: 'uuid' })
  takerOrderId!: string;

  @Column({ name: 'maker_user_id', type: 'uuid' })
  makerUserId!: string;

  @Column({ name: 'taker_user_id', type: 'uuid' })
  takerUserId!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  price!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  quantity!: string;

  @Column({ name: 'fee_asset', type: 'varchar', length: 16 })
  feeAsset!: string;

  @Column({ name: 'maker_fee', type: 'numeric', precision: 38, scale: 18 })
  makerFee!: string;

  @Column({ name: 'taker_fee', type: 'numeric', precision: 38, scale: 18 })
  takerFee!: string;

  @Column({ name: 'executed_at', type: 'timestamptz' })
  executedAt!: Date;
}

@Entity('wallets')
@Unique(['userId', 'asset', 'walletType'])
export class WalletEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @Column({ name: 'wallet_type', type: 'enum', enum: WalletType, default: WalletType.User })
  walletType!: WalletType;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: '0' })
  available!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: '0' })
  locked!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

@Entity('ledger_transactions')
@Index(['userId', 'createdAt'])
export class LedgerTransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @Column({ type: 'enum', enum: TransactionType })
  type!: TransactionType;

  @Column({ type: 'enum', enum: TransactionStatus })
  status!: TransactionStatus;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  amount!: string;

  @Column({ name: 'balance_after', type: 'numeric', precision: 38, scale: 18 })
  balanceAfter!: string;

  @Column({ name: 'reference_id', type: 'varchar', length: 120, nullable: true })
  referenceId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

@Entity('kyc_records')
export class KycRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'int' })
  level!: KycLevel;

  @Column({ type: 'enum', enum: KycStatus })
  status!: KycStatus;

  @Column({ type: 'varchar', length: 80 })
  provider!: string;

  @Column({ name: 'risk_score', type: 'int' })
  riskScore!: number;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy?: string | null;

  @Column({ name: 'encrypted_payload', type: 'bytea', nullable: true })
  encryptedPayload?: Buffer | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

@Entity('deposits')
@Index(['userId', 'createdAt'])
@Index(['txHash'])
export class DepositEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @Column({ type: 'varchar', length: 32 })
  network!: string;

  @Column({ type: 'varchar', length: 180 })
  address!: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 180, nullable: true })
  txHash?: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: '0' })
  amount!: string;

  @Column({ type: 'int', default: 0 })
  confirmations!: number;

  @Column({ name: 'required_confirmations', type: 'int' })
  requiredConfirmations!: number;

  @Column({ type: 'enum', enum: TransactionStatus })
  status!: TransactionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

@Entity('withdrawals')
@Index(['userId', 'createdAt'])
export class WithdrawalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @Column({ type: 'varchar', length: 32 })
  network!: string;

  @Column({ type: 'varchar', length: 180 })
  address!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  amount!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  fee!: string;

  @Column({ name: 'approval_tier', type: 'varchar', length: 24 })
  approvalTier!: 'AUTO' | 'OPERATOR' | 'MULTI_PARTY' | 'COLD_CEREMONY';

  @Column({ type: 'enum', enum: TransactionStatus })
  status!: TransactionStatus;

  @Column({ name: 'tx_hash', type: 'varchar', length: 180, nullable: true })
  txHash?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

@Entity('audit_logs')
@Index(['aggregateId', 'createdAt'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 120 })
  aggregateId!: string;

  @Column({ type: 'varchar', length: 120 })
  action!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

@Entity('sessions')
@Index(['userId'])
export class SessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'refresh_token_hash', type: 'text' })
  refreshTokenHash!: string;

  @Column({ name: 'device_fingerprint', type: 'varchar', length: 180, nullable: true })
  deviceFingerprint?: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

@Entity('withdrawal_addresses')
@Unique(['userId', 'asset', 'network', 'address'])
@Index(['userId'])
export class WithdrawalAddressEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @Column({ type: 'varchar', length: 32 })
  network!: string;

  @Column({ type: 'varchar', length: 180 })
  address!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

@Entity('referrals')
@Unique(['referrerId', 'referredUserId'])
@Index(['referrerId'])
export class ReferralEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'referrer_id', type: 'uuid' })
  referrerId!: string;

  @Column({ name: 'referred_user_id', type: 'uuid' })
  referredUserId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

@Entity('notifications')
@Index(['recipient', 'createdAt'])
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  channel!: 'email' | 'sms' | 'push' | 'in_app';

  @Column({ type: 'varchar', length: 240 })
  recipient!: string;

  @Column({ type: 'varchar', length: 120 })
  template!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 24, default: 'queued' })
  status!: 'queued' | 'sent' | 'failed';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
