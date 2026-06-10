// services/api-gateway/src/main.ts
import 'reflect-metadata';
import { Body, CanActivate, Controller, ExecutionContext, Get, Headers, Injectable, Module, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
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
class GatewayProxy {
  private readonly upstreams = {
    auth: process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001',
    trading: process.env.TRADING_SERVICE_URL ?? 'http://localhost:3003',
    wallet: process.env.WALLET_SERVICE_URL ?? 'http://localhost:3004',
    marketData: process.env.MARKET_DATA_SERVICE_URL ?? 'http://localhost:3005'
  };

  async post<TBody>(base: keyof GatewayProxy['upstreams'], path: string, body: TBody, authorization?: string) {
    const response = await fetch(`${this.upstreams[base]}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {})
      },
      body: JSON.stringify(body)
    });
    return this.readResponse(response);
  }

  async get(base: keyof GatewayProxy['upstreams'], path: string) {
    const response = await fetch(`${this.upstreams[base]}${path}`);
    return this.readResponse(response);
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
@UseGuards(GatewayAuthGuard)
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
  account(@Headers('authorization') authorization?: string, @Query('userId') queryUserId?: string) {
    const userId = queryUserId ?? userIdFromAuthorization(authorization);
    if (!userId) throw new UnauthorizedException('userId is required for API key account requests');
    return this.proxy.get('wallet', `/wallets/${encodeURIComponent(userId)}`);
  }

  @Public()
  @Get('exchangeInfo')
  exchangeInfo() {
    return { timezone: 'UTC', symbols: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'], rateLimits: [{ type: 'REQUEST_WEIGHT', interval: 'MINUTE', limit: 1200 }] };
  }

  @Public()
  @Get('ticker/24hr')
  ticker(@Query('symbol') symbol = 'BTC-USDT') {
    return this.proxy.get('marketData', `/ticker/${normalizePair(symbol)}`);
  }

  @Public()
  @Post('auth/register')
  register(@Body() body: { email: string; password: string }) {
    return this.proxy.post('auth', '/auth/register', body);
  }

  @Public()
  @Post('auth/login')
  login(@Body() body: { email: string; password: string; totpCode?: string; deviceFingerprint?: string }) {
    return this.proxy.post('auth', '/auth/login', body);
  }

  @Post('orders')
  placeOrder(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
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
      authorization
    );
  }

  @Public()
  @Get('depth')
  depth(@Query('symbol') symbol = 'BTCUSDT') {
    return this.proxy.get('marketData', `/depth/${normalizePair(symbol)}`);
  }

  @Post('wallets/credit')
  credit(@Body() body: { userId: string; asset: string; amount: string; referenceId?: string }) {
    return this.proxy.post('wallet', '/wallets/credit', {
      userId: body.userId,
      asset: body.asset,
      amount: body.amount,
      referenceId: body.referenceId ?? `manual-${Date.now()}`
    });
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

@Module({ controllers: [GatewayController], providers: [GatewayAuthGuard, GatewayProxy] })
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
