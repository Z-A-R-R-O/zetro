#!/usr/bin/env node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeProvider } from './fake-provider.js';
import { createSnapshot, runAssignment, sha256 } from './index.js';
import { GroqProvider } from './groq-provider.js';
import { admitAssignment } from './admission.js';

function networkCodes(error) {
  const codes = new Set();
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (typeof item.code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(item.code)) codes.add(item.code);
    if (Array.isArray(item.errors)) item.errors.forEach(visit);
    visit(item.cause);
  };
  visit(error);
  return [...codes];
}

async function demo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zetro-rct-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');
    const provider = new FakeProvider([
      { name: 'list_paths', args: {} },
      { name: 'read_slice', args: { path: 'src/greeting.txt', start: 0, length: 100 } },
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
      { name: 'submit_receipt', args: { summary: 'Updated the isolated fixture.' } }
    ]);
    return await runAssignment({ id: 'offline-demo', objective: 'Update the greeting in the fixture', acceptance: 'Greeting equals hello world', allowedPaths: ['src/greeting.txt'], checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }] }, provider, root, { isolated: true, journalPath: path.join(root, 'rct-journal.jsonl') });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function liveFixture(model) {
  if (!process.env.GROQ_API_KEY) return { status: 'not_configured', provider: 'groq', networkAttempted: false };
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'zetro-rct-source-'));
  let snapshot;
  try {
    await mkdir(path.join(sourceRoot, 'src'));
    await writeFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'hello\n');
    snapshot = await createSnapshot(sourceRoot, ['src/greeting.txt']);
    const provider = new GroqProvider({ model });
    const receipt = await runAssignment({
      id: 'live-synthetic-fixture',
      objective: 'Change the entire content of src/greeting.txt from hello to hello world, preserving one trailing newline. Read the file first, then use its SHA-256 preimage to propose the replacement, then submit a receipt.',
      acceptance: 'src/greeting.txt must equal exactly "hello world" followed by one newline.',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
      budget: { maxTurns: 8, maxInputTokens: 6000, maxOutputTokens: 2000, maxPromptChars: 16000, maxReadBytes: 4096, maxWriteBytes: 4096, maxWallMs: 180000 }
    }, provider, snapshot.root, { isolated: true, journalPath: path.join(snapshot.root, 'journal.jsonl'), tools: ['read_slice', 'propose_patch'], autoFinalizeOnChecks: true });
    return { ...receipt, sourceUnchanged: await snapshot.sourceUnchanged(), syntheticOnly: true };
  } finally {
    if (snapshot) await snapshot.dispose();
    await rm(sourceRoot, { recursive: true, force: true });
  }
}

if (process.argv[2] === 'demo') {
  const result = await demo();
  console.log(JSON.stringify(result, null, 2));
  if (result.state !== 'review_ready') process.exitCode = 1;
} else if (process.argv[2] === 'live-fixture') {
  try {
    const result = await liveFixture(process.argv[3] ?? 'qwen/qwen3.8-27b');
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== 'review_ready' || result.sourceUnchanged !== true) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ status: 'error', stage: 'live_fixture', message: error.message, networkCodes: networkCodes(error) }));
    process.exitCode = 1;
  }
} else if (process.argv[2] === 'probe') {
  if (!process.env.GROQ_API_KEY) {
    console.log(JSON.stringify({ status: 'not_configured', provider: 'groq', keyPresent: false, networkAttempted: false }));
    process.exitCode = 1;
  } else {
    try {
      const model = process.argv[3] ?? 'qwen/qwen3.8-27b';
      const provider = new GroqProvider({ model });
      let stage = 'access';
      let access;
      try {
        access = await provider.checkAccess();
      } catch (error) {
        console.log(JSON.stringify({ status: 'error', stage, provider: provider.name, message: error.message, networkCodes: networkCodes(error) }));
        process.exitCode = 1;
      }
      if (access) {
        if (!access.modelAvailable) {
          console.log(JSON.stringify({ status: 'model_unavailable', stage, provider: provider.name, authenticated: true }));
          process.exitCode = 1;
        } else {
          stage = 'tool_call';
          try {
      const result = await provider.next({
        messages: [{ role: 'system', content: 'Call list_paths once.' }, { role: 'user', content: 'This is a public synthetic connectivity probe. Call list_paths.' }],
        tools: ['list_paths'], maxOutputTokens: 128, timeoutMs: 60000
      });
      console.log(JSON.stringify({ status: result.toolCalls[0].name === 'list_paths' ? 'connected' : 'unexpected_tool', stage, provider: provider.name, authenticated: true, modelAvailable: true, usage: result.usage }));
      if (result.toolCalls[0].name !== 'list_paths') process.exitCode = 1;
          } catch (error) {
            console.log(JSON.stringify({ status: 'error', stage, provider: provider.name, authenticated: true, modelAvailable: true, message: error.message, networkCodes: networkCodes(error) }));
            process.exitCode = 1;
          }
        }
      }
    } catch (error) {
      console.log(JSON.stringify({ status: 'error', provider: 'groq', message: error.message }));
      process.exitCode = 1;
    }
  }
} else if (process.argv[2] === 'plan') {
  const manifestPath = process.argv[3];
  if (!manifestPath) {
    console.error('Usage: node src/cli.js plan <assignment.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = await admitAssignment(path.resolve(manifestPath));
      console.log(JSON.stringify(result, null, 2));
      if (!result.accepted) process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify({ accepted: false, reason: `Admission error: ${error.message}` }));
      process.exitCode = 1;
    }
  }
} else {
  console.error('Usage: node src/cli.js demo | probe [model] | live-fixture [model] | plan <assignment.json>');
  process.exitCode = 2;
}
