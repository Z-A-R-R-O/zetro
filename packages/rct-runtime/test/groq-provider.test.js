import test from 'node:test';
import assert from 'node:assert/strict';
import { GroqProvider } from '../src/groq-provider.js';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAssignment, sha256 } from '../src/index.js';

test('Groq adapter maps messages, tools and measured usage', async () => {
  let request;
  const provider = new GroqProvider({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: 'list_paths', arguments: '{}' } }] } }], usage: { prompt_tokens: 37, completion_tokens: 9 } }) };
  } });
  const result = await provider.next({ messages: [
    { role: 'user', content: 'List files' },
    { role: 'assistant', toolCall: { name: 'list_paths', args: {} } },
    { role: 'tool', name: 'list_paths', content: '["src/a.txt"]' }
  ], tools: ['list_paths'], maxOutputTokens: 64, timeoutMs: 1000 });
  assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'qwen/qwen3.8-27b');
  assert.equal(body.messages[2].tool_call_id, body.messages[1].tool_calls[0].id);
  assert.equal(body.tools.length, 1);
  assert.equal(body.max_completion_tokens, 64);
  assert.deepEqual(result, { toolCalls: [{ name: 'list_paths', args: {} }], usage: { inputTokens: 37, outputTokens: 9 } });
});

test('Groq adapter handles rate limit without logging response body', async () => {
  const provider = new GroqProvider({ apiKey: 'test-key', fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => '3' } }) });
  await assert.rejects(provider.next({ messages: [{ role: 'user', content: 'x' }], tools: ['list_paths'], maxOutputTokens: 64, timeoutMs: 1000 }), error => error.name === 'RateLimitError' && error.retryAfter === '3');
});

test('Groq adapter rejects unsupported models and malformed calls', async () => {
  assert.throws(() => new GroqProvider({ apiKey: 'test-key', model: 'unknown' }));
  const provider = new GroqProvider({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [] } }], usage: {} }) }) });
  await assert.rejects(provider.next({ messages: [{ role: 'user', content: 'x' }], tools: ['list_paths'], maxOutputTokens: 64, timeoutMs: 1000 }), /exactly one/);
});

test('Groq access check distinguishes authentication from model availability', async () => {
  const provider = new GroqProvider({ apiKey: 'test-key', model: 'openai/gpt-oss-120b', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/models');
    assert.equal(options.method, 'GET');
    return { ok: true, json: async () => ({ data: [{ id: 'qwen/qwen3.8-27b' }] }) };
  } });
  assert.deepEqual(await provider.checkAccess(), { authenticated: true, modelAvailable: false, model: 'openai/gpt-oss-120b' });
});

test('Groq inference retries one transport failure without repeating any local tool', async () => {
  let attempts = 0;
  const provider = new GroqProvider({ apiKey: 'test-key', retryDelayMs: 0, fetchImpl: async () => {
    attempts++;
    if (attempts === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: 'list_paths', arguments: '{}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 4 } }) };
  } });
  const result = await provider.next({ messages: [{ role: 'user', content: 'x' }], tools: ['list_paths'], maxOutputTokens: 64, timeoutMs: 3000 });
  assert.equal(attempts, 2);
  assert.equal(result.toolCalls[0].name, 'list_paths');
});

test('persistent transport failure remains unknown with uncertain remote usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rct-transport-test-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');
    const provider = new GroqProvider({ apiKey: 'test-key', retryDelayMs: 0, fetchImpl: async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
    } });
    const receipt = await runAssignment({ objective: 'Update fixture greeting', acceptance: 'Exact greeting content', allowedPaths: ['src/greeting.txt'], checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }] }, provider, root, { isolated: true });
    assert.equal(receipt.state, 'unknown');
    assert.equal(receipt.usage.requests, 1);
    assert.equal(receipt.remoteUsageUncertain, true);
    assert.deepEqual(receipt.events[0].networkCodes, ['ECONNRESET']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Groq adapter drives full offline loop through mocked HTTP', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rct-groq-test-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');
    const steps = [
      { name: 'list_paths', args: {} },
      { name: 'read_slice', args: { path: 'src/greeting.txt' } },
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
      { name: 'submit_receipt', args: { summary: 'Done' } }
    ];
    const provider = new GroqProvider({ apiKey: 'test-key', fetchImpl: async () => {
      const step = steps.shift();
      return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }], usage: { prompt_tokens: 50, completion_tokens: 25 } }) };
    } });
    const result = await runAssignment({ objective: 'Update fixture greeting', acceptance: 'Exact greeting content', allowedPaths: ['src/greeting.txt'], checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }] }, provider, root, { isolated: true });
    assert.equal(result.state, 'review_ready');
    assert.equal(result.provider, 'groq:qwen/qwen3.8-27b');
    assert.equal(result.usage.requests, 4);
    assert.equal(steps.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
