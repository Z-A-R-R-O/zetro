const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

test('MCP Server Integration', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-server-test-'));

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Seed a task directly into the directory we will mount
  const tasksDir = path.join(tmpDir, 'tasks');
  fs.mkdirSync(tasksDir);
  const crypto = require('crypto');
  
  const taskId = 'test-id';
  const capabilityDigest = 'test-cap';
  const safeTaskId = crypto.createHash('sha256').update(taskId).digest('hex').slice(0, 16);
  const safeCap = crypto.createHash('sha256').update(capabilityDigest).digest('hex').slice(0, 16);
  
  fs.writeFileSync(path.join(tasksDir, `${safeTaskId}_${safeCap}.json`), JSON.stringify({
    taskId,
    agent: 'test-agent',
    allowedPaths: [],
    objective: 'obj',
    acceptanceCriteria: 'acc',
    contextRefs: {},
    capabilityDigest
  }));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '../src/server.js')],
    env: {
      ...process.env,
      MCP_STORAGE_DIR: tmpDir,
      MCP_MAX_BUDGET: '1000'
    }
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  }, { capabilities: { tools: {} } });

  await client.connect(transport);

  await t.test('list tools', async () => {
    const tools = await client.listTools();
    assert.strictEqual(tools.tools.length, 2);
    assert.strictEqual(tools.tools[0].name, 'fetch_task');
    assert.strictEqual(tools.tools[1].name, 'submit_receipt');
  });

  await t.test('call fetch_task successfully', async () => {
    const res = await client.callTool({
      name: 'fetch_task',
      arguments: { taskId, capabilityDigest }
    });
    assert.strictEqual(res.isError, undefined);
    assert.ok(res.content[0].text.includes('test-agent'));
  });

  await t.test('call fetch_task error capability mismatch', async () => {
    const res = await client.callTool({
      name: 'fetch_task',
      arguments: { taskId, capabilityDigest: 'wrong' }
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('not found'));
  });

  await t.test('call submit_receipt', async () => {
    const res = await client.callTool({
      name: 'submit_receipt',
      arguments: {
        taskId,
        capabilityDigest,
        receipt: {
          taskId,
          agent: 'test-agent',
          status: 'success'
        }
      }
    });
    assert.strictEqual(res.isError, undefined);
    assert.ok(res.content[0].text.includes('"success":true'));
  });

  await client.close();
});
