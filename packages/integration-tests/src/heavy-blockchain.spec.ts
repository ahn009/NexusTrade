// packages/integration-tests/src/heavy-blockchain.spec.ts
import { address as bitcoinAddress, networks, payments } from 'bitcoinjs-lib';
import { isAddress } from 'ethers';
import { DepositService } from '../../../services/deposit-service/src/services/deposit.service';
import { WalletService } from '../../../services/wallet-service/src/services/wallet.service';
import { WithdrawalService } from '../../../services/withdrawal-service/src/services/withdrawal.service';
import { EventType, KafkaTopics, money, TransactionStatus } from '@nexus/shared';

type StoredRecord = Record<string, unknown> & { id: string; createdAt?: Date };

function createRepositoryMock(initialRows: StoredRecord[] = []) {
  const rows = [...initialRows];
  return {
    rows,
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => (
      rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null
    )),
    create: jest.fn((input: StoredRecord) => ({ ...input, createdAt: input.createdAt ?? new Date() })),
    save: jest.fn(async (input: StoredRecord) => {
      const existingIndex = rows.findIndex((row) => row.id === input.id);
      if (existingIndex === -1) rows.push(input);
      else rows[existingIndex] = input;
      return input;
    }),
    find: jest.fn(async () => rows)
  };
}

function createKafkaMock() {
  const produced: Array<{ topic: string; payload: { eventType: EventType }; key?: string }> = [];
  return {
    produced,
    produce: jest.fn(async (topic: string, payload: { eventType: EventType }, key?: string) => {
      produced.push({ topic, payload, key });
    }),
    consume: jest.fn()
  };
}

