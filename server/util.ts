import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function newId(len = 14): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % 62];
  return out;
}

export const now = () => new Date().toISOString();

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500,
    message: string,
    public code = 'error',
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m, 'bad_request');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const forbidden = (m = 'Forbidden') => new HttpError(403, m, 'forbidden');
export const unauthorized = (m = 'Authentication required') => new HttpError(401, m, 'unauthorized');
