const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

test('Coordinator to Server Roundtrip', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-roundtrip-test-'));
  const coordinatorPath = path.join(__dirname, '../src/coordinator.js');
  const serverPath = path.join(__dirname, '../src/server.js');

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const env = { ...process.env, MCP_STORAGE_DIR: tmpDir };

  await t.test('end-to-end task seed, fetch, submit, inspect', async () => {
    const allowedPath = path.join(tmpDir, 'safe-workspace');
    fs.mkdirSync(allowedPath);

    const seedCmd = `node "${coordinatorPath}" seed --agent "agent-x" --objective "Do roundtrip" --acceptanceCriteria "Done" --allowedPaths "${allowedPath}"`;
    const seedOutput = execSync(seedCmd, { encoding: 'utf8', env });
    const { dispatch } = JSON.parse(seedOutput);

    assert.ok(dispatch.taskId);
    assert.ok(dispatch.capabilityDigest);
    assert.strictEqual(dispatch.agent, 'agent-x');

    let threw1 = false;
    try {
      execSync(`node "${coordinatorPath}" inspect --taskId "${dispatch.taskId}" --capabilityDigest "wrong"`, { encoding: 'utf8', env, stdio: 'pipe' });
    } catch(err) {
      threw1 = true;
    }
    assert.ok(threw1);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: { tools: {} } });
    await client.connect(transport);

    const fetchRes = await client.callTool({
      name: 'fetch_task',
      arguments: { taskId: dispatch.taskId, capabilityDigest: dispatch.capabilityDigest }
    });
    assert.strictEqual(fetchRes.isError, undefined);
    const taskContent = JSON.parse(fetchRes.content[0].text);
    assert.strictEqual(taskContent.agent, 'agent-x');
    assert.strictEqual(taskContent.objective, 'Do roundtrip');

    const submitRes = await client.callTool({
      name: 'submit_receipt',
      arguments: {
        taskId: dispatch.taskId,
        capabilityDigest: dispatch.capabilityDigest,
        receipt: {
          taskId: dispatch.taskId,
          agent: 'agent-x',
          status: 'success',
          paths: [path.join(allowedPath, 'result.txt')]
        }
      }
    });
    assert.strictEqual(submitRes.isError, undefined);
    
    await client.close();

    const inspectCmd = `node "${coordinatorPath}" inspect --taskId "${dispatch.taskId}" --capabilityDigest "${dispatch.capabilityDigest}"`;
    const inspectOutput = execSync(inspectCmd, { encoding: 'utf8', env });
    const { receipt } = JSON.parse(inspectOutput);

    assert.strictEqual(receipt.status, 'success');
    assert.strictEqual(receipt.paths[0], path.join(allowedPath, 'result.txt'));
  });

  await t.test('coordinator path scope validation', () => {
    let threw2 = false;
    try {
      execSync(`node "${coordinatorPath}" seed --agent "x" --objective "o" --acceptanceCriteria "a" --allowedPaths "C:/"`, { encoding: 'utf8', env, stdio: 'pipe' });
    } catch (err) {
      threw2 = true;
      const out = err.stdout ? err.stdout.toString() : '';
      const errOut = err.stderr ? err.stderr.toString() : '';
      const msg = out + errOut + err.message;
      assert.ok(msg.includes('must be narrowed'), 'Did not match expected error: ' + msg);
    }
    assert.ok(threw2);
    
    let threw3 = false;
    try {
      execSync(`node "${coordinatorPath}" seed --agent "x" --objective "data" --acceptanceCriteria "a" --allowedPaths "/tmp/a" --mySecret "123"`, { encoding: 'utf8', env, stdio: 'pipe' });
    } catch (err) {
      threw3 = true;
      const out = err.stdout ? err.stdout.toString() : '';
      const errOut = err.stderr ? err.stderr.toString() : '';
      const msg = out + errOut + err.message;
      assert.ok(msg.includes('secret-bearing'), 'Did not match expected error: ' + msg);
    }
    assert.ok(threw3);
  });
});
