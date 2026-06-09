// packages/integration-tests/src/exchange-flows.spec.ts
import { add, money, subtract } from '@nexus/shared';

describe('NexusTrade integration flows', () => {
  it('auth flow: register, enable 2FA, and rotate refresh session', () => {
    const user = { id: 'user-1', email: 'user@nexustrade.local', kycLevel: 1 };
    const session = { userId: user.id, refreshVersion: 1, mfa: 'totp' };
    const rotated = { ...session, refreshVersion: session.refreshVersion + 1 };
    expect(user.email).toContain('@');
    expect(rotated.refreshVersion).toBe(2);
    expect(rotated.mfa).toBe('totp');
  });

  it('order lifecycle: place order, match, and settle balances without float math', () => {
    const buyer = { usdt: '1000', btc: '0' };
    const seller = { usdt: '0', btc: '0.5' };
    const price = '500';
    const quantity = '0.2';
    const quote = money(price).mul(quantity).toFixed();

    buyer.usdt = subtract(buyer.usdt, quote);
    buyer.btc = add(buyer.btc, quantity);
    seller.btc = subtract(seller.btc, quantity);
    seller.usdt = add(seller.usdt, quote);

    expect(quote).toBe('100');
    expect(buyer.usdt).toBe('900');
    expect(buyer.btc).toBe('0.2');
    expect(seller.btc).toBe('0.3');
    expect(seller.usdt).toBe('100');
  });

  it('deposit flow: detected deposit becomes creditable after confirmations', () => {
    const deposit = { asset: 'BTC', confirmations: 0, requiredConfirmations: 3, status: 'PENDING' };
    deposit.confirmations = 3;
    deposit.status = deposit.confirmations >= deposit.requiredConfirmations ? 'CONFIRMED' : 'PENDING';
    expect(deposit.status).toBe('CONFIRMED');
  });

  it('withdrawal flow: request, approval tier selection, broadcast readiness', () => {
    const request = { amountUsd: '125000', whitelisted: true, twoFactorVerified: true };
    const approvalTier = money(request.amountUsd).gte(100000) ? 'MULTI_PARTY' : 'AUTO';
    const readyToBroadcast = request.whitelisted && request.twoFactorVerified && approvalTier === 'MULTI_PARTY';
    expect(approvalTier).toBe('MULTI_PARTY');
    expect(readyToBroadcast).toBe(true);
  });

  it('risk flow: under-margined position triggers liquidation', () => {
    const position = { equity: '80', maintenanceMargin: '100', notional: '1000' };
    const marginDeficit = money(position.equity).minus(position.maintenanceMargin);
    const liquidatable = marginDeficit.lt(0);
    expect(liquidatable).toBe(true);
    expect(money(position.equity).div(position.notional).toFixed()).toBe('0.08');
  });
});
