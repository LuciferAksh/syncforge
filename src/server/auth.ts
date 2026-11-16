import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, value] = encoded.split(':');
  const key = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(value, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}
export function sessionToken(cookie = '') {
  return (
    cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('sf_session='))
      ?.slice('sf_session='.length) ?? ''
  );
}
