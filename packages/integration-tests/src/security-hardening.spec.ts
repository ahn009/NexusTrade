// packages/integration-tests/src/security-hardening.spec.ts
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as OTPAuth from 'otpauth';
import { validate } from 'class-validator';
import { RegisterDto } from '../../../services/auth-service/src/dto/auth.dto';
import { AuthController } from '../../../services/auth-service/src/controllers/auth.controller';
import { AuthService } from '../../../services/auth-service/src/services/auth.service';
import { assertSafeProductionSecrets } from '@nexus/shared';
import { UserStatus } from '@nexus/shared';

const root = resolve(__dirname, '../../..');

function readSource(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

function createUserRepository(initialUser: Record<string, unknown>) {
  const user = { ...initialUser };
  return {
    user,
    findOne: jest.fn(async ({ where }: { where: { id?: string; email?: string } }) => (
      where.id === user.id || where.email === user.email ? user : null
    )),
    save: jest.fn(async (next: Record<string, unknown>) => {
      Object.assign(user, next);
      return user;
    }),
    create: jest.fn((next: Record<string, unknown>) => next)
  };
}

function createTotpCode(secret: string) {
  return new OTPAuth.TOTP({
    issuer: 'NexusTrade',
    label: 'NexusTrade',
    secret: OTPAuth.Secret.fromBase32(secret)
  }).generate();
}

describe('critical security hardening regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.ADMIN_EMAILS;
    delete process.env.OPERATOR_EMAILS;
    delete process.env.NODE_ENV;
    delete process.env.JWT_SECRET;
    delete process.env.SERVICE_AUTH_TOKEN;
    delete process.env.API_KEY_SECRET;
    delete process.env.DATABASE_PASSWORD;
  });

  it('keeps TOTP secrets pending until the authenticated user verifies setup', async () => {
    const users = createUserRepository({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: 'unused',
      status: UserStatus.Active,
      totpSecret: null
    });
    const service = new AuthService(users as never, {} as never, { produce: jest.fn() } as never);

    const setup = await service.setupTotp('user-1');
    expect(users.user.totpSecret).toBeNull();

    const failed = await service.verifyTotpForUser({ userId: 'user-1', code: '000000' });
    expect(failed).toEqual({ verified: false });
    expect(users.user.totpSecret).toBeNull();

    const verified = await service.verifyTotpForUser({ userId: 'user-1', code: createTotpCode(setup.secret) });
    expect(verified).toEqual({ verified: true });
    expect(users.user.totpSecret).toBe(setup.secret);
  });

  it('binds user-facing TOTP setup and verification to the JWT user', async () => {
    const auth = {
      setupTotp: jest.fn(),
      verifyTotpForUser: jest.fn()
    };
    const controller = new AuthController(auth as never);

    controller.setupTotp({ user: { userId: 'jwt-user', roles: [] }, headers: {} });
    controller.verifyTotp(
      { user: { userId: 'jwt-user', roles: [] }, headers: {} },
      { userId: 'attacker-target', code: '123456' }
    );

    expect(auth.setupTotp).toHaveBeenCalledWith('jwt-user');
    expect(auth.verifyTotpForUser).toHaveBeenCalledWith({ userId: 'jwt-user', code: '123456' });
  });

  it('keeps privileged gateway endpoints behind RBAC and user-scoped routes behind ownership checks', () => {
    const gateway = readSource('services/api-gateway/src/main.ts');
    expect(gateway).toContain('function requirePrivilegedRole');
    expect(gateway).toContain('function assertSelfOrPrivileged');
    expect(gateway).toContain("throw new ForbiddenException('admin or operator role is required')");
    expect(gateway).toContain("throw new ForbiddenException('cannot access another user account')");

    for (const snippet of [
      '@Patch(\'users/:userId/kyc/:status\')',
      '@Patch(\'users/:userId/tier/:tier\')',
      '@Post(\'withdrawals/:id/approve\')',
      '@Post(\'withdrawals/:id/reject\')',
      '@Post(\'wallets/credit\')',
      '@Post(\'deposits/:id/confirm/:confirmations\')'
    ]) {
      const routeIndex = gateway.indexOf(snippet);
      const guardIndex = gateway.indexOf('requirePrivilegedRole(authorization);', routeIndex);
      expect(routeIndex).toBeGreaterThanOrEqual(0);
      expect(guardIndex).toBeGreaterThan(routeIndex);
    }
  });

  it('keeps financial services checking user/account status before balance-changing work', () => {
    expect(readSource('services/wallet-service/src/services/wallet.service.ts')).toContain('private async assertUserCanTransact');
    expect(readSource('services/trading-service/src/services/trading.service.ts')).toContain('private async assertCanTrade');
    expect(readSource('services/deposit-service/src/services/deposit.service.ts')).toContain('private async assertUserCanTransact');
    expect(readSource('services/withdrawal-service/src/services/withdrawal.service.ts')).toContain('private async assertUserCanTransact');
    expect(readSource('services/trading-service/src/services/trading.service.ts')).toContain('account.isFrozen');
  });

  it('rejects weak registration passwords at the DTO validation layer', async () => {
    const weak = new RegisterDto();
    weak.email = 'user@example.com';
    weak.password = 'longbutweakpassword';
    await expect(validate(weak)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'password' })
    ]));

    const strong = new RegisterDto();
    strong.email = 'user@example.com';
    strong.password = 'StrongerPassword1!';
    await expect(validate(strong)).resolves.toHaveLength(0);
  });

  it('fails fast on unsafe production secret defaults', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'local-jwt-secret-change-me';
    process.env.SERVICE_AUTH_TOKEN = 'local-service-token';
    process.env.API_KEY_SECRET = 'local-api-key-secret';
    process.env.DATABASE_PASSWORD = 'nexus';
    expect(() => assertSafeProductionSecrets()).toThrow('unsafe production secret configuration');

    process.env.JWT_SECRET = 'prod-jwt-secret-at-least-unique';
    process.env.SERVICE_AUTH_TOKEN = 'prod-service-token-at-least-unique';
    process.env.API_KEY_SECRET = 'prod-api-key-secret-at-least-unique';
    process.env.DATABASE_PASSWORD = 'prod-database-password-at-least-unique';
    expect(() => assertSafeProductionSecrets()).not.toThrow();
  });

  it('keeps high-severity transport and lockout hardening hooks wired', () => {
    const auth = readSource('services/auth-service/src/services/auth.service.ts');
    expect(auth).toContain('this.enforceRateLimit(`account:${email}`)');
    expect(auth).toContain('this.recordFailedLogin(`account:${email}`)');
    expect(auth).toContain('this.loginAttempts.delete(`account:${email}`)');

    const grpc = readSource('packages/shared/src/grpc/matching-client.ts');
    expect(grpc).toContain('MATCHING_ENGINE_GRPC_TLS');
    expect(grpc).toContain('grpc.credentials.createSsl');

    const kafka = readSource('packages/shared/src/modules/KafkaModule.ts');
    expect(kafka).toContain('KAFKA_SSL');
    expect(kafka).toContain('KAFKA_SASL_MECHANISM');
    expect(kafka).toContain('KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required');
  });
});
