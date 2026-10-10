import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentTools } from '../src/index.js';

const mockAdapter = {
    verifyAll: async () => ([{ agent: 'AGR-1', connected: true, csrfToken: 'secret123', prompt: 'hello', error: 'A'.repeat(500) }]),
    verify: async (id) => ({ id, status: 'active' }),
    send: async (id, msg) => ({ queued: true }),
    observe: async (id) => ({ id, state: 'idle' }),
    observeAll: async () => ([
        { agent: 'AGR-1', connected: true, state: 'idle', stepCount: 5, workspace: '/a/b', conversationId: 'uuid1' }
    ])
};

async function run() {
    console.log('Running unit tests...');
    const tools = new AgentTools(mockAdapter, { maxOutputChar: 5000 });

    let res = JSON.parse(await tools.statusCompact());
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.data[0].workspace, undefined, 'Workspace must be stripped');
    assert.strictEqual(res.data[0].conversationId, undefined, 'ConversationId must be stripped');
    assert.strictEqual(res.data[0].agent, 'AGR-1');
    assert.strictEqual(res.data[0].stepCount, 5);

    // Mock sendPacked tests
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-test-'));
    const taskJson = path.join(tmpDir, 'task.json');
    fs.writeFileSync(taskJson, JSON.stringify({
        objective: 'test packed',
        acceptance: 'pass',
        permissions: 'none',
        blockers: 'none',
        context: { big: 'A'.repeat(5000) }
    }));
    const storeDir = path.join(tmpDir, 'store');
    
    // Normal dry-run
    const sPackRes = await tools.sendPacked('AGR-1', taskJson, storeDir, '2000', true);
    const parsedPack = JSON.parse(sPackRes);
    if (parsedPack.status === 'error') console.error(parsedPack);
    assert.strictEqual(parsedPack.status, 'not_attempted');
    assert.ok(parsedPack.metrics.savedChars > 800, 'Must compress context');

    // Strict integer requirement test
    const sPackJunk = await tools.sendPacked('AGR-1', taskJson, storeDir, '200junk', true);
    assert.strictEqual(JSON.parse(sPackJunk).status, 'error');
    assert.ok(JSON.parse(sPackJunk).message.includes('exact positive integer'));

    console.log('Unit tests passed.');
}
run().catch(e => { console.error(e); process.exit(1); });
