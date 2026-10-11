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
} else if (process.argv[2] === 'run-offline' || process.argv[2] === 'run-live') {
  const mode = process.argv[2];
  const manifestPath = process.argv[3];
  const approveFlag = process.argv[4];
  const manifestHashParam = process.argv[5];

  if (!manifestPath || (mode === 'run-live' && (approveFlag !== '--approve' || !manifestHashParam))) {
    console.error(`Usage: node src/cli.js ${mode} <assignment.json>${mode === 'run-live' ? ' --approve <manifestHash>' : ''}`);
    process.exitCode = 2;
  } else if (mode === 'run-live' && !process.env.GROQ_API_KEY) {
    console.log(JSON.stringify({ status: 'error', stage: 'pre-network', reason: 'GROQ_API_KEY environment variable is missing' }));
    process.exitCode = 1;
  } else {
    try {
      const manifestPathResolved = path.resolve(manifestPath);
      const plan = await admitAssignment(manifestPathResolved);

      if (!plan.accepted) {
        console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: plan.reason, details: plan }));
        process.exitCode = 1;
      } else if (mode === 'run-live' && plan.manifestHash !== manifestHashParam) {
        console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: 'Approval mismatch: manifest hash does not match --approve argument' }));
        process.exitCode = 1;
      } else if (mode === 'run-live' && plan.dataPolicy.remoteInferencePermitted !== true) {
        console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: 'dataPolicy.allowRemoteInference is not true' }));
        process.exitCode = 1;
      } else if (mode === 'run-live' && (plan.dataPolicy.provider !== 'groq' || typeof plan.dataPolicy.model !== 'string' || !['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'].includes(plan.dataPolicy.model))) {
        if (typeof plan.dataPolicy.model === 'string' && plan.dataPolicy.provider === 'groq') {
          console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: `Model ${plan.dataPolicy.model} is not permitted` }));
        } else {
          console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: 'Provider must be groq with a specified model' }));
        }
        process.exitCode = 1;
      } else if (mode === 'run-live' && (plan.scope.readPaths.length > 1 || plan.scope.writePaths.length > 1 || new Set([...plan.scope.readPaths, ...plan.scope.writePaths]).size > 1)) {
        console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: 'Live pilot restricted to exactly one existing file' }));
        process.exitCode = 1;
      } else if (mode === 'run-live' && (!plan._rawManifest.source?.expectedSha256 || !/^[a-f0-9]{64}$/.test(plan._rawManifest.source.expectedSha256))) {
        console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: 'Live manifest must declare source.expectedSha256 (64 hex) for the target file' }));
        process.exitCode = 1;
      } else if (mode === 'run-live' && plan._rawManifest.source.expectedSha256 !== plan.scope.sourceHashes[[...new Set([...plan.scope.readPaths, ...plan.scope.writePaths])][0]]) {
        console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: 'source.expectedSha256 does not match disk at admission time' }));
        process.exitCode = 1;
      } else if (mode === 'run-live' && plan.scope.createPaths.length > 0) {
        console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: 'createPaths not allowed in live pilot' }));
        process.exitCode = 1;
      } else if (mode === 'run-live' && (plan.estimatedResourceCeilings.maxModelTurns > 6 || plan.estimatedResourceCeilings.maxInputTokens > 6000 || plan.estimatedResourceCeilings.maxOutputTokens > 2000 || plan.estimatedResourceCeilings.maxWallTimeMs > 180000)) {
        console.log(JSON.stringify({ status: 'error', stage: 'admission', reason: 'Budgets exceed conservative live pilot ceiling' }));
        process.exitCode = 1;
      } else if (mode === 'run-offline' && plan.scope.createPaths.length > 0) {
        console.log(JSON.stringify({ status: 'error', stage: 'execution', reason: 'createPaths are not safely executable with current runtime semantics' }));
        process.exitCode = 1;
      } else {
        const manifest = plan._rawManifest;
        const { readFile } = await import('node:fs/promises');
        const { sha256 } = await import('./workspace.js');
        const allowedPaths = [...new Set([...plan.scope.readPaths, ...plan.scope.writePaths])];

        let revalidateError = false;
        for (const p of allowedPaths) {
          const file = path.join(plan.sourceRoot, p);
          let bytes;
          try {
            bytes = await readFile(file);
          } catch (e) {
            console.log(JSON.stringify({ status: 'error', stage: 'revalidate', reason: `File ${p} vanished before snapshot` }));
            process.exitCode = 1;
            revalidateError = true;
            break;
          }
          if (sha256(bytes) !== plan.scope.sourceHashes[p]) {
            console.log(JSON.stringify({ status: 'error', stage: 'revalidate', reason: `File ${p} changed since plan` }));
            process.exitCode = 1;
            revalidateError = true;
            break;
          }
        }

        if (!revalidateError) {
          const snapshot = await createSnapshot(plan.sourceRoot, allowedPaths);

          let snapshotMismatch = false;
          for (const p of allowedPaths) {
            if (snapshot.sourceHashes[p] !== plan.scope.sourceHashes[p]) {
              console.log(JSON.stringify({ status: 'error', stage: 'snapshot', reason: `File ${p} changed during snapshot creation` }));
              snapshotMismatch = true;
              process.exitCode = 1;
              break;
            }
          }

          if (snapshotMismatch) {
            await snapshot.dispose();
          } else {
            const beforeContents = new Map();
            for (const p of allowedPaths) {
               try {
                   beforeContents.set(p, await readFile(path.join(snapshot.root, p), 'utf8'));
               } catch (e) {
                   beforeContents.set(p, null);
               }
            }

            let artifact = null;

            try {
              const provider = mode === 'run-live'
                ? new GroqProvider({ model: plan.dataPolicy.model })
                : new FakeProvider(manifest._fakeSteps || []);

              const runtimeAssignment = {
                id: manifest.taskId,
                objective: manifest.objective,
                acceptance: Array.isArray(manifest.acceptance) ? manifest.acceptance.join("\n") : manifest.acceptance,
                allowedPaths: { readPaths: plan.scope.readPaths, writePaths: plan.scope.writePaths },
                checks: manifest.checks,
                budget: plan.budget
              };

              const journalPath = path.join(snapshot.root, 'journal.jsonl');
              const tools = mode === 'run-live' ? ['read_slice', 'propose_patch', 'run_check', 'submit_receipt'] : undefined;
              const requestMaxOutputTokens = mode === 'run-live' ? 4096 : 1024;
              const receipt = await runAssignment(runtimeAssignment, provider, snapshot.root, { isolated: true, journalPath, tools, requestMaxOutputTokens });

              const sourceUnchanged = await snapshot.sourceUnchanged();

              let finalState = receipt.state;
              if (finalState === 'review_ready' && !sourceUnchanged) {
                finalState = 'error';
                receipt.failureReason = 'Source was modified despite snapshot isolation';
              }

              const boundedEvents = Array.isArray(receipt.events) ? receipt.events.slice(0, 50).map(ev => {
                const safe = {};
                if (typeof ev.turn === 'number') safe.turn = ev.turn;
                if (typeof ev.tool === 'string') safe.tool = ev.tool.slice(0, 64);
                else safe.tool = 'unknown';
                safe.ok = Boolean(ev.ok);
                if (typeof ev.resultHash === 'string') {
                  safe.resultHash = ev.resultHash.slice(0, 64);
                }
                if (!ev.ok && ev.error) {
                  let msg = String(ev.error).slice(0, 256);
                  msg = msg.replace(/gsk_[a-zA-Z0-9_-]+/g, '[REDACTED]');
                  msg = msg.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
                  safe.error = msg;
                }
                if (Array.isArray(ev.networkCodes)) {
                  safe.networkCodes = ev.networkCodes.map(c => String(c).slice(0, 32));
                }
                if (typeof ev.transportAttempts === 'number') {
                  safe.transportAttempts = ev.transportAttempts;
                }
                return safe;
              }) : [];

              let finalFailureReason = receipt.failureReason;
              if (finalState !== 'review_ready' && !finalFailureReason) {
                if (boundedEvents.some(e => !e.ok)) {
                  finalFailureReason = 'worker_or_tool_error';
                } else if (finalState === 'budget_exhausted') {
                  finalFailureReason = 'budget_exhausted';
                } else if (finalState === 'unknown') {
                  finalFailureReason = 'transport_error';
                } else {
                  finalFailureReason = 'worker_or_tool_error';
                }
              }

              artifact = {
                taskId: manifest.taskId,
                state: finalState,
                sourceUnchanged,
                usage: receipt.usage,
                completionSource: receipt.completionSource,
                failureReason: finalFailureReason,
                eventCount: boundedEvents.length,
                events: boundedEvents,
                changedPaths: receipt.patches.filter(p => p.applied).map(p => p.path),
                patches: receipt.patches,
                checks: receipt.checks,
                sourceHashes: plan.scope.sourceHashes
              };

              if (typeof receipt.workerSummary === 'string' && receipt.workerSummary.length > 0 && receipt.workerSummary.length <= 200 && /^[a-zA-Z0-9 .,_:-]+$/.test(receipt.workerSummary)) {
                artifact.workerSummary = receipt.workerSummary;
              }

              if (mode === 'run-live') {
                artifact.remoteUsageUncertain = receipt.remoteUsageUncertain;
              }

              for (const patch of artifact.patches) {
                  if (patch.applied) {
                      patch.afterContent = await readFile(path.join(snapshot.root, patch.path), 'utf8');
                      patch.beforeContent = beforeContents.get(patch.path) ?? null;
                  }
              }
            } catch(e) {
              artifact = artifact || { taskId: manifest.taskId, state: 'error', sourceUnchanged: false };
              artifact.state = 'error';
              artifact.failureReason = `Execution error: ${e.message}`;
              artifact.eventCount = artifact.eventCount ?? 0;
              artifact.events = artifact.events ?? [];
            }

            if (process.env.MOCK_CLEANUP_FAIL && process.env.NODE_ENV === 'test') {
               const originalDispose = snapshot.dispose;
               snapshot.dispose = async () => {
                 await originalDispose.call(snapshot);
                 throw new Error('Mocked cleanup failure');
               };
            }

            try {
               await snapshot.dispose();
            } catch(e) {
               if (artifact) {
                   artifact.state = 'error';
                   artifact.failureReason = `Snapshot cleanup failed: ${e.message}`;
               }
            }

            if (artifact) {
              try {
                const os = await import('node:os');
                const crypto = await import('node:crypto');
                const artifactPath = path.join(os.tmpdir(), `zetro-rct-artifact-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
                await import('node:fs/promises').then(m => m.writeFile(artifactPath, JSON.stringify(artifact, null, 2), { mode: 0o600 }));
                artifact.artifactPath = artifactPath;
              } catch(e) {
                artifact.state = 'error';
                artifact.failureReason = `Failed to persist artifact: ${e.message}`;
              }

              const metadata = {
                taskId: artifact.taskId,
                state: artifact.state,
                sourceUnchanged: artifact.sourceUnchanged,
                usage: artifact.usage,
                completionSource: artifact.completionSource,
                failureReason: artifact.failureReason,
                eventCount: artifact.eventCount ?? 0,
                changedPaths: artifact.changedPaths,
                sourceHashes: artifact.sourceHashes,
                artifactPath: artifact.artifactPath
              };
              if (mode === 'run-live') metadata.remoteUsageUncertain = artifact.remoteUsageUncertain;

              console.log(JSON.stringify(metadata, null, 2));
              if (artifact.state !== 'review_ready' || !artifact.sourceUnchanged) {
                process.exitCode = 1;
              }
            } else {
              process.exitCode = 1;
            }
          }
        }
      }
    } catch (error) {
      console.log(JSON.stringify({ status: 'error', stage: 'execution', reason: error.message }));
      process.exitCode = 1;
    }
  }
} else {
  console.error('Usage: node src/cli.js demo | probe [model] | live-fixture [model] | plan <assignment.json> | run-offline <assignment.json> | run-live <assignment.json> --approve <manifestHash>');
  process.exitCode = 2;
}
