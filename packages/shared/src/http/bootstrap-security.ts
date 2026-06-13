// packages/shared/src/http/bootstrap-security.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';

const DEFAULT_ALLOWED_DEV_ORIGINS = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
const SENSITIVE_SECRET_KEYS = ['JWT_SECRET', 'SERVICE_AUTH_TOKEN', 'API_KEY_SECRET', 'DATABASE_PASSWORD'];
const UNSAFE_SECRET_VALUES = new Set([
  'replace-me',
  'replace-with-strong-secret',
  'replace-with-internal-service-token',
  'replace-with-api-key-secret',
  'local-jwt-secret-change-me',
  'local-service-token',
  'local-api-key-secret',
  'nexus'
]);

export function configureHttpSecurity(app: INestApplication) {
  assertSafeProductionSecrets();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.use((req: { headers: Record<string, string | string[] | undefined> }, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    const incoming = req.headers['x-request-id'];
    const requestId = Array.isArray(incoming) ? incoming[0] : incoming ?? randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin is not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-api-key', 'x-signature', 'x-service-token', 'x-request-id'],
    exposedHeaders: ['x-request-id']
  });
}

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return true;
  return process.env.NODE_ENV !== 'production' && DEFAULT_ALLOWED_DEV_ORIGINS.some((pattern) => pattern.test(origin));
}

export function assertSafeProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  const unsafeKeys = SENSITIVE_SECRET_KEYS.filter((key) => {
    const value = process.env[key]?.trim();
    return !value || UNSAFE_SECRET_VALUES.has(value) || value.toLowerCase().includes('change-me');
  });
  if (unsafeKeys.length > 0) {
    throw new Error(`unsafe production secret configuration: ${unsafeKeys.join(', ')}`);
  }
}
