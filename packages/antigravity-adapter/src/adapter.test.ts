import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AntigravityAdapter, type AdapterDependencies } from './adapter.js';
import { AGENT_NAMES, type AgentConfig } from './config.js';
import type { Endpoint } from './discovery.js';
import type { AgentApiResponse } from './agentapi.js';

const config: AgentConfig = {
  schemaVersion: '1',
  projectId: 'project-1',
  workspace: 'E:\\Veyminore',
  agents: {
    'AGR-1': 'f4881509-063a-4690-b5c4-985fd16cb39f',
    'AGR-2': 'c7325399-fa02-4a1f-8417-9260a1d8c38a',
    'AGR-3': '20d3f993-477e-4eb2-a785-40b391bd091e',
    'AGR-4': '339c97a8-901b-4ee8-a3c4-8bd311e3de8c',
    'AGR-5': 'af8ce409-7904-41c5-9505-18e2145d3dfd',
  },
};

const endpoint: Endpoint = { address: '127.0.0.1:5000', csrfToken: 'test-token', source: 'windows-process' };

function metadata(id: string, projectId = config.projectId, workspace = 'file:///e:/Veyminore'): AgentApiResponse {
  return { response: { conversationMetadata: { metadata: {
    rootConversationId: id,
    projectId,
    workspaces: [{ workspaceFolderAbsoluteUri: workspace }],
  } } } };
}

function dependencies(run: AdapterDependencies['run'], endpoints = [endpoint]): AdapterDependencies {
  return { discover: async () => endpoints, executable: async () => 'agentapi-test.exe', run };
}

test('verifies all five exact conversation, project and workspace identities', async () => {
  const adapter = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, _command, args) => metadata(args[0]!)));
  const results = await adapter.verifyAll();
  assert.deepEqual(results.map((item) => item.agent), AGENT_NAMES);
  assert.ok(results.every((item) => item.connected));
});

test('tries another local endpoint when the first does not serve the conversation', async () => {
  const stale = { ...endpoint, address: '127.0.0.1:4000' };
  const adapter = new AntigravityAdapter(config, dependencies(async (_exe, candidate, _command, args) =>
    metadata(candidate.address === stale.address ? 'wrong-id' : args[0]!), [stale, endpoint]));
  const result = await adapter.verify('AGR-1');
  assert.equal(result.connected, true);
});

test('refuses to send when project or workspace identity changes', async () => {
  let sends = 0;
  const projectMismatch = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sends++; return { response: {} }; }
    return metadata(args[0]!, 'other-project');
  }));
  await assert.rejects(projectMismatch.send('AGR-2', 'hello'), /project ID mismatch/);

  const workspaceMismatch = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sends++; return { response: {} }; }
    return metadata(args[0]!, config.projectId, 'file:///c:/other');
  }));
  await assert.rejects(workspaceMismatch.send('AGR-2', 'hello'), /workspace mismatch/);
  assert.equal(sends, 0);
});

test('submits once and never claims task verification', async () => {
  let sends = 0;
  const adapter = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sends++; return { response: {} }; }
    return metadata(args[0]!);
  }));
  const result = await adapter.send('AGR-3', 'Please check the connection');
  assert.equal(sends, 1);
  assert.equal(result.delivery, 'submitted');
  assert.equal(result.verification, 'not_requested');
});

test('reports unknown delivery and does not retry after send failure', async () => {
  let sends = 0;
  const adapter = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sends++; throw new Error('connection dropped'); }
    return metadata(args[0]!);
  }));
  await assert.rejects(adapter.send('AGR-4', 'hello'), /connection dropped/);
  assert.equal(sends, 1);
});

test('rejects empty messages before connecting', async () => {
  let discovered = false;
  const adapter = new AntigravityAdapter(config, {
    discover: async () => { discovered = true; return [endpoint]; },
    executable: async () => 'agentapi-test.exe',
    run: async () => metadata(config.agents['AGR-1']),
  });
  await assert.rejects(adapter.send('AGR-1', '   '), /empty/);
  assert.equal(discovered, false);
});

test('observe uses discovery cache and diagnostic fallback', async () => {
  let discoveries = 0;
  const adapter = new AntigravityAdapter(config, {
    discover: async () => { discoveries++; return [endpoint]; },
    executable: async () => 'agentapi-test.exe',
    run: async (_exe, _candidate, _command, args) => metadata(args[0]!),
  });
  
  const obs1 = await adapter.observe('AGR-1');
  assert.equal(obs1.connected, true);
  assert.equal(obs1.confidence, 'diagnostic_fallback');
  assert.equal(discoveries, 1);
  
  const obs2 = await adapter.observe('AGR-2');
  assert.equal(obs2.connected, true);
  assert.equal(obs2.confidence, 'diagnostic_fallback');
  assert.equal(discoveries, 1); // should be cached
});

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

test('CLI smoke test for status JSON', () => {
  const result = spawnSync(process.execPath, [cliPath, 'status', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout);
  assert.equal(Array.isArray(data), true);
  assert.equal(data.length, 5);
  for (const row of data) {
    assert.equal(typeof row.agent, 'string');
    assert.ok(['idle', 'running', 'unknown'].includes(row.state));
    assert.equal(typeof row.stepCount, 'number');
    assert.equal(row.confidence, 'diagnostic_fallback');
  }
});

