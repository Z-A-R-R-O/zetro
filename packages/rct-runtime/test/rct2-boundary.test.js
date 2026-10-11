import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { admitAssignment } from '../src/admission.js';
import { sha256 } from '../src/workspace.js';

const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

describe('RCT-2 Safety Boundaries', () => {
  let tmpDir;
  let sourceRoot;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rct2-boundary-'));
    sourceRoot = path.join(tmpDir, 'src');
    await fs.mkdir(sourceRoot);
  });

  after(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function createManifest(name, overrides) {
    const filePath = path.join(tmpDir, name);
    const manifest = {
      schemaVersion: 'rct.assignment.v1',
      taskId: 'test-boundary-01',
      objective: 'Test boundaries',
      acceptance: ['Must pass boundary test'],
      source: { root: sourceRoot },
      scope: { readPaths: [], writePaths: [], createPaths: [] },
      dataPolicy: { classification: 'public' },
      checks: [{ type: 'contains', path: '', text: 'ok' }],
      ...overrides
    };
    await fs.writeFile(filePath, JSON.stringify(manifest, null, 2));
    return filePath;
  }

  async function runCli(manifestPath) {
    try {
      const { stdout, stderr } = await exec(process.execPath, [cliPath, 'run-offline', manifestPath]);
      return { code: 0, stdout, stderr };
    } catch (e) {
      return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
  }

  // --- Admission Only Tests ---

  test('Deterministic rejection of missing files', async () => {
    const manifest = await createManifest('missing.json', {
      scope: { readPaths: ['missing.txt'], writePaths: [], createPaths: [] },
      checks: [{ type: 'contains', path: 'missing.txt', text: 'ok' }]
    });
    const result = await admitAssignment(manifest);
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('Scope path is missing'));
  });

  test('Deterministic rejection of hidden/traversal paths', async () => {
    await fs.writeFile(path.join(sourceRoot, 'safe.txt'), 'safe');
    const manifest = await createManifest('traversal.json', {
      scope: { readPaths: ['../safe.txt'], writePaths: [], createPaths: [] },
      checks: [{ type: 'contains', path: '../safe.txt', text: 'ok' }]
    });
    const result = await admitAssignment(manifest);
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('Invalid paths in scope'));
  });

  test('Deterministic rejection of symlinks in read/write paths', async () => {
    const target = path.join(sourceRoot, 'target.txt');
    const link = path.join(sourceRoot, 'link.txt');
    await fs.writeFile(target, 'content');

    try {
      await fs.symlink(target, link, 'file');
    } catch (e) {
      const targetDir = path.join(sourceRoot, 'targetDir');
      const linkDir = path.join(sourceRoot, 'linkDir');
      await fs.mkdir(targetDir);
      await fs.writeFile(path.join(targetDir, 'file.txt'), 'content');
      await fs.symlink(targetDir, linkDir, 'junction');

      const manifestDir = await createManifest('symlinkDir.json', {
        scope: { readPaths: ['linkDir/file.txt'], writePaths: [], createPaths: [] },
        checks: [{ type: 'contains', path: 'linkDir/file.txt', text: 'ok' }]
      });
      const resultDir = await admitAssignment(manifestDir);
      assert.equal(resultDir.accepted, false);
      assert.ok(resultDir.reason.includes('Scope path is missing, inaccessible, or unsafe'));
      return;
    }

    const manifest = await createManifest('symlink.json', {
      scope: { readPaths: ['link.txt'], writePaths: [], createPaths: [] },
      checks: [{ type: 'contains', path: 'link.txt', text: 'ok' }]
    });
    const result = await admitAssignment(manifest);
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('Scope path is missing, inaccessible, or unsafe'));
  });

  test('Source hashes in admitted plans (AGR-5 capability)', async () => {
    await fs.writeFile(path.join(sourceRoot, 'hash.txt'), 'content');
    const manifest = await createManifest('hash.json', {
      scope: { readPaths: ['hash.txt'], writePaths: [], createPaths: [] },
      checks: [{ type: 'contains', path: 'hash.txt', text: 'ok' }]
    });
    const result = await admitAssignment(manifest);
    assert.equal(result.accepted, true);
    assert.ok(result.scope.sourceHashes);
    assert.ok(typeof result.scope.sourceHashes['hash.txt'] === 'string');
  });

  // AGR-3: Empty contains check is rejected at admission
  test('Empty contains check is rejected at admission', async () => {
    await fs.writeFile(path.join(sourceRoot, 'empty.txt'), 'content');
    const manifest = await createManifest('empty.json', {
      scope: { readPaths: ['empty.txt'], writePaths: [], createPaths: [] },
      checks: [{ type: 'contains', path: 'empty.txt', text: '' }]
    });
    const result = await admitAssignment(manifest);
    assert.equal(result.accepted, false);
  });

  // --- Run Offline CLI Tests ---

  test('Deterministic rejection of unsupported creation (fail closed at execution)', async () => {
    // Tests that createPaths are rejected at the execution phase (cli.js re-evaluation logic)
    await fs.writeFile(path.join(sourceRoot, 'existing.txt'), 'exists');
    const manifestPath = await createManifest('create.json', {
      scope: { readPaths: ['existing.txt'], writePaths: [], createPaths: ['missing.txt'] },
      checks: [{ type: 'contains', path: 'existing.txt', text: 'exists' }]
    });
    const res = await runCli(manifestPath);
    assert.notEqual(res.code, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.status, 'error');
    assert.equal(parsed.stage, 'execution');
    assert.ok(parsed.reason.includes('createPaths are not safely executable'));
  });

  test.todo('Source changed after admission: runner startup should verify sourceHashes against current disk state (Not testable via run-offline as it atomically re-admits)');

  test('Snapshot-only changes with byte-identical original source', async () => {
    // Write original, patch it with identical content
    const file = path.join(sourceRoot, 'identical.txt');
    await fs.writeFile(file, 'original');
    const manifestPath = await createManifest('identical.json', {
      scope: { readPaths: ['identical.txt'], writePaths: ['identical.txt'], createPaths: [] },
      checks: [{ type: 'contains', path: 'identical.txt', text: 'original' }],
      _fakeSteps: [
        { name: 'propose_patch', args: { path: 'identical.txt', expectedSha256: sha256('original'), content: 'original' } },
        { name: 'submit_receipt', args: { summary: 'Done' } }
      ]
    });

    const res = await runCli(manifestPath);
    const receipt = JSON.parse(res.stdout);
    assert.equal(receipt.state, 'failed');
    assert.equal(receipt.sourceUnchanged, true);

    const current = await fs.readFile(file, 'utf8');
    assert.equal(current, 'original');
  });

  // AGR-3: The worker cannot patch a path declared read-only (not in writePaths)
  test('Worker cannot patch a path declared read-only', async () => {
    const file = path.join(sourceRoot, 'readonly.txt');
    await fs.writeFile(file, 'original');
    const manifestPath = await createManifest('readonly.json', {
      scope: { readPaths: ['readonly.txt'], writePaths: [], createPaths: [] },
      checks: [{ type: 'contains', path: 'readonly.txt', text: 'patched' }],
      _fakeSteps: [
        { name: 'propose_patch', args: { path: 'readonly.txt', expectedSha256: sha256('original'), content: 'patched' } },
        { name: 'submit_receipt', args: { summary: 'Done' } }
      ]
    });

    const res = await runCli(manifestPath);
    const receipt = JSON.parse(res.stdout);
    assert.equal(receipt.sourceUnchanged, true);
    assert.equal(receipt.state, 'failed'); // Cannot succeed because check fails (patch should be rejected)
  });

  // AGR-3: An irrelevant patch, or a no-op patch, cannot yield review_ready just because unrelated checks already pass
  test('Irrelevant patch cannot yield review_ready if checks unrelated', async () => {
    await fs.writeFile(path.join(sourceRoot, 'passing.txt'), 'ok');
    await fs.writeFile(path.join(sourceRoot, 'target.txt'), 'original');

    const manifestPath = await createManifest('irrelevant.json', {
      scope: { readPaths: ['passing.txt'], writePaths: ['target.txt'], createPaths: [] },
      checks: [{ type: 'contains', path: 'passing.txt', text: 'ok' }],
      _fakeSteps: [
        { name: 'propose_patch', args: { path: 'target.txt', expectedSha256: sha256('original'), content: 'patched' } },
        { name: 'submit_receipt', args: { summary: 'Done' } }
      ]
    });

    const res = await runCli(manifestPath);
    const receipt = JSON.parse(res.stdout);
    assert.equal(receipt.sourceUnchanged, true);
    assert.notEqual(receipt.state, 'review_ready');
  });

  // AGR-3: Verify original source bytes remain identical on each failure
  test('Verify original source bytes remain identical on each failure', async () => {
    const file = path.join(sourceRoot, 'fail1.txt');
    await fs.writeFile(file, 'original');
    const manifestPath = await createManifest('fail1.json', {
      scope: { readPaths: ['fail1.txt'], writePaths: ['fail1.txt'], createPaths: [] },
      checks: [{ type: 'contains', path: 'fail1.txt', text: 'wrong' }],
      _fakeSteps: [
        { name: 'propose_patch', args: { path: 'fail1.txt', expectedSha256: sha256('original'), content: 'bad_patch' } },
        { name: 'submit_receipt', args: { summary: 'Done' } }
      ]
    });

    const res = await runCli(manifestPath);
    const receipt = JSON.parse(res.stdout);
    assert.equal(receipt.state, 'failed');
    assert.equal(receipt.sourceUnchanged, true);
    const current = await fs.readFile(file, 'utf8');
    assert.equal(current, 'original');
  });

});
