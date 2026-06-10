// packages/shared/src/auth/jwt-auth.guard.ts
import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';

export const IS_PUBLIC_ROUTE = 'isPublicRoute';
export const Public = () => SetMetadata(IS_PUBLIC_ROUTE, true);

export interface AuthenticatedRequest {
  user?: { userId: string; sessionId?: string; roles: string[] };
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (hasValidServiceToken(request.headers['x-service-token'])) return true;

    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('authorization bearer token is required');

    request.user = verifyJwtToken(token);
    return true;
  }
}

export function hasValidServiceToken(headerValue?: string | string[]): boolean {
  const configured = process.env.SERVICE_AUTH_TOKEN;
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return Boolean(configured && token && token === configured);
}

export function extractBearerToken(authorization?: string | string[]): string | undefined {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : undefined;
}

export function verifyJwtToken(token: string): { userId: string; sessionId?: string; roles: string[] } {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new UnauthorizedException('JWT_SECRET is not configured');
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
    if (typeof decoded.sub !== 'string') throw new UnauthorizedException('token subject is required');
    const roles = Array.isArray(decoded.roles) ? decoded.roles.filter((role): role is string => typeof role === 'string') : [];
    return {
      userId: decoded.sub,
      sessionId: typeof decoded.sid === 'string' ? decoded.sid : undefined,
      roles
    };
  } catch (error) {
    if (error instanceof UnauthorizedException) throw error;
    throw new UnauthorizedException('invalid or expired token');
  }
}
