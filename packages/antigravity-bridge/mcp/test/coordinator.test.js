const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

test('Coordinator CLI', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-coordinator-test-'));
  const cliPath = path.join(__dirname, '../src/coordinator.js');

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const env = { ...process.env, MCP_STORAGE_DIR: tmpDir };

  await t.test('seed task and inspect receipt', () => {
    const seedCmd = `node "${cliPath}" seed --agent "w1" --objective "Do it" --acceptanceCriteria "Done" --allowedPaths "/tmp"`;
    const seedOutput = execSync(seedCmd, { encoding: 'utf8', env });
    const { dispatch } = JSON.parse(seedOutput);
    
    assert.ok(dispatch.taskId);
    assert.ok(dispatch.capabilityDigest);
    assert.strictEqual(dispatch.agent, 'w1');

    // Attempt to inspect before receipt exists
    assert.throws(() => {
      execSync(`node "${cliPath}" inspect --taskId "${dispatch.taskId}" --capabilityDigest "${dispatch.capabilityDigest}"`, { encoding: 'utf8', stdio: 'pipe', env });
    }, /Receipt not found/);

    // Simulate receipt creation
    const crypto = require('crypto');
    const safeTaskId = crypto.createHash('sha256').update(dispatch.taskId).digest('hex').slice(0, 16);
    const safeCap = crypto.createHash('sha256').update(dispatch.capabilityDigest).digest('hex').slice(0, 16);
    const receiptsDir = path.join(tmpDir, 'receipts');
    if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir);
    
    fs.writeFileSync(path.join(receiptsDir, `${safeTaskId}_${safeCap}.json`), JSON.stringify({
      taskId: dispatch.taskId,
      agent: 'w1',
      status: 'success'
    }));

    // Inspect
    const inspectCmd = `node "${cliPath}" inspect --taskId "${dispatch.taskId}" --capabilityDigest "${dispatch.capabilityDigest}"`;
    const inspectOutput = execSync(inspectCmd, { encoding: 'utf8', env });
    const { receipt } = JSON.parse(inspectOutput);

    assert.strictEqual(receipt.status, 'success');
  });
});
