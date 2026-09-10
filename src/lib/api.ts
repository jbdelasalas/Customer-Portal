import { NextResponse } from 'next/server';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function err(message: string, status: number, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Wraps a route handler so a thrown Response (how requireAuth/requirePermission
 * bail out) becomes the response, and anything else becomes a clean 500
 * instead of leaking a stack trace to the client.
 */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof Response) return e;
      console.error('[api]', e);
      const message = e instanceof Error ? e.message : 'Internal server error';
      return err(
        process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
        500,
      );
    }
  };
}
