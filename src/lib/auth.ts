import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { err } from '@/lib/api';

export const ACCESS_COOKIE = 'cp_access';
export const REFRESH_COOKIE = 'cp_refresh';

function accessSecret(): Uint8Array {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET is required in production');
    }
    return new TextEncoder().encode('dev-only-insecure-secret');
  }
  return new TextEncoder().encode(s);
}

export interface JwtPayload {
  sub: string;
  email: string;
  userType: 'customer' | 'staff';
  customerId: string | null;
  isSuperadmin: boolean;
  permissions: string[];
}

export interface AuthContext extends Omit<JwtPayload, 'sub'> {
  userId: string;
}

export async function signAccess(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_ACCESS_EXPIRES ?? '30m')
    .sign(accessSecret());
}

export async function verifyAccess(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret());
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

// --- password hashing -------------------------------------------------------

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// --- refresh tokens ---------------------------------------------------------

/** Returns the raw token (given to the client) and its hash (stored). */
export function newOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// --- permission loading -----------------------------------------------------

export async function loadPermissions(userId: string): Promise<string[]> {
  const rows = await query<{ code: string }>(
    `SELECT DISTINCT p.code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p       ON p.id = rp.permission_id
      WHERE ur.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.code);
}

// --- request guards ---------------------------------------------------------

function bearerFrom(request: NextRequest): string {
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return request.cookies.get(ACCESS_COOKIE)?.value ?? '';
}

/** Throws a 401 Response when there is no valid session. */
export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const token = bearerFrom(request);
  const payload = token ? await verifyAccess(token) : null;

  if (!payload?.sub) throw err('Unauthorized', 401);

  return {
    userId: payload.sub,
    email: payload.email,
    userType: payload.userType,
    customerId: payload.customerId ?? null,
    isSuperadmin: Boolean(payload.isSuperadmin),
    permissions: payload.permissions ?? [],
  };
}

export function hasPermission(auth: AuthContext, permission: string): boolean {
  return auth.isSuperadmin || auth.permissions.includes(permission);
}

/** Staff-only guard. Throws 401/403. */
export async function requireStaff(
  request: NextRequest,
  permission?: string,
): Promise<AuthContext> {
  const auth = await requireAuth(request);
  if (auth.userType !== 'staff') throw err('Staff access required', 403);
  if (permission && !hasPermission(auth, permission)) {
    throw err(`Missing permission: ${permission}`, 403);
  }
  return auth;
}

export interface PortalCustomer {
  id: string;
  company_id: string;
  code: string;
  name: string;
  status: string;
  payment_terms_days: number;
  credit_limit: string;
  currency: string;
}

/**
 * Resolves the customer behind a portal session.
 *
 * Every customer-facing route MUST go through this and scope its queries to
 * the returned id — it is the single thing standing between one customer and
 * another's orders, invoices and documents. It re-reads customer_id from the
 * database rather than trusting the JWT, so revoking access takes effect on
 * the next request instead of at token expiry.
 */
export async function requireCustomer(
  request: NextRequest,
): Promise<{ auth: AuthContext; customer: PortalCustomer }> {
  const auth = await requireAuth(request);
  if (auth.userType !== 'customer') throw err('Customer account required', 403);

  const row = await queryOne<{ customer_id: string | null }>(
    `SELECT customer_id FROM users WHERE id = $1 AND is_active`,
    [auth.userId],
  );
  if (!row?.customer_id) {
    throw err('This account is not linked to an approved customer yet.', 403);
  }

  const customer = await queryOne<PortalCustomer>(
    `SELECT id, company_id, code, name, status, payment_terms_days, credit_limit, currency
       FROM customers WHERE id = $1`,
    [row.customer_id],
  );
  if (!customer) throw err('Linked customer not found.', 404);
  if (customer.status === 'closed' || customer.status === 'suspended') {
    throw err(`This account is ${customer.status}. Please contact your account manager.`, 403);
  }

  return { auth, customer };
}

// --- cookie helpers ---------------------------------------------------------

export function setAuthCookies(accessToken: string, refreshToken: string): void {
  const jar = cookies();
  const secure = process.env.NODE_ENV === 'production';

  jar.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
  jar.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearAuthCookies(): void {
  const jar = cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}
