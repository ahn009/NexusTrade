// packages/shared/src/types/domain.ts
export type DecimalString = string;

export enum UserStatus {
  PendingEmail = 'PENDING_EMAIL',
  Active = 'ACTIVE',
  Frozen = 'FROZEN',
  Closed = 'CLOSED'
}

export enum KycLevel {
  None = 0,
  Level1 = 1,
  Level2 = 2,
  Level3 = 3,
  Institutional = 4
}

export enum KycStatus {
  NotStarted = 'NOT_STARTED',
  Pending = 'PENDING',
  Approved = 'APPROVED',
  Rejected = 'REJECTED',
  EnhancedDueDiligence = 'ENHANCED_DUE_DILIGENCE'
}

export enum AccountTier {
  Retail = 'RETAIL',
  Vip1 = 'VIP_1',
  Vip2 = 'VIP_2',
  Institutional = 'INSTITUTIONAL'
}

export enum OrderSide {
  Buy = 'BUY',
  Sell = 'SELL'
}

export enum OrderType {
  Market = 'MARKET',
  Limit = 'LIMIT',
  StopMarket = 'STOP_MARKET',
  StopLimit = 'STOP_LIMIT',
  IOC = 'IOC',
  FOK = 'FOK',
  PostOnly = 'POST_ONLY'
}

export enum OrderStatus {
  New = 'NEW',
  PartiallyFilled = 'PARTIALLY_FILLED',
  Filled = 'FILLED',
  Cancelled = 'CANCELLED',
  Rejected = 'REJECTED',
  Expired = 'EXPIRED',
  Triggered = 'TRIGGERED'
}

export enum WalletType {
  Hot = 'HOT',
  Warm = 'WARM',
  Cold = 'COLD',
  User = 'USER'
}

export enum TransactionType {
  Deposit = 'DEPOSIT',
  Withdrawal = 'WITHDRAWAL',
  TradeSettlement = 'TRADE_SETTLEMENT',
  InternalTransfer = 'INTERNAL_TRANSFER',
  Fee = 'FEE'
}

export enum TransactionStatus {
  Pending = 'PENDING',
  Confirmed = 'CONFIRMED',
  Failed = 'FAILED',
  Reversed = 'REVERSED'
}

export interface User {
  id: string;
  email: string;
  status: UserStatus;
  kycLevel: KycLevel;
  accountTier: AccountTier;
  referralCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  userId: string;
  firstName: string;
  lastName: string;
  country: string;
  dateOfBirth?: string;
  phoneNumber?: string;
}

export interface Account {
  id: string;
  userId: string;
  accountType: 'SPOT' | 'MARGIN' | 'FUTURES' | 'OPTIONS';
  tier: AccountTier;
  isFrozen: boolean;
}

export interface Order {
  id: string;
  userId: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: DecimalString;
  stopPrice?: DecimalString;
  quantity: DecimalString;
  filledQuantity: DecimalString;
  status: OrderStatus;
  clientOrderId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Trade {
  id: string;
  symbol: string;
  makerOrderId: string;
  takerOrderId: string;
  makerUserId: string;
  takerUserId: string;
  price: DecimalString;
  quantity: DecimalString;
  feeAsset: string;
  makerFee: DecimalString;
  takerFee: DecimalString;
  executedAt: string;
}

export interface Wallet {
  id: string;
  userId: string;
  asset: string;
  walletType: WalletType;
  available: DecimalString;
  locked: DecimalString;
}

export interface LedgerTransaction {
  id: string;
  userId: string;
  asset: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: DecimalString;
  balanceAfter: DecimalString;
  referenceId?: string;
  createdAt: string;
}

export interface KycRecord {
  id: string;
  userId: string;
  level: KycLevel;
  status: KycStatus;
  provider: string;
  riskScore: number;
  reviewedBy?: string;
}

export interface Deposit {
  id: string;
  userId: string;
  asset: string;
  network: string;
  address: string;
  txHash?: string;
  amount: DecimalString;
  confirmations: number;
  requiredConfirmations: number;
  status: TransactionStatus;
}

export interface Withdrawal {
  id: string;
  userId: string;
  asset: string;
  network: string;
  address: string;
  amount: DecimalString;
  fee: DecimalString;
  approvalTier: 'AUTO' | 'OPERATOR' | 'MULTI_PARTY' | 'COLD_CEREMONY';
  status: TransactionStatus;
}
