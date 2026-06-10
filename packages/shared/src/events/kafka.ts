// packages/shared/src/events/kafka.ts
import { randomUUID } from 'crypto';
import { Deposit, Order, Trade, Withdrawal } from '../types/domain';

export const KafkaTopics = {
  Users: 'nexus.users',
  Orders: 'nexus.orders',
  Trades: 'nexus.trades',
  Wallet: 'nexus.wallet',
  Deposits: 'nexus.deposits',
  Withdrawals: 'nexus.withdrawals',
  Risk: 'nexus.risk',
  Compliance: 'nexus.compliance',
  Notifications: 'nexus.notifications',
  Audit: 'nexus.audit'
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];

export enum EventType {
  UserRegistered = 'UserRegistered',
  KYCVerified = 'KYCVerified',
  OrderPlaced = 'OrderPlaced',
  OrderCancelled = 'OrderCancelled',
  OrderMatched = 'OrderMatched',
  TradeExecuted = 'TradeExecuted',
  BalanceLocked = 'BalanceLocked',
  BalanceSettled = 'BalanceSettled',
  DepositDetected = 'DepositDetected',
  DepositConfirmed = 'DepositConfirmed',
  WithdrawalRequested = 'WithdrawalRequested',
  WithdrawalApproved = 'WithdrawalApproved',
  WithdrawalBroadcasted = 'WithdrawalBroadcasted',
  RiskAlertRaised = 'RiskAlertRaised',
  LiquidationTriggered = 'LiquidationTriggered',
  SuspiciousActivityDetected = 'SuspiciousActivityDetected',
  NotificationRequested = 'NotificationRequested'
}

export interface EventMetadata {
  correlationId: string;
  causationId?: string;
  producer: string;
  schemaVersion: number;
  userId?: string;
  ipAddress?: string;
}

export interface KafkaEvent<TPayload> {
  eventId: string;
  eventType: EventType;
  timestamp: string;
  aggregateId: string;
  payload: TPayload;
  metadata: EventMetadata;
}

export type OrderPlacedEvent = KafkaEvent<Order>;
export type OrderMatchedEvent = KafkaEvent<{ orderId: string; trades: Trade[] }>;
export type TradeExecutedEvent = KafkaEvent<Trade>;
export type DepositDetectedEvent = KafkaEvent<Deposit>;
export type DepositConfirmedEvent = KafkaEvent<Deposit>;
export type WithdrawalRequestedEvent = KafkaEvent<Withdrawal>;

export function createEvent<TPayload>(
  eventType: EventType,
  aggregateId: string,
  payload: TPayload,
  producer: string,
  metadata: Partial<EventMetadata> = {}
): KafkaEvent<TPayload> {
  return {
    eventId: randomUUID(),
    eventType,
    timestamp: new Date().toISOString(),
    aggregateId,
    payload,
    metadata: {
      correlationId: metadata.correlationId ?? randomUUID(),
      causationId: metadata.causationId,
      producer,
      schemaVersion: metadata.schemaVersion ?? 1,
      userId: metadata.userId,
      ipAddress: metadata.ipAddress
    }
  };
}
