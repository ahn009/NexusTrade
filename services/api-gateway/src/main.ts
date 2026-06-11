// services/api-gateway/src/main.ts
import 'reflect-metadata';
import { Body, CanActivate, Controller, ExecutionContext, Get, Headers, HttpException, HttpStatus, Injectable, Module, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
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
    trading: process.env.TRADING_SERVICE_URL ?? 'http://localhost:3003',
    wallet: process.env.WALLET_SERVICE_URL ?? 'http://localhost:3004',
    marketData: process.env.MARKET_DATA_SERVICE_URL ?? 'http://localhost:3005'
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
