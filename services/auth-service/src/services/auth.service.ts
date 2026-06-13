// services/auth-service/src/services/auth.service.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SessionEntity, UserEntity } from '@nexus/database';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as OTPAuth from 'otpauth';
import { createEvent, EventType, KafkaService, KafkaTopics, UserStatus } from '@nexus/shared';
import { Repository } from 'typeorm';
import { LogoutDto, LoginDto, RefreshTokenDto, RegisterDto, TotpVerifyDto } from '../dto/auth.dto';

@Injectable()
export class AuthService {
  private loginAttempts = new Map<string, { count: number; resetAt: number }>();
  private pendingTotpSecrets = new Map<string, { secret: string; expiresAt: number }>();

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(SessionEntity) private readonly sessions: Repository<SessionEntity>,
    private readonly kafka: KafkaService
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new HttpException('email already registered', HttpStatus.CONFLICT);

    const user = await this.users.save(this.users.create({
      email,
      passwordHash: await bcrypt.hash(dto.password, 12),
      status: UserStatus.Active,
      referralCode: randomUUID().replace(/-/g, '').slice(0, 12)
    }));

    const event = createEvent(EventType.UserRegistered, user.id, { userId: user.id, email: user.email, status: user.status }, 'auth-service', { userId: user.id });
    await this.kafka.produce(KafkaTopics.Users, event, user.id);
    return { userId: user.id, email: user.email, status: user.status };
  }

  async login(dto: LoginDto, ipAddress = 'unknown') {
    const email = dto.email.toLowerCase();
    this.enforceRateLimit(`ip:${ipAddress}`);
    this.enforceRateLimit(`account:${email}`);
    const user = await this.users.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      this.recordFailedLogin(`ip:${ipAddress}`);
      this.recordFailedLogin(`account:${email}`);
      throw new HttpException('invalid credentials', HttpStatus.UNAUTHORIZED);
    }
    if ([UserStatus.Frozen, UserStatus.Closed].includes(user.status)) {
      throw new HttpException('account is not active', HttpStatus.FORBIDDEN);
    }
    if (user.totpSecret && !this.verifyTotp(user.totpSecret, dto.totpCode ?? '')) {
      this.recordFailedLogin(`ip:${ipAddress}`);
      this.recordFailedLogin(`account:${email}`);
      throw new HttpException('totp verification required', HttpStatus.UNAUTHORIZED);
    }
    this.loginAttempts.delete(`ip:${ipAddress}`);
    this.loginAttempts.delete(`account:${email}`);

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new HttpException('JWT_SECRET is not configured', HttpStatus.INTERNAL_SERVER_ERROR);

    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString('base64url');
    await this.sessions.save(this.sessions.create({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: await bcrypt.hash(refreshToken, 12),
      deviceFingerprint: dto.deviceFingerprint,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }));
    const roles = this.rolesForUser(user);

    return {
      accessToken: jwt.sign({ sub: user.id, sid: sessionId, roles }, jwtSecret, { expiresIn: '15m' }),
      refreshToken,
      sessionId
    };
  }

  async refresh(dto: RefreshTokenDto) {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new HttpException('JWT_SECRET is not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    const session = await this.sessions.findOne({ where: { id: dto.sessionId } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new HttpException('invalid refresh session', HttpStatus.UNAUTHORIZED);
    }
    if (!(await bcrypt.compare(dto.refreshToken, session.refreshTokenHash))) {
      throw new HttpException('invalid refresh token', HttpStatus.UNAUTHORIZED);
    }
    const user = await this.users.findOne({ where: { id: session.userId } });
    if (!user || [UserStatus.Frozen, UserStatus.Closed].includes(user.status)) {
      throw new HttpException('account is not active', HttpStatus.FORBIDDEN);
    }
    const nextRefreshToken = randomBytes(48).toString('base64url');
    session.refreshTokenHash = await bcrypt.hash(nextRefreshToken, 12);
    session.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.sessions.save(session);
    return {
      accessToken: jwt.sign({ sub: session.userId, sid: session.id, roles: this.rolesForUser(user) }, jwtSecret, { expiresIn: '15m' }),
      refreshToken: nextRefreshToken,
      sessionId: session.id
    };
  }

  async logout(dto: LogoutDto) {
    const session = await this.sessions.findOne({ where: { id: dto.sessionId } });
    if (session && await bcrypt.compare(dto.refreshToken, session.refreshTokenHash)) {
      session.revokedAt = new Date();
      await this.sessions.save(session);
    }
    return { loggedOut: true };
  }

  async setupTotp(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new HttpException('user not found', HttpStatus.NOT_FOUND);
    const secret = new OTPAuth.Secret({ size: 20 });
    this.pendingTotpSecrets.set(user.id, { secret: secret.base32, expiresAt: Date.now() + 10 * 60 * 1000 });
    const totp = new OTPAuth.TOTP({ issuer: 'NexusTrade', label: user.email, secret });
    return { secret: secret.base32, uri: totp.toString(), expiresInSeconds: 600 };
  }

  async verifyTotpForUser(dto: TotpVerifyDto) {
    if (!dto.userId) throw new HttpException('userId is required', HttpStatus.UNAUTHORIZED);
    const user = await this.users.findOne({ where: { id: dto.userId } });
    if (!user) throw new HttpException('user not found', HttpStatus.NOT_FOUND);

    const pending = this.pendingTotpSecrets.get(user.id);
    if (pending) {
      if (pending.expiresAt <= Date.now()) {
        this.pendingTotpSecrets.delete(user.id);
        throw new HttpException('pending totp setup expired', HttpStatus.BAD_REQUEST);
      }
      const verified = this.verifyTotp(pending.secret, dto.code);
      if (verified) {
        user.totpSecret = pending.secret;
        await this.users.save(user);
        this.pendingTotpSecrets.delete(user.id);
      }
      return { verified };
    }

    if (!user.totpSecret) throw new HttpException('totp not configured', HttpStatus.BAD_REQUEST);
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

  private rolesForUser(user: UserEntity) {
    const adminEmails = parseEmailList(process.env.ADMIN_EMAILS);
    const operatorEmails = parseEmailList(process.env.OPERATOR_EMAILS);
    return [
      'user',
      ...(adminEmails.has(user.email.toLowerCase()) ? ['admin'] : []),
      ...(operatorEmails.has(user.email.toLowerCase()) ? ['operator'] : [])
    ];
  }
}

function parseEmailList(value?: string) {
  return new Set((value ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
}
