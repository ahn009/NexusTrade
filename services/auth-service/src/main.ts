// services/auth-service/src/main.ts
import 'reflect-metadata';
import { Body, Controller, Get, Headers, HttpException, HttpStatus, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as OTPAuth from 'otpauth';
import { randomBytes, randomUUID } from 'crypto';
import { UserStatus } from '@nexus/shared';

class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}

class LoginDto extends RegisterDto {
  @IsOptional()
  @IsString()
  totpCode?: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}

class TotpVerifyDto {
  @IsString()
  userId!: string;

  @IsString()
  code!: string;
}

interface SessionRecord {
  userId: string;
  refreshTokenHash: string;
  deviceFingerprint?: string;
  expiresAt: number;
}

class AuthService {
  private users = new Map<string, { id: string; email: string; passwordHash: string; status: UserStatus; totpSecret?: string }>();
  private sessions = new Map<string, SessionRecord>();
  private loginAttempts = new Map<string, { count: number; resetAt: number }>();
  private readonly jwtSecret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';

  async register(dto: RegisterDto) {
    const existing = [...this.users.values()].find((user) => user.email === dto.email.toLowerCase());
    if (existing) throw new HttpException('email already registered', HttpStatus.CONFLICT);
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = { id, email: dto.email.toLowerCase(), passwordHash, status: UserStatus.Active };
    this.users.set(id, user);
    return { userId: id, email: user.email, status: user.status };
  }

  async login(dto: LoginDto, ipAddress = 'unknown') {
    this.enforceRateLimit(ipAddress);
    const user = [...this.users.values()].find((candidate) => candidate.email === dto.email.toLowerCase());
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      this.recordFailedLogin(ipAddress);
      throw new HttpException('invalid credentials', HttpStatus.UNAUTHORIZED);
    }
    if (user.totpSecret && !this.verifyTotp(user.totpSecret, dto.totpCode ?? '')) {
      this.recordFailedLogin(ipAddress);
      throw new HttpException('totp verification required', HttpStatus.UNAUTHORIZED);
    }
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString('base64url');
    this.sessions.set(sessionId, {
      userId: user.id,
      refreshTokenHash: await bcrypt.hash(refreshToken, 12),
      deviceFingerprint: dto.deviceFingerprint,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });
    return {
      accessToken: jwt.sign({ sub: user.id, sid: sessionId }, this.jwtSecret, { expiresIn: '15m' }),
      refreshToken,
      sessionId
    };
  }

  setupTotp(userId: string) {
    const user = this.users.get(userId);
    if (!user) throw new HttpException('user not found', HttpStatus.NOT_FOUND);
    const secret = new OTPAuth.Secret({ size: 20 });
    user.totpSecret = secret.base32;
    const totp = new OTPAuth.TOTP({ issuer: 'NexusTrade', label: user.email, secret });
    return { secret: secret.base32, uri: totp.toString() };
  }

  verifyTotpForUser(dto: TotpVerifyDto) {
    const user = this.users.get(dto.userId);
    if (!user?.totpSecret) throw new HttpException('totp not configured', HttpStatus.BAD_REQUEST);
    return { verified: this.verifyTotp(user.totpSecret, dto.code) };
  }

  registerPasskey(userId: string) {
    const challenge = randomBytes(32).toString('base64url');
    return { userId, challenge, rpId: process.env.WEBAUTHN_RP_ID ?? 'localhost', timeout: 60000 };
  }

  private verifyTotp(secret: string, code: string) {
    const totp = new OTPAuth.TOTP({ issuer: 'NexusTrade', label: 'NexusTrade', secret: OTPAuth.Secret.fromBase32(secret) });
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  private enforceRateLimit(key: string) {
    const state = this.loginAttempts.get(key);
    if (state && state.count >= 5 && state.resetAt > Date.now()) {
      throw new HttpException('too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailedLogin(key: string) {
    const current = this.loginAttempts.get(key);
    if (!current || current.resetAt <= Date.now()) {
      this.loginAttempts.set(key, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
      return;
    }
    current.count += 1;
  }
}

@Controller()
class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'auth-service' };
  }

  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('auth/login')
  login(@Body() dto: LoginDto, @Headers('x-forwarded-for') ip?: string) {
    return this.auth.login(dto, ip);
  }

  @Post('auth/totp/setup')
  setupTotp(@Body('userId') userId: string) {
    return this.auth.setupTotp(userId);
  }

  @Post('auth/totp/verify')
  verifyTotp(@Body() dto: TotpVerifyDto) {
    return this.auth.verifyTotpForUser(dto);
  }

  @Post('auth/passkeys/options')
  passkeyOptions(@Body('userId') userId: string) {
    return this.auth.registerPasskey(userId);
  }
}

@Module({ controllers: [AuthController], providers: [AuthService] })
class AuthModule {}

async function bootstrap() {
  const app = await NestFactory.create(AuthModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}

void bootstrap();
