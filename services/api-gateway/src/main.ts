// services/api-gateway/src/main.ts
import 'reflect-metadata';
import { Body, CanActivate, Controller, ExecutionContext, Get, Headers, HttpException, HttpStatus, Injectable, Module, Param, Patch, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import { configureHttpSecurity, extractBearerToken, Public, verifyJwtToken } from '@nexus/shared';

@Injectable()
class GatewayAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublicRoute', [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const bearer = extractBearerToken(req.headers.authorization);
    if (bearer) {
      req.user = verifyJwtToken(bearer);
      return true;
    }

    if (this.hasValidApiSignature(req.method, req.url, req.headers['x-api-key'], req.headers['x-signature'])) {
      return true;
    }
    throw new UnauthorizedException('valid JWT or API signature is required');
  }

  private hasValidApiSignature(method: string, url: string, apiKey?: string, signature?: string): boolean {
    const secret = process.env.API_KEY_SECRET;
    if (!secret || !apiKey || !signature) return false;
    const expected = createHmac('sha256', secret).update(`${method}:${url}`).digest('hex');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }
}

@Injectable()
class GatewayRateGuard implements CanActivate {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.userId as string | undefined;
    const key = userId ? `user:${userId}` : `ip:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;
    const limit = userId
      ? Number(process.env.GATEWAY_AUTH_RATE_LIMIT_PER_MINUTE ?? '6000')
      : Number(process.env.GATEWAY_PUBLIC_RATE_LIMIT_PER_MINUTE ?? '1200');
    const now = Date.now();
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    current.count += 1;
    if (current.count > limit) {
      throw new HttpException('rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

@Injectable()
class GatewayProxy {
  private readonly upstreams = {
    auth: process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001',
    user: process.env.USER_SERVICE_URL ?? 'http://localhost:3002',
    trading: process.env.TRADING_SERVICE_URL ?? 'http://localhost:3003',
    wallet: process.env.WALLET_SERVICE_URL ?? 'http://localhost:3004',
    marketData: process.env.MARKET_DATA_SERVICE_URL ?? 'http://localhost:3005',
    risk: process.env.RISK_SERVICE_URL ?? 'http://localhost:3006',
    deposit: process.env.DEPOSIT_SERVICE_URL ?? 'http://localhost:3007',
    withdrawal: process.env.WITHDRAWAL_SERVICE_URL ?? 'http://localhost:3008',
    compliance: process.env.COMPLIANCE_SERVICE_URL ?? 'http://localhost:3009',
    notification: process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3010'
  };
  private readonly timeoutMs = Number(process.env.GATEWAY_UPSTREAM_TIMEOUT_MS ?? '5000');
  private readonly circuitFailures = Number(process.env.GATEWAY_CIRCUIT_FAILURES ?? '3');
  private readonly circuitOpenMs = Number(process.env.GATEWAY_CIRCUIT_OPEN_MS ?? '30000');
  private readonly circuits = new Map<keyof GatewayProxy['upstreams'], { failures: number; openUntil: number }>();

  async post<TBody>(base: keyof GatewayProxy['upstreams'], path: string, body: TBody, authorization?: string, requestId?: string) {
    const response = await this.fetchWithCircuit(base, path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.forwardHeaders(authorization, requestId)
      },
      body: JSON.stringify(body)
    });
    return this.readResponse(response);
  }

  async patch<TBody>(base: keyof GatewayProxy['upstreams'], path: string, body: TBody, authorization?: string, requestId?: string) {
    const response = await this.fetchWithCircuit(base, path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...this.forwardHeaders(authorization, requestId)
      },
      body: JSON.stringify(body)
    });
    return this.readResponse(response);
  }

  async get(base: keyof GatewayProxy['upstreams'], path: string, authorization?: string, requestId?: string) {
    const response = await this.fetchWithCircuit(base, path, {
      headers: this.forwardHeaders(authorization, requestId)
    });
    return this.readResponse(response);
  }

  private async fetchWithCircuit(base: keyof GatewayProxy['upstreams'], path: string, init: RequestInit) {
    const state = this.circuits.get(base);
    if (state && state.openUntil > Date.now()) {
      throw new HttpException(`${String(base)} upstream circuit is open`, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.upstreams[base]}${path}`, { ...init, signal: controller.signal });
      this.circuits.set(base, { failures: 0, openUntil: 0 });
      return response;
    } catch (error) {
      const failures = (state?.failures ?? 0) + 1;
      this.circuits.set(base, {
        failures,
        openUntil: failures >= this.circuitFailures ? Date.now() + this.circuitOpenMs : 0
      });
      throw new HttpException(`upstream ${String(base)} unavailable: ${(error as Error).message}`, HttpStatus.SERVICE_UNAVAILABLE);
    } finally {
      clearTimeout(timeout);
    }
  }

  private forwardHeaders(authorization?: string, requestId?: string): Record<string, string> {
    return {
      ...(authorization ? { authorization } : {}),
      ...(requestId ? { 'x-request-id': requestId } : {}),
      ...(process.env.SERVICE_AUTH_TOKEN ? { 'x-service-token': process.env.SERVICE_AUTH_TOKEN } : {})
    };
  }

  private async readResponse(response: Response) {
    const payload = await response.json().catch(() => ({ message: response.statusText }));
    if (!response.ok) {
      return { upstreamStatus: response.status, error: payload };
    }
    return payload;
  }
}

