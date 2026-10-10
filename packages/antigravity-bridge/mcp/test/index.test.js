const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { MCPBridge } = require('../src/index.js');

test('MCPBridge', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bridge-test3-'));

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('schema enforcement and secret rejection at seed', () => {
    const bridge = new MCPBridge(tmpDir, 5000);
    
    // Missing fields
    assert.throws(() => {
      bridge._seedTask({ taskId: '1' });
    }, /Missing required schema field/);

    // Secret bearing
    assert.throws(() => {
      bridge._seedTask({
        taskId: 't1', agent: 'a1', allowedPaths: [], objective: 'o', acceptanceCriteria: 'a', contextRefs: {}, capabilityDigest: 'c1',
        myApiKey: '123'
      });
    }, /secret-bearing/);

    assert.throws(() => {
      bridge._seedTask({
        taskId: 't1', agent: 'a1', allowedPaths: [], objective: 'o', acceptanceCriteria: 'a', contextRefs: {}, capabilityDigest: 'c1',
        deep: { password: '123' }
      });
    }, /secret-bearing/);
  });

  await t.test('fetch_task errors on unknown ref', () => {
    const bridge = new MCPBridge(tmpDir, 5000);
    bridge._seedTask({
      taskId: 't2', agent: 'a1', allowedPaths: [], objective: 'o', acceptanceCriteria: 'a', contextRefs: { r1: 'data' }, capabilityDigest: 'c1'
    });

    assert.throws(() => bridge.fetch_task('t2', 'c1', 'unknown'), /Unknown sectionRef/);
    const data = bridge.fetch_task('t2', 'c1', 'r1');
    assert.strictEqual(data.data, 'data');
  });

  await t.test('submit_receipt schema and path traversal validation', () => {
    const bridge = new MCPBridge(tmpDir, 5000);
    bridge._seedTask({
      taskId: 't3', agent: 'a1', allowedPaths: ['/safe/root'], objective: 'o', acceptanceCriteria: 'a', contextRefs: {}, capabilityDigest: 'c1'
    });

    // Invalid status
    assert.throws(() => {
      bridge.submit_receipt('t3', 'c1', { taskId: 't3', agent: 'a1', status: 'unknown' });
    }, /invalid status enum/);

    // Mismatched taskId/agent
    assert.throws(() => {
      bridge.submit_receipt('t3', 'c1', { taskId: 't4', agent: 'a1', status: 'success' });
    }, /taskId mismatch/);

    // Path traversal outside roots
    assert.throws(() => {
      bridge.submit_receipt('t3', 'c1', { taskId: 't3', agent: 'a1', status: 'success', paths: ['/safe/root/../../etc/passwd'] });
    }, /directory traversal detected/);

    // Valid
    const ack = bridge.submit_receipt('t3', 'c1', { taskId: 't3', agent: 'a1', status: 'success', paths: ['/safe/root/file.txt'] });
    assert.strictEqual(ack.success, true);
  });

  await t.test('submit_receipt concurrent duplicate protection', () => {
    const bridge = new MCPBridge(tmpDir, 5000);
    bridge._seedTask({
      taskId: 't4', agent: 'a1', allowedPaths: [], objective: 'o', acceptanceCriteria: 'a', contextRefs: {}, capabilityDigest: 'c1'
    });

    // Simulate concurrent exclusive write by pre-creating the temp file directly as the target
    const { receiptPath } = bridge._getSafePaths('t4', 'c1');
    const duplicateReceipt = { taskId: 't4', agent: 'a1', status: 'success', data: 'concurrent' };
    fs.writeFileSync(receiptPath, JSON.stringify(duplicateReceipt)); // Written by "another process"

    // If we try to submit something else, it fails
    assert.throws(() => {
      bridge.submit_receipt('t4', 'c1', { taskId: 't4', agent: 'a1', status: 'success', data: 'different' });
    }, /Conflicting replay rejected concurrently|Conflicting replay rejected/);
  });
});
