// services/api-gateway/src/main.ts
import 'reflect-metadata';
import { Body, CanActivate, Controller, ExecutionContext, Get, Headers, Injectable, Module, Post, Query, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const publicKey = req.headers['x-api-key'];
    const signature = req.headers['x-signature'];
    if (!publicKey && !signature) return true;
    const secret = process.env.API_KEY_SECRET ?? 'dev-api-secret';
    const expected = createHmac('sha256', secret).update(`${req.method}:${req.url}`).digest('hex');
    return typeof signature === 'string' && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
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
@UseGuards(ApiKeyGuard)
class GatewayController {
  constructor(private readonly proxy: GatewayProxy) {}

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
    if (!userId) return { authenticated: false, balances: [] };
    return this.proxy.get('wallet', `/wallets/${encodeURIComponent(userId)}`);
  }

  @Get('exchangeInfo')
  exchangeInfo() {
    return { timezone: 'UTC', symbols: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'], rateLimits: [{ type: 'REQUEST_WEIGHT', interval: 'MINUTE', limit: 1200 }] };
  }

  @Get('ticker/24hr')
  ticker(@Query('symbol') symbol = 'BTC-USDT') {
    return { symbol, lastPrice: '103', volume: '120000' };
  }

  @Post('auth/register')
  register(@Body() body: { email: string; password: string }) {
    return this.proxy.post('auth', '/auth/register', body);
  }

  @Post('auth/login')
  login(@Body() body: { email: string; password: string; totpCode?: string; deviceFingerprint?: string }) {
    return this.proxy.post('auth', '/auth/login', body);
  }

  @Post('orders')
  placeOrder(@Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    const symbol = typeof body.symbol === 'string' ? body.symbol : normalizePair(String(body.pair ?? 'BTCUSDT'));
    const userId = typeof body.userId === 'string' ? body.userId : userIdFromAuthorization(authorization) ?? 'api-user';
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
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
  if (!token) return undefined;
  try {
    const [, payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof decoded.sub === 'string' ? decoded.sub : undefined;
  } catch {
    return undefined;
  }
}

@Module({ controllers: [GatewayController], providers: [ApiKeyGuard, GatewayProxy] })
class GatewayModule {}

async function bootstrap() {
  const app = await NestFactory.create(GatewayModule);
  app.enableCors();
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