function isSolanaAddressShape(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

describe('NexusTrade heavy-use and blockchain flows', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MIN_DEPOSIT_AMOUNT;
    delete process.env.WITHDRAWAL_TOTP_REQUIRED;
    delete process.env.WITHDRAWAL_WHITELIST_COOLDOWN_MS;
  });

  it('validates supported blockchain address formats with chain libraries', () => {
    const btcAddress = payments.p2wpkh({
      pubkey: Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
      network: networks.bitcoin
    }).address;

    expect(btcAddress).toMatch(/^bc1/);
    expect(() => bitcoinAddress.toOutputScript(btcAddress!, networks.bitcoin)).not.toThrow();
    expect(isAddress('0x000000000000000000000000000000000000dEaD')).toBe(true);
    expect(isSolanaAddressShape('11111111111111111111111111111111')).toBe(true);
    expect(isSolanaAddressShape('0x000000000000000000000000000000000000dEaD')).toBe(false);
  });

  it('keeps high-volume wallet locks and trade settlements exact under heavy use', async () => {
    jest.setTimeout(30_000);
    const wallet = new WalletService(undefined as never, createKafkaMock() as never);
    const iterations = 2500;
    const price = '25000.12345678';
    const quantity = '0.00001';
    const quoteAmount = money(price).mul(quantity).toFixed();
    const makerFee = '0.00001';
    const takerFee = '0.00002';
    const totalQuantity = money(quantity).mul(iterations).toFixed();
    const buyerDebit = money(quoteAmount).plus(takerFee).mul(iterations).toFixed();
    const sellerCredit = money(quoteAmount).minus(makerFee).mul(iterations).toFixed();

    await wallet.credit({ userId: 'heavy-buyer', asset: 'USDT', amount: buyerDebit, referenceId: 'seed-buyer' });
    await wallet.credit({ userId: 'heavy-seller', asset: 'BTC', amount: totalQuantity, referenceId: 'seed-seller' });

    for (let index = 0; index < iterations; index += 1) {
      await wallet.lock({ userId: 'heavy-buyer', asset: 'USDT', amount: money(quoteAmount).plus(takerFee).toFixed(), referenceId: `buyer-lock-${index}` });
      await wallet.lock({ userId: 'heavy-seller', asset: 'BTC', amount: quantity, referenceId: `seller-lock-${index}` });
      await wallet.settleTrade({
        makerUserId: 'heavy-seller',
        takerUserId: 'heavy-buyer',
        makerSide: 'SELL',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        price,
        quantity,
        makerFee,
        takerFee,
        referenceId: `trade-${index}`
      });
    }

    await expect(wallet.getBalance('heavy-buyer', 'USDT')).resolves.toMatchObject({ available: '0', locked: '0' });
    await expect(wallet.getBalance('heavy-buyer', 'BTC')).resolves.toMatchObject({ available: totalQuantity, locked: '0' });
    await expect(wallet.getBalance('heavy-seller', 'BTC')).resolves.toMatchObject({ available: '0', locked: '0' });
    await expect(wallet.getBalance('heavy-seller', 'USDT')).resolves.toMatchObject({ available: sellerCredit, locked: '0' });
  });

  it('enforces blockchain deposit minimums, duplicate tx hashes, and confirmation thresholds', async () => {
    process.env.MIN_DEPOSIT_AMOUNT = '0.00000001';
    const deposits = createRepositoryMock();
    const kafka = createKafkaMock();
    const service = new DepositService(deposits as never, kafka as never);

    expect(service.generateAddress({ userId: 'user-1', asset: 'BTC', network: 'bitcoin' }).address).toMatch(/^bc1/);
    expect(service.generateAddress({ userId: 'user-1', asset: 'ETH', network: 'ethereum' }).address).toMatch(/^0x/);
    expect(service.generateAddress({ userId: 'user-1', asset: 'SOL', network: 'solana' }).address).toMatch(/^SoL/);

    await expect(service.simulateDeposit({
      userId: 'user-1',
      asset: 'BTC',
      network: 'bitcoin',
      txHash: 'btc-tx-low',
      amount: '0.000000001'
    })).rejects.toThrow('deposit below minimum amount');

    const { deposit } = await service.simulateDeposit({
      userId: 'user-1',
      asset: 'BTC',
      network: 'bitcoin',
      txHash: 'btc-tx-1',
      amount: '0.25'
    });
    expect(deposit.requiredConfirmations).toBe(3);
    expect(kafka.produced.at(-1)).toMatchObject({ topic: KafkaTopics.Deposits, payload: { eventType: EventType.DepositDetected } });

    await expect(service.simulateDeposit({
      userId: 'user-1',
      asset: 'BTC',
      network: 'bitcoin',
      txHash: 'btc-tx-1',
      amount: '0.25'
    })).rejects.toThrow('deposit txHash already processed');

    const pending = await service.confirm(deposit.id, 2);
    const pendingDeposit = pending.deposit;
    const pendingEvent = pending.event;
    if (!pendingDeposit || !pendingEvent) throw new Error('deposit should exist for pending confirmation');
    expect(pendingDeposit.status).toBe(TransactionStatus.Pending);
    expect(pendingEvent.eventType).toBe(EventType.DepositDetected);

    const confirmed = await service.confirm(deposit.id, 3);
    const confirmedDeposit = confirmed.deposit;
    const confirmedEvent = confirmed.event;
    if (!confirmedDeposit || !confirmedEvent) throw new Error('deposit should exist for final confirmation');
    expect(confirmedDeposit.status).toBe(TransactionStatus.Confirmed);
    expect(confirmedEvent.eventType).toBe(EventType.DepositConfirmed);

    await expect(service.simulateDeposit({
      userId: 'user-1',
      asset: 'SOL',
      network: 'solana',
      txHash: 'sol-tx-1',
      amount: '1'
    })).resolves.toMatchObject({ deposit: { requiredConfirmations: 32 } });
  });

  it('applies blockchain withdrawal security gates, fees, and approval tiers', async () => {
    process.env.WITHDRAWAL_WHITELIST_COOLDOWN_MS = '0';
    const oldWhitelistDate = new Date(Date.now() - 60_000);
    const addresses = createRepositoryMock([
      { id: 'addr-1', userId: 'user-1', asset: 'USDT', network: 'ethereum', address: '0x000000000000000000000000000000000000dEaD', createdAt: oldWhitelistDate }
    ]);
    const withdrawals = createRepositoryMock();
    const kafka = createKafkaMock();
    const service = new WithdrawalService(withdrawals as never, addresses as never, kafka as never);
    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/totp/verify')) return { ok: true, json: async () => ({ verified: true }) } as Response;
      if (url.includes('/wallets/')) return { ok: true, json: async () => ({ available: '2000000' }) } as Response;
      return { ok: false, json: async () => ({}) } as Response;
    });

    const cases = [
      { amount: '9999.99', tier: 'AUTO', status: TransactionStatus.Confirmed },
      { amount: '10000', tier: 'OPERATOR', status: TransactionStatus.Pending },
      { amount: '100000', tier: 'MULTI_PARTY', status: TransactionStatus.Pending },
      { amount: '1000000', tier: 'COLD_CEREMONY', status: TransactionStatus.Pending }
    ] as const;

    for (const testCase of cases) {
      const result = await service.request({
        userId: 'user-1',
        asset: 'USDT',
        network: 'ethereum',
        address: '0x000000000000000000000000000000000000dEaD',
        amount: testCase.amount,
        totpCode: '123456'
      });
      expect(result.withdrawal.approvalTier).toBe(testCase.tier);
      expect(result.withdrawal.status).toBe(testCase.status);
      expect(result.withdrawal.fee).toBe(money(testCase.amount).mul('0.001').toFixed());
      expect(result.event.eventType).toBe(EventType.WithdrawalRequested);
    }

    await expect(service.request({
      userId: 'user-1',
      asset: 'USDT',
      network: 'ethereum',
      address: '0x0000000000000000000000000000000000000000',
      amount: '1',
      totpCode: '123456'
    })).rejects.toThrow('withdrawal address is not whitelisted');
  });
});
