// services/auth-service/src/services/auth.service.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as OTPAuth from 'otpauth';
import { createEvent, EventType, KafkaService, KafkaTopics, UserStatus } from '@nexus/shared';
import { LoginDto, RegisterDto, TotpVerifyDto } from '../dto/auth.dto';

interface SessionRecord {
  userId: string;
  refreshTokenHash: string;
  deviceFingerprint?: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private users = new Map<string, { id: string; email: string; passwordHash: string; status: UserStatus; totpSecret?: string }>();
  private sessions = new Map<string, SessionRecord>();
  private loginAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly kafka: KafkaService) {}

  async register(dto: RegisterDto) {
    const existing = [...this.users.values()].find((user) => user.email === dto.email.toLowerCase());
    if (existing) throw new HttpException('email already registered', HttpStatus.CONFLICT);
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = { id, email: dto.email.toLowerCase(), passwordHash, status: UserStatus.Active };
    this.users.set(id, user);
    const event = createEvent(EventType.UserRegistered, id, { userId: id, email: user.email, status: user.status }, 'auth-service', { userId: id });
    await this.kafka.produce(KafkaTopics.Users, event, id).catch(() => undefined);
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
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new HttpException('JWT_SECRET is not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString('base64url');
    this.sessions.set(sessionId, {
      userId: user.id,
      refreshTokenHash: await bcrypt.hash(refreshToken, 12),
      deviceFingerprint: dto.deviceFingerprint,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });
    return {
      accessToken: jwt.sign({ sub: user.id, sid: sessionId }, jwtSecret, { expiresIn: '15m' }),
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
