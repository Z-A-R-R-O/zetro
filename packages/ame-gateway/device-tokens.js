import { createHash, randomBytes, randomUUID } from 'node:crypto';

const DEFAULT_TTL_DAYS = 90;
const MAX_TTL_DAYS = 365;

function isNonEmptyString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export class PostgresDeviceTokenService {
  constructor({ pool, defaultTtlDays = DEFAULT_TTL_DAYS, maxTtlDays = MAX_TTL_DAYS }) {
    if (!pool || typeof pool.query !== 'function') {
      throw new Error('A PostgreSQL-compatible pool with query() is required');
    }
    if (!Number.isInteger(defaultTtlDays) || defaultTtlDays < 1 || defaultTtlDays > 365) {
      throw new Error('defaultTtlDays must be between 1 and 365');
    }
    if (!Number.isInteger(maxTtlDays) || maxTtlDays < defaultTtlDays || maxTtlDays > 365) {
      throw new Error('maxTtlDays must be between defaultTtlDays and 365');
    }
    this.pool = pool;
    this.defaultTtlDays = defaultTtlDays;
    this.maxTtlDays = maxTtlDays;
  }

  async issue({ deviceId, label = 'AME Android device', expiresAt } = {}) {
    if (!isNonEmptyString(deviceId, 160)) throw new Error('A valid deviceId is required');
    if (!isNonEmptyString(label, 120)) throw new Error('A valid device label is required');

    const now = Date.now();
    const expiration = expiresAt === undefined
      ? now + this.defaultTtlDays * 24 * 60 * 60 * 1000
      : Date.parse(expiresAt);
    const maxExpiration = now + this.maxTtlDays * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(expiration) || expiration <= now + 60_000 || expiration > maxExpiration) {
      throw new Error(`Token expiry must be in the future and within ${this.maxTtlDays} days`);
    }

    const token = randomBytes(32).toString('base64url');
    const tokenId = randomUUID();
    const expiresIso = new Date(expiration).toISOString();
    await this.pool.query(
      'INSERT INTO ame_device_tokens (token_id, device_id, token_hash, label, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [tokenId, deviceId.trim(), hashToken(token), label.trim(), expiresIso]
    );

    // The raw token is returned exactly once. Only its SHA-256 hash is stored.
    return { tokenId, token, deviceId: deviceId.trim(), label: label.trim(), expiresAt: expiresIso };
  }

  async authenticate({ authorization } = {}) {
    if (typeof authorization !== 'string') return null;
    const match = /^Bearer\s+([A-Za-z0-9_-]{43})$/i.exec(authorization.trim());
    if (!match) return null;
    const tokenHash = hashToken(match[1]);
    const result = await this.pool.query(
      'UPDATE ame_device_tokens SET last_used_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW() RETURNING device_id',
      [tokenHash]
    );
    const row = result.rows?.[0];
    if (!row || !isNonEmptyString(row.device_id, 160)) return null;
    return { deviceId: row.device_id };
  }

  async revoke({ tokenId } = {}) {
    if (!isNonEmptyString(tokenId, 64)) throw new Error('A valid tokenId is required');
    const result = await this.pool.query(
      'UPDATE ame_device_tokens SET revoked_at = NOW() WHERE token_id = $1 AND revoked_at IS NULL RETURNING token_id',
      [tokenId]
    );
    return Boolean(result.rows?.length);
  }
}
