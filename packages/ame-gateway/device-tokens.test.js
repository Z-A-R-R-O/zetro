import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PostgresDeviceTokenService } from './device-tokens.js';

class FakeTokenPool {
  rows = [];

  async query(sql, values) {
    if (sql.startsWith('INSERT INTO ame_device_tokens')) {
      const [token_id, device_id, token_hash, label, expires_at] = values;
      this.rows.push({
        token_id,
        device_id,
        token_hash,
        label,
        expires_at: new Date(expires_at),
        revoked_at: null,
        last_used_at: null
      });
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE ame_device_tokens SET last_used_at')) {
      const [tokenHash] = values;
      const row = this.rows.find(candidate =>
        candidate.token_hash === tokenHash &&
        candidate.revoked_at === null &&
        candidate.expires_at.getTime() > Date.now()
      );
      if (!row) return { rows: [] };
      row.last_used_at = new Date();
      return { rows: [{ device_id: row.device_id }] };
    }
    if (sql.startsWith('UPDATE ame_device_tokens SET revoked_at')) {
      const [tokenId] = values;
      const row = this.rows.find(candidate => candidate.token_id === tokenId && candidate.revoked_at === null);
      if (!row) return { rows: [] };
      row.revoked_at = new Date();
      return { rows: [{ token_id: row.token_id }] };
    }
    throw new Error('Unexpected SQL in fake token pool');
  }
}

test('issues a high-entropy bearer token and stores only its hash', async () => {
  const pool = new FakeTokenPool();
  const service = new PostgresDeviceTokenService({ pool });
  const issued = await service.issue({ deviceId: 'device-1', label: 'My phone' });

  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.deviceId, 'device-1');
  assert.equal(pool.rows.length, 1);
  assert.notEqual(pool.rows[0].token_hash, issued.token);
  assert.equal(pool.rows[0].token_hash, createHash('sha256').update(issued.token).digest('hex'));
  assert.equal(await service.authenticate({ authorization: `Bearer ${issued.token}` }).then(value => value.deviceId), 'device-1');
  assert.ok(pool.rows[0].last_used_at instanceof Date);
});

test('rejects malformed, unknown, expired and revoked bearer tokens', async () => {
  const pool = new FakeTokenPool();
  const service = new PostgresDeviceTokenService({ pool });
  assert.equal(await service.authenticate({ authorization: 'Basic something' }), null);
  assert.equal(await service.authenticate({ authorization: 'Bearer short' }), null);

  const issued = await service.issue({ deviceId: 'device-2' });
  assert.equal(await service.authenticate({ authorization: 'Bearer A'.repeat(43) }), null);

  pool.rows[0].expires_at = new Date(Date.now() - 1000);
  assert.equal(await service.authenticate({ authorization: `Bearer ${issued.token}` }), null);
});

test('revokes tokens and prevents subsequent authentication', async () => {
  const pool = new FakeTokenPool();
  const service = new PostgresDeviceTokenService({ pool });
  const issued = await service.issue({ deviceId: 'device-3' });
  assert.equal(await service.revoke({ tokenId: issued.tokenId }), true);
  assert.equal(await service.revoke({ tokenId: issued.tokenId }), false);
  assert.equal(await service.authenticate({ authorization: `Bearer ${issued.token}` }), null);
});

test('enforces a future expiry no longer than the configured maximum', async () => {
  const service = new PostgresDeviceTokenService({ pool: new FakeTokenPool(), maxTtlDays: 30 });
  await assert.rejects(
    service.issue({ deviceId: 'device-4', expiresAt: new Date(Date.now() + 31 * 86400000).toISOString() }),
    /within 30 days/
  );
  await assert.rejects(service.issue({ deviceId: '' }), /deviceId/);
});