@Controller('api/v3')
@UseGuards(GatewayAuthGuard, GatewayRateGuard)
class GatewayController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'api-gateway',
      upstreams: ['auth', 'user', 'trading', 'wallet', 'market-data', 'risk', 'compliance', 'notification']
    };
  }

  @Get('account')
  account(@Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string, @Query('userId') queryUserId?: string) {
    const userId = queryUserId ?? userIdFromAuthorization(authorization);
    if (!userId) throw new UnauthorizedException('userId is required for API key account requests');
    return this.proxy.get('wallet', `/wallets/${encodeURIComponent(userId)}`, authorization, requestId);
  }

  @Public()
  @Get('exchangeInfo')
  exchangeInfo() {
    return { timezone: 'UTC', symbols: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'], rateLimits: [{ type: 'REQUEST_WEIGHT', interval: 'MINUTE', limit: 1200 }] };
  }

  @Public()
  @Get('ticker/24hr')
  ticker(@Query('symbol') symbol = 'BTC-USDT', @Headers('x-request-id') requestId?: string) {
    return this.proxy.get('marketData', `/ticker/${normalizePair(symbol)}`, undefined, requestId);
  }

  @Public()
  @Post('auth/register')
  register(@Body() body: { email: string; password: string }, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('auth', '/auth/register', body, undefined, requestId);
  }

  @Public()
  @Post('auth/login')
  login(@Body() body: { email: string; password: string; totpCode?: string; deviceFingerprint?: string }, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('auth', '/auth/login', body, undefined, requestId);
  }

  @Post('orders')
  placeOrder(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    const symbol = typeof body.symbol === 'string' ? body.symbol : normalizePair(String(body.pair ?? 'BTCUSDT'));
    const userId = typeof body.userId === 'string' ? body.userId : userIdFromAuthorization(authorization);
    if (!userId) throw new UnauthorizedException('userId is required for API key order requests');
    return this.proxy.post(
      'trading',
      '/orders',
      {
        userId,
        accountId: body.accountId ?? 'spot-account',
        symbol,
        side: body.side,
        type: body.type,
        price: body.price,
        quantity: body.quantity,
        clientOrderId: body.clientOrderId
      },
      authorization,
      requestId
    );
  }

  @Public()
  @Get('depth')
  depth(@Query('symbol') symbol = 'BTCUSDT', @Headers('x-request-id') requestId?: string) {
    return this.proxy.get('marketData', `/depth/${normalizePair(symbol)}`, undefined, requestId);
  }

  @Post('wallets/credit')
  credit(@Body() body: { userId: string; asset: string; amount: string; referenceId?: string }, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('wallet', '/wallets/credit', {
      userId: body.userId,
      asset: body.asset,
      amount: body.amount,
      referenceId: body.referenceId ?? `manual-${Date.now()}`
    }, authorization, requestId);
  }

  @Get('users/:userId/profile')
  getUserProfile(@Param('userId') userId: string, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.get('user', `/users/${encodeURIComponent(userId)}/profile`, authorization, requestId);
  }

  @Post('users/:userId/profile')
  upsertUserProfile(@Param('userId') userId: string, @Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('user', `/users/${encodeURIComponent(userId)}/profile`, body, authorization, requestId);
  }

  @Post('users/:userId/kyc')
  submitKyc(@Param('userId') userId: string, @Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('user', `/users/${encodeURIComponent(userId)}/kyc`, body, authorization, requestId);
  }

  @Patch('users/:userId/kyc/:status')
  reviewKyc(@Param('userId') userId: string, @Param('status') status: string, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.patch('user', `/users/${encodeURIComponent(userId)}/kyc/${encodeURIComponent(status)}`, {}, authorization, requestId);
  }

  @Patch('users/:userId/tier/:tier')
  setTier(@Param('userId') userId: string, @Param('tier') tier: string, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.patch('user', `/users/${encodeURIComponent(userId)}/tier/${encodeURIComponent(tier)}`, {}, authorization, requestId);
  }

  @Post('users/:userId/referrals/:referredUserId')
  addReferral(@Param('userId') userId: string, @Param('referredUserId') referredUserId: string, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('user', `/users/${encodeURIComponent(userId)}/referrals/${encodeURIComponent(referredUserId)}`, {}, authorization, requestId);
  }

  @Post('users/:userId/address-book')
  addAddressBookEntry(@Param('userId') userId: string, @Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('user', `/users/${encodeURIComponent(userId)}/address-book`, body, authorization, requestId);
  }

  @Post('deposits/address')
  depositAddress(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('deposit', '/deposits/address', body, authorization, requestId);
  }

  @Post('deposits/simulate')
  simulateDeposit(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('deposit', '/deposits/simulate', body, authorization, requestId);
  }

  @Post('deposits/:id/confirm/:confirmations')
  confirmDeposit(@Param('id') id: string, @Param('confirmations') confirmations: string, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('deposit', `/deposits/${encodeURIComponent(id)}/confirm/${encodeURIComponent(confirmations)}`, {}, authorization, requestId);
  }

  @Get('deposits')
  listDeposits(@Query('userId') userId?: string, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.get('deposit', `/deposits${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`, authorization, requestId);
  }

  @Post('withdrawals/whitelist/:userId')
  whitelistWithdrawalAddress(@Param('userId') userId: string, @Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('withdrawal', `/withdrawals/whitelist/${encodeURIComponent(userId)}`, body, authorization, requestId);
  }

  @Post('withdrawals')
  requestWithdrawal(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('withdrawal', '/withdrawals', body, authorization, requestId);
  }

  @Post('withdrawals/:id/approve')
  approveWithdrawal(@Param('id') id: string, @Body() body: { approverId?: string }, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('withdrawal', `/withdrawals/${encodeURIComponent(id)}/approve`, body, authorization, requestId);
  }

  @Post('withdrawals/:id/reject')
  rejectWithdrawal(@Param('id') id: string, @Body() body: { approverId?: string }, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('withdrawal', `/withdrawals/${encodeURIComponent(id)}/reject`, body, authorization, requestId);
  }

  @Get('withdrawals')
  listWithdrawals(@Query('userId') userId?: string, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.get('withdrawal', `/withdrawals${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`, authorization, requestId);
  }

  @Post('risk/evaluate')
  evaluateRisk(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('risk', '/risk/evaluate', body, authorization, requestId);
  }

  @Get('risk/insurance-fund')
  insuranceFund(@Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.get('risk', '/risk/insurance-fund', authorization, requestId);
  }

  @Post('compliance/screen')
  screenCompliance(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('compliance', '/compliance/screen', body, authorization, requestId);
  }

  @Get('compliance/regulatory-matrix')
  regulatoryMatrix(@Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.get('compliance', '/compliance/regulatory-matrix', authorization, requestId);
  }

  @Post('notifications')
  enqueueNotification(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.post('notification', '/notifications', body, authorization, requestId);
  }

  @Get('notifications')
  listNotifications(@Headers('authorization') authorization?: string, @Headers('x-request-id') requestId?: string) {
    return this.proxy.get('notification', '/notifications', authorization, requestId);
  }
}

function normalizePair(symbol: string): string {
  if (symbol.includes('-')) return symbol;
  const quotes = ['USDT', 'USDC', 'BTC', 'ETH'];
  const quote = quotes.find((candidate) => symbol.endsWith(candidate));
  return quote ? `${symbol.slice(0, -quote.length)}-${quote}` : symbol;
}

function userIdFromAuthorization(authorization?: string): string | undefined {
  const token = extractBearerToken(authorization);
  return token ? verifyJwtToken(token).userId : undefined;
}

@Module({ controllers: [GatewayController], providers: [GatewayAuthGuard, GatewayRateGuard, GatewayProxy] })
class GatewayModule {}

async function bootstrap() {
  const app = await NestFactory.create(GatewayModule);
  configureHttpSecurity(app);
  const config = new DocumentBuilder()
    .setTitle('NexusTrade API')
    .setDescription('REST API for account, trading, market data, wallet, risk, and compliance workflows.')
    .setVersion('3.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
