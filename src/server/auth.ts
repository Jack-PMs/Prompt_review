import { createHash, timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';
import { db } from './db';
import { AppError } from './validation';

function allowedAdminHost(host: string | null): boolean {
  if (!host) return false;
  let hostname: string;
  try { hostname = new URL(`http://${host}`).hostname.toLowerCase(); }
  catch { return false; }
  const allowed = (process.env.ADMIN_ALLOWED_HOSTS || '127.0.0.1,localhost,::1')
    .split(',').map(item=>item.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(hostname.replace(/^\[|\]$/g,''));
}

function requestHost(headersList: Headers): string | null {
  return headersList.get('x-forwarded-host') || headersList.get('host');
}

/** No login screen. By default the admin UI and APIs are available only on loopback. */
export async function isAdmin() {
  return allowedAdminHost(requestHost(await headers()));
}

export function requireAdmin(request: Request) {
  if (!allowedAdminHost(requestHost(request.headers))) throw new AppError('ADMIN_LOCAL_ONLY',403,'管理台仅允许从本机访问');
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && allowedAdminHost(requestHost(request.headers))) {
    try {
      if (allowedAdminHost(new URL(origin).host)) return;
    } catch { /* fall through */ }
  }
  const parsed = new URL(request.url);
  const expected = process.env.APP_ORIGIN || `${parsed.protocol}//${request.headers.get('host') || parsed.host}`;
  if (origin !== expected) throw new AppError('INVALID_ORIGIN',403,'请求来源不合法');
}

function equal(a: string,b: string) {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah,bh);
}

/** Per-key requests per minute. ENHANCE_RATE_LIMIT_PER_MIN must be a positive integer; otherwise 60. */
export function rateLimitPerMinute() {
  const value = Number(process.env.ENHANCE_RATE_LIMIT_PER_MIN?.trim());
  return Number.isInteger(value) && value > 0 ? value : 60;
}

export function requireApiKey(request: Request) {
  const expected = process.env.ENHANCE_API_KEY || '';
  if (expected.length < 16) throw new AppError('API_NOT_CONFIGURED',503,'接口密钥尚未配置');
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i,'') || '';
  if (!equal(supplied,expected)) throw new AppError('UNAUTHORIZED',401,'接口密钥无效');
  const hash = createHash('sha256').update(expected).digest('hex');
  const now = Date.now();
  const database = db();
  database.prepare('DELETE FROM rate_events WHERE created_at<?').run(now-60_000);
  database.transaction(() => {
    const count = (database.prepare('SELECT COUNT(*) as n FROM rate_events WHERE key_hash=?').get(hash) as {n:number}).n;
    if (count >= rateLimitPerMinute()) throw new AppError('RATE_LIMITED',429,'请求过于频繁');
    database.prepare('INSERT INTO rate_events(key_hash,created_at) VALUES (?,?)').run(hash,now);
  })();
}
