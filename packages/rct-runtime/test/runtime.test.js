import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeProvider } from '../src/fake-provider.js';
import { runAssignment, ScopedWorkspace, sha256, validateAssignment } from '../src/index.js';

const assignment = (overrides = {}) => ({
  id: 'fixture', objective: 'Update fixture greeting', acceptance: 'Exact greeting content',
  allowedPaths: ['src/greeting.txt'],
  checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
  ...overrides
});

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rct-test-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('offline worker reaches review_ready only after independent check', () => fixture(async root => {
  const provider = new FakeProvider([
    { name: 'read_slice', args: { path: 'src/greeting.txt' } },
    { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
    { name: 'submit_receipt', args: { summary: 'Done' } }
  ]);
  const journalPath = path.join(root, 'journal.jsonl');
  const result = await runAssignment(assignment(), provider, root, { isolated: true, journalPath });
  assert.equal(result.state, 'review_ready');
  assert.equal(result.checks[0].passed, true);
  assert.equal(result.patches.length, 1);
  assert.deepEqual(result.usage, { inputTokens: 60, outputTokens: 30, requests: 3 });
  const records = (await readFile(journalPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(x => x.kind), ['started', 'tool', 'tool', 'tool', 'finished']);
  assert.equal(records[4].state, 'review_ready');
  assert.equal((await readFile(journalPath, 'utf8')).includes('hello world'), false);
}));

test('worker claim without patch is not review-ready', () => fixture(async root => {
  const result = await runAssignment(assignment(), new FakeProvider([{ name: 'submit_receipt', args: { summary: 'Done' } }]), root, { isolated: true });
  assert.equal(result.state, 'failed');
}));

test('wrong patch fails independent acceptance check', () => fixture(async root => {
  const provider = new FakeProvider([
    { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'wrong\n' } },
    { name: 'submit_receipt', args: { summary: 'Done' } }
  ]);
  const result = await runAssignment(assignment(), provider, root, { isolated: true });
  assert.equal(result.state, 'failed');
  assert.equal(result.checks[0].passed, false);
}));

test('worker can repair a failed exact check before receipt is accepted', () => fixture(async root => {
  const provider = new FakeProvider([
    { name: 'read_slice', args: { path: 'src/greeting.txt' } },
    { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world' } },
    { name: 'submit_receipt', args: { summary: 'Done' } },
    { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello world'), content: 'hello world\n' } },
    { name: 'submit_receipt', args: { summary: 'Corrected newline' } }
  ]);
  const result = await runAssignment(assignment(), provider, root, { isolated: true });
  assert.equal(result.state, 'review_ready');
  assert.equal(result.patches.length, 2);
  assert.equal(result.events.length, 5);
  assert.equal(result.workerSummary, 'Corrected newline');
}));

test('complete exact checks can finalize without another model request', () => fixture(async root => {
  const provider = new FakeProvider([
    { name: 'read_slice', args: { path: 'src/greeting.txt' } },
    { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
    { name: 'submit_receipt', args: { summary: 'Should not be needed' } }
  ]);
  const result = await runAssignment(assignment(), provider, root, { isolated: true, tools: ['read_slice', 'propose_patch'], autoFinalizeOnChecks: true });
  assert.equal(result.state, 'review_ready');
  assert.equal(result.completionSource, 'independent_checks');
  assert.equal(result.usage.requests, 2);
  assert.equal(provider.steps.length, 1);
}));

test('repeated no-op proposals stop early without charging write budget', () => fixture(async root => {
  const provider = new FakeProvider([
    { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world' } },
    { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello world'), content: 'hello world' } },
    { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello world'), content: 'hello world' } },
    { name: 'submit_receipt', args: { summary: 'Should never execute' } }
  ]);
  const result = await runAssignment(assignment(), provider, root, { isolated: true });
  assert.equal(result.state, 'failed');
  assert.equal(result.failureReason, 'repeated_noop');
  assert.equal(result.usage.requests, 3);
  assert.equal(result.patches.length, 1);
  assert.equal(provider.steps.length, 1);
}));

test('stale preimage fails without modifying the file', () => fixture(async root => {
  const provider = new FakeProvider([{ name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: '0'.repeat(64), content: 'bad\n' } }]);
  const result = await runAssignment(assignment(), provider, root, { isolated: true });
  assert.equal(result.state, 'failed');
  assert.equal(await readFile(path.join(root, 'src', 'greeting.txt'), 'utf8'), 'hello\n');
}));

test('out-of-scope and traversal paths are denied', () => fixture(async root => {
  const workspace = new ScopedWorkspace(root, ['src/greeting.txt']);
  await assert.rejects(workspace.readSlice('../secret.txt'));
  await assert.rejects(workspace.readSlice('src/../../secret.txt'));
  await assert.rejects(workspace.readSlice('src/other.txt'));
  assert.throws(() => validateAssignment(assignment({ allowedPaths: ['C:/Users/secret.txt'] })));
  assert.throws(() => validateAssignment(assignment({ allowedPaths: ['.env'] })));
}));

test('symlink escape is denied', () => fixture(async root => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'rct-outside-'));
  try {
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    try {
      await symlink(path.join(outside, 'secret.txt'), path.join(root, 'src', 'link.txt'), 'file');
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') return;
      throw error;
    }
    const workspace = new ScopedWorkspace(root, ['src/link.txt']);
    await assert.rejects(workspace.readSlice('src/link.txt'));
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
}));

test('isolation declaration and budgets are enforced', () => fixture(async root => {
  await assert.rejects(runAssignment(assignment(), new FakeProvider([]), root), /isolated/);
  await assert.rejects(runAssignment(assignment(), new FakeProvider([]), root, { isolated: true, tools: ['arbitrary_shell'] }), /Invalid allowed tools/);
  const result = await runAssignment(assignment({ budget: { maxTurns: 1 } }), new FakeProvider([{ name: 'list_paths', args: {} }]), root, { isolated: true });
  assert.equal(result.state, 'budget_exhausted');
  const tooMuch = await runAssignment(assignment({ budget: { maxOutputTokens: 100 } }), { name: 'overuse', async next() { return { toolCalls: [{ name: 'submit_receipt', args: {} }], usage: { inputTokens: 20, outputTokens: 101 } }; } }, root, { isolated: true });
  assert.equal(tooMuch.state, 'budget_exhausted');
}));
