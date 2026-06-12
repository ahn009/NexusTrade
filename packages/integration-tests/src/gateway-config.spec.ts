// packages/integration-tests/src/gateway-config.spec.ts
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const gatewaySource = readFileSync(resolve(root, 'services/api-gateway/src/main.ts'), 'utf8');
const composeSource = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
const k8sSource = readFileSync(resolve(root, 'infra/k8s/nexustrade.yaml'), 'utf8');

describe('API gateway upstream coverage', () => {
  const upstreams = [
    { key: 'auth', env: 'AUTH_SERVICE_URL', route: "Post('auth/login')" },
    { key: 'user', env: 'USER_SERVICE_URL', route: "Get('users/:userId/profile')" },
    { key: 'trading', env: 'TRADING_SERVICE_URL', route: "Post('orders')" },
    { key: 'wallet', env: 'WALLET_SERVICE_URL', route: "Post('wallets/credit')" },
    { key: 'marketData', env: 'MARKET_DATA_SERVICE_URL', route: "Get('depth')" },
    { key: 'risk', env: 'RISK_SERVICE_URL', route: "Post('risk/evaluate')" },
    { key: 'deposit', env: 'DEPOSIT_SERVICE_URL', route: "Post('deposits/address')" },
    { key: 'withdrawal', env: 'WITHDRAWAL_SERVICE_URL', route: "Post('withdrawals')" },
    { key: 'compliance', env: 'COMPLIANCE_SERVICE_URL', route: "Post('compliance/screen')" },
    { key: 'notification', env: 'NOTIFICATION_SERVICE_URL', route: "Post('notifications')" }
  ];

  it.each(upstreams)('wires $key through gateway source and deployment env', ({ key, env, route }) => {
    expect(gatewaySource).toContain(`${key}: process.env.${env}`);
    expect(gatewaySource).toContain(route);
    expect(composeSource).toContain(`${env}: http://`);
    expect(k8sSource).toContain(`${env}: http://`);
  });

  it('forwards upstream PATCH endpoints as PATCH', () => {
    expect(gatewaySource).toContain('async patch<TBody>');
    expect(gatewaySource).toContain("return this.proxy.patch('user'");
  });
});
