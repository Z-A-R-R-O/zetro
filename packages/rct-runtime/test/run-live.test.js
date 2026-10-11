import test from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256 } from '../src/workspace.js';

const exec = promisify(execFile);

test('run-live gated one-file execution', async (t) => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'rct-run-live-test-'));

  try {
    await mkdir(path.join(tmp, 'src'));
    const sourceFile = path.join(tmp, 'src', 'greeting.txt');
    const sourceContent = 'hello\n';
    await writeFile(sourceFile, sourceContent);

    // We'll write different assignments to test the gates
    const writeManifest = async (name, manifest) => {
      const fp = path.join(tmp, name);
      const content = JSON.stringify(manifest);
      await writeFile(fp, content);
      return { path: fp, hash: sha256(content) };
    };

    const baseManifest = {
      schemaVersion: 'rct.assignment.v1',
      taskId: 'live-test',
      objective: 'test',
      acceptance: ['test'],
      source: { root: tmp, expectedSha256: '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03' },
      scope: { readPaths: ['src/greeting.txt'], writePaths: ['src/greeting.txt'] },
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }],
      dataPolicy: { classification: 'public', allowRemoteInference: true, provider: 'groq', model: 'qwen/qwen3.8-27b' },
      budget: { maxTurns: 2, maxInputTokens: 1000, maxOutputTokens: 500, maxWallMs: 60000 }
    };

    const cliPath = path.join(import.meta.dirname, '../src/cli.js');

    // 1. Missing approval hash
    const valid = await writeManifest('valid.json', baseManifest);
    let result = await exec(process.execPath, [cliPath, 'run-live', valid.path]).catch(e => e);
    assert.strictEqual(result.code, 2, 'Should fail missing approve flag');
    assert.match(result.stderr || result.stdout, /Usage:.*--approve/);

    // 2. Mismatched approval hash
    const fakeEnv = { ...process.env, GROQ_API_KEY: 'test_key' };
    result = await exec(process.execPath, [cliPath, 'run-live', valid.path, '--approve', 'wrong-hash'], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /Approval mismatch/);

    // 2a. Missing expectedSha256
    const noHash = await writeManifest('nohash.json', { ...baseManifest, source: { root: tmp } });
    result = await exec(process.execPath, [cliPath, 'run-live', noHash.path, '--approve', noHash.hash], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /Live manifest must declare source\.expectedSha256/);

    // 2b. Wrong expectedSha256
    const wrongHash = await writeManifest('wronghash.json', { ...baseManifest, source: { root: tmp, expectedSha256: '0000000000000000000000000000000000000000000000000000000000000000' } });
    result = await exec(process.execPath, [cliPath, 'run-live', wrongHash.path, '--approve', wrongHash.hash], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /source\.expectedSha256 does not match disk at admission time/);

    // 2c. Source changed after admission
    const changedSrcManifest = await writeManifest('changedsrc.json', baseManifest);
    await writeFile(sourceFile, 'hello modified\n');
    result = await exec(process.execPath, [cliPath, 'run-live', changedSrcManifest.path, '--approve', changedSrcManifest.hash], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /does not match disk at admission time/);
    await writeFile(sourceFile, 'hello\n'); // restore for subsequent tests

    // 3. Non-consenting policy
    const noRemote = await writeManifest('noremote.json', { ...baseManifest, dataPolicy: { ...baseManifest.dataPolicy, allowRemoteInference: false } });
    result = await exec(process.execPath, [cliPath, 'run-live', noRemote.path, '--approve', noRemote.hash], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /allowRemoteInference is not true/);

    // 4. Unsupported model (both non-string and unsupported string)
    const badModel = await writeManifest('badmodel.json', { ...baseManifest, dataPolicy: { ...baseManifest.dataPolicy, model: 123 } });
    result = await exec(process.execPath, [cliPath, 'run-live', badModel.path, '--approve', badModel.hash], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /Provider must be groq with a specified model/);
    const unknownModel = await writeManifest('unknownmodel.json', { ...baseManifest, dataPolicy: { ...baseManifest.dataPolicy, model: 'unknown-model' } });
    result = await exec(process.execPath, [cliPath, 'run-live', unknownModel.path, '--approve', unknownModel.hash], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /Model unknown-model is not permitted/);

    // 5. Excessive budgets
    const highBudget = await writeManifest('high.json', { ...baseManifest, budget: { maxTurns: 10 } });
    result = await exec(process.execPath, [cliPath, 'run-live', highBudget.path, '--approve', highBudget.hash], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /Budgets exceed conservative live pilot ceiling/);

    // 6. > 1 file
    await writeFile(path.join(tmp, 'src', 'other.txt'), 'other');
    const twoFiles = await writeManifest('two.json', { ...baseManifest, scope: { readPaths: ['src/greeting.txt', 'src/other.txt'], writePaths: [] } });
    result = await exec(process.execPath, [cliPath, 'run-live', twoFiles.path, '--approve', twoFiles.hash], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /restricted to exactly one existing file/);

    // 7. createPaths
    const create = await writeManifest('create.json', { ...baseManifest, scope: { ...baseManifest.scope, createPaths: ['src/new.txt'] } });
    result = await exec(process.execPath, [cliPath, 'run-live', create.path, '--approve', create.hash], { env: fakeEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /createPaths not allowed in live pilot/);

    // 8. Prove missing GROQ_API_KEY fails before network
    const env = { ...process.env };
    delete env.GROQ_API_KEY;
    result = await exec(process.execPath, [cliPath, 'run-live', valid.path, '--approve', valid.hash], { env }).catch(e => e);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /GROQ_API_KEY environment variable is missing/);

    // 9. Prove accepted path runs in a private snapshot, leaves source identical, returns artifact
    const liveEnv = { ...process.env, GROQ_API_KEY: 'test_key', NODE_OPTIONS: `--require ${path.join(import.meta.dirname, 'mock-fetch.js')}` };
    const successManifest = await writeManifest('success.json', { ...baseManifest, checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello world' }] });
    result = await exec(process.execPath, [cliPath, 'run-live', successManifest.path, '--approve', successManifest.hash], { env: liveEnv }).catch(e => e);

    assert.ok(!result.code && result.stdout, `Execution should yield exit 0. Output: ${result.stdout} Error: ${result.stderr}`);
    const metadata = JSON.parse(result.stdout.trim());
    assert.strictEqual(metadata.state, 'review_ready');
    assert.strictEqual(metadata.sourceUnchanged, true);
    assert.strictEqual(metadata.usage.outputTokens, 40);
    assert.strictEqual(metadata.patches, undefined); // stdout must not contain patches/source
    assert.strictEqual(metadata.checks, undefined); // stdout must not contain checks output
    assert.strictEqual(metadata.events, undefined); // stdout must not contain events
    assert.strictEqual(metadata.eventCount, 2);

    // Verify artifact contains full contents
    const artifact = JSON.parse(await readFile(metadata.artifactPath, 'utf8'));
    assert.strictEqual(artifact.state, 'review_ready');
    assert.deepEqual(artifact.changedPaths, ['src/greeting.txt']);
    assert.ok(artifact.sourceHashes['src/greeting.txt']);
    assert.ok(artifact.checks[0].passed);
    assert.strictEqual(artifact.eventCount, 2);
    assert.strictEqual(artifact.events.length, 2);
    assert.strictEqual(artifact.events[0].tool, 'propose_patch');
    assert.strictEqual(artifact.events[0].ok, true);
    assert.strictEqual(artifact.events[1].tool, 'submit_receipt');
    assert.strictEqual(artifact.events[1].ok, true);
    assert.strictEqual(artifact.patches[0].beforeContent, 'hello\n');
    assert.strictEqual(artifact.patches[0].afterContent, 'hello world\n');

    // Verify source bytes are identical
    const finalSource = await import('node:fs/promises').then(m => m.readFile(sourceFile, 'utf8'));
    assert.strictEqual(finalSource, 'hello\n');

    // 10. Failure case: wrong hash or unpassed checks leads to failure, not review_ready
    const failManifest = await writeManifest('fail.json', { ...baseManifest, checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'impossible_string' }] });
    result = await exec(process.execPath, [cliPath, 'run-live', failManifest.path, '--approve', failManifest.hash], { env: liveEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    const failArtifact = JSON.parse(result.stdout.trim());
    assert.strictEqual(failArtifact.state, 'budget_exhausted');
    assert.strictEqual(failArtifact.sourceUnchanged, true);

    // 11. Mock HTTP 502 yields remoteUsageUncertain and unknown state
    const failEnv = { ...liveEnv, MOCK_502: '1' };
    const errManifest = await writeManifest('err.json', baseManifest);
    result = await exec(process.execPath, [cliPath, 'run-live', errManifest.path, '--approve', errManifest.hash], { env: failEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    const errMetadata = JSON.parse(result.stdout.trim());
    assert.strictEqual(errMetadata.state, 'unknown');
    assert.strictEqual(errMetadata.remoteUsageUncertain, true);
    const errArtifact = JSON.parse(await readFile(errMetadata.artifactPath, 'utf8'));
    assert.strictEqual(errArtifact.remoteUsageUncertain, true);

    // 12. Max output tokens uses full 2000 remaining allowance
    const maxTokensEnv = { ...liveEnv, ASSERT_MAX_TOKENS: '2000' };
    const maxTokensManifest = await writeManifest('maxtokens.json', { ...baseManifest, budget: { ...baseManifest.budget, maxOutputTokens: 2000 } });
    result = await exec(process.execPath, [cliPath, 'run-live', maxTokensManifest.path, '--approve', maxTokensManifest.hash], { env: maxTokensEnv }).catch(e => e);
    assert.ok(result.code !== 5, 'ASSERT_MAX_TOKENS failed in mock-fetch.js');
    assert.ok(!result.code, `Execution should yield exit 0. Output: ${result.stdout} Error: ${result.stderr}`);

    // 13. Snapshot dispose failure forces error state in persisted artifact and stdout
    const failCleanupEnv = { ...liveEnv, MOCK_CLEANUP_FAIL: '1', NODE_ENV: 'test' };
    const cleanupManifest = await writeManifest('cleanup.json', { ...baseManifest, checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello world' }] });
    result = await exec(process.execPath, [cliPath, 'run-live', cleanupManifest.path, '--approve', cleanupManifest.hash], { env: failCleanupEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    const cleanupMetadata = JSON.parse(result.stdout.trim());
    assert.strictEqual(cleanupMetadata.state, 'error');
    assert.match(cleanupMetadata.failureReason, /Snapshot cleanup failed/);
    const cleanupArtifact = JSON.parse(await readFile(cleanupMetadata.artifactPath, 'utf8'));
    assert.strictEqual(cleanupArtifact.state, 'error');
    assert.match(cleanupArtifact.failureReason, /Snapshot cleanup failed/);

    // 14. Mock invalid tool call records failure event in artifact and stdout stays metadata-only
    const invalidToolEnv = { ...liveEnv, MOCK_INVALID_TOOL: '1' };
    const invalidManifest = await writeManifest('invalid-tool.json', baseManifest);
    result = await exec(process.execPath, [cliPath, 'run-live', invalidManifest.path, '--approve', invalidManifest.hash], { env: invalidToolEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    const invalidMeta = JSON.parse(result.stdout.trim());
    assert.strictEqual(invalidMeta.state, 'failed');
    assert.strictEqual(invalidMeta.failureReason, 'worker_or_tool_error');
    assert.strictEqual(invalidMeta.eventCount, 1);
    assert.strictEqual(invalidMeta.sourceUnchanged, true);
    assert.strictEqual(invalidMeta.events, undefined); // stdout must not have events
    assert.strictEqual(invalidMeta.patches, undefined); // stdout must not have patches
    assert.strictEqual(invalidMeta.checks, undefined); // stdout must not have checks

    const invalidArtifact = JSON.parse(await readFile(invalidMeta.artifactPath, 'utf8'));
    assert.strictEqual(invalidArtifact.state, 'failed');
    assert.strictEqual(invalidArtifact.failureReason, 'worker_or_tool_error');
    assert.strictEqual(invalidArtifact.eventCount, 1);
    assert.strictEqual(invalidArtifact.events.length, 1);
    assert.strictEqual(invalidArtifact.events[0].tool, 'hallucinated_tool');
    assert.strictEqual(invalidArtifact.events[0].ok, false);
    assert.strictEqual(invalidArtifact.events[0].error, 'Invalid tool call');
    assert.strictEqual(invalidArtifact.events[0].turn, 0);

    const sourceAfterInvalid = await readFile(sourceFile, 'utf8');
    assert.strictEqual(sourceAfterInvalid, 'hello\n');

    // 15. Reproduce exact first-tool failure: invalid slice parameters yield safe diagnostic failure receipt
    const invalidSliceEnv = { ...liveEnv, MOCK_READ_SLICE_INVALID: '1' };
    const invalidSliceManifest = await writeManifest('invalid-slice.json', baseManifest);
    result = await exec(process.execPath, [cliPath, 'run-live', invalidSliceManifest.path, '--approve', invalidSliceManifest.hash], { env: invalidSliceEnv }).catch(e => e);
    assert.strictEqual(result.code, 1);
    const invalidSliceMeta = JSON.parse(result.stdout.trim());
    assert.strictEqual(invalidSliceMeta.state, 'failed');
    assert.strictEqual(invalidSliceMeta.failureReason, 'worker_or_tool_error');
    assert.strictEqual(invalidSliceMeta.eventCount, 1);
    assert.strictEqual(invalidSliceMeta.sourceUnchanged, true);
    assert.strictEqual(invalidSliceMeta.events, undefined); // stdout stays metadata-only

    const invalidSliceArtifact = JSON.parse(await readFile(invalidSliceMeta.artifactPath, 'utf8'));
    assert.strictEqual(invalidSliceArtifact.state, 'failed');
    assert.strictEqual(invalidSliceArtifact.failureReason, 'worker_or_tool_error');
    assert.strictEqual(invalidSliceArtifact.eventCount, 1);
    assert.strictEqual(invalidSliceArtifact.events[0].tool, 'read_slice');
    assert.strictEqual(invalidSliceArtifact.events[0].ok, false);
    assert.strictEqual(invalidSliceArtifact.events[0].error, 'Invalid slice');
    assert.strictEqual(invalidSliceArtifact.events[0].turn, 0);

    const sourceAfterInvalidSlice = await readFile(sourceFile, 'utf8');
    assert.strictEqual(sourceAfterInvalidSlice, 'hello\n');

    // 16. Valid bounded read when optional fields are null or omitted
    const nullSliceEnv = { ...liveEnv, MOCK_READ_SLICE_NULL: '1' };
    const nullSliceManifest = await writeManifest('null-slice.json', { ...baseManifest, checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello world' }], budget: { ...baseManifest.budget, maxTurns: 4 } });
    result = await exec(process.execPath, [cliPath, 'run-live', nullSliceManifest.path, '--approve', nullSliceManifest.hash], { env: nullSliceEnv }).catch(e => e);
    assert.ok(!result.code, `Execution with null slice fields should succeed: ${result.stdout} Error: ${result.stderr}`);
    const nullSliceMeta = JSON.parse(result.stdout.trim());
    assert.strictEqual(nullSliceMeta.state, 'review_ready');
    assert.strictEqual(nullSliceMeta.sourceUnchanged, true);

    const nullSliceArtifact = JSON.parse(await readFile(nullSliceMeta.artifactPath, 'utf8'));
    assert.strictEqual(nullSliceArtifact.state, 'review_ready');
    assert.strictEqual(nullSliceArtifact.events[0].tool, 'read_slice');
    assert.strictEqual(nullSliceArtifact.events[0].ok, true);

    // 17. Valid bounded read when length exceeds 4096 (safely clamped to bound)
    const overSliceEnv = { ...liveEnv, MOCK_READ_SLICE_OVERSIZED: '1' };
    const overSliceManifest = await writeManifest('oversized-slice.json', { ...baseManifest, checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello world' }], budget: { ...baseManifest.budget, maxTurns: 4 } });
    result = await exec(process.execPath, [cliPath, 'run-live', overSliceManifest.path, '--approve', overSliceManifest.hash], { env: overSliceEnv }).catch(e => e);
    assert.ok(!result.code, `Execution with oversized length should clamp and succeed: ${result.stdout} Error: ${result.stderr}`);
    const overSliceMeta = JSON.parse(result.stdout.trim());
    assert.strictEqual(overSliceMeta.state, 'review_ready');
    assert.strictEqual(overSliceMeta.sourceUnchanged, true);

    const overSliceArtifact = JSON.parse(await readFile(overSliceMeta.artifactPath, 'utf8'));
    assert.strictEqual(overSliceArtifact.state, 'review_ready');
    assert.strictEqual(overSliceArtifact.events[0].tool, 'read_slice');
    assert.strictEqual(overSliceArtifact.events[0].ok, true);

  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
