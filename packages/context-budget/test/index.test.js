const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { ContextEngine, BudgetExceededError } = require('../src/index.js');

test('ContextEngine', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-budget-test-'));

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('preserves required fields and fails if budget too small', () => {
    const engine = new ContextEngine(tmpDir, 50);
    const data = {
      objective: 'Do task',
      acceptanceCriteria: 'Done',
      permissions: ['read'],
      blockers: []
    };
    
    assert.throws(() => engine.createPacket(data), BudgetExceededError);
  });

  await t.test('lossless type preservation', () => {
    const engine = new ContextEngine(tmpDir, 1000); 
    const data = {
      objective: 'T',
      acceptanceCriteria: 'D',
      permissions: [],
      blockers: [],
      context: { str: '123', num: 123 }
    };
    const { packet } = engine.createPacket(data);
    const resolved = engine.resolvePacket(packet);
    assert.strictEqual(resolved.context.str, '123');
    assert.strictEqual(resolved.context.num, 123);
  });

  await t.test('cross-instance dedup', () => {
    const engine1 = new ContextEngine(tmpDir, 1000);
    const data = { objective: 'T', acceptanceCriteria: 'D', permissions: [], blockers: [], context: { k: 'val1' } };
    engine1.createPacket(data);

    const engine2 = new ContextEngine(tmpDir, 1000);
    const { packet } = engine2.createPacket(data);
    assert.ok(packet.context.k.$ref !== undefined); 
  });

  await t.test('ref format validation and path traversal prevention', () => {
    const engine = new ContextEngine(tmpDir, 1000);
    assert.throws(() => {
      engine.resolvePacket({ context: { k: { $ref: '../etc/passwd' } } });
    }, /Invalid \$ref format/);
  });

  await t.test('hash integrity check', () => {
    const engine = new ContextEngine(tmpDir, 300); 
    const data = { objective: 'T', acceptanceCriteria: 'D', permissions: [], blockers: [], context: { k: 'A'.repeat(500) } };
    const { packet } = engine.createPacket(data);
    const ref = packet.context.k.$ref;
    
    fs.writeFileSync(path.join(tmpDir, ref), JSON.stringify('tampered'));
    assert.throws(() => engine.resolvePacket(packet), /hash mismatch/);
  });
});
