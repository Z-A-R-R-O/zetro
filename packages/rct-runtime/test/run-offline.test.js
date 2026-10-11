import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../src/workspace.js';

const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

let tmpDir;
let fixtureDir;

before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rct-offline-test-'));
  fixtureDir = path.join(tmpDir, 'fixtures');
  await mkdir(fixtureDir, { recursive: true });
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function runCli(manifestPath) {
    try {
        const { stdout, stderr } = await exec(process.execPath, [cliPath, 'run-offline', manifestPath]);
        return { code: 0, stdout, stderr };
    } catch (e) {
        return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
}

test('run-offline offline success and source unchanged', async () => {
    const root = path.join(tmpDir, 'source-success');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-run-offline',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
        budget: { maxTurns: 10, maxWallMs: 60000 },
        _fakeSteps: [
            { name: 'read_slice', args: { path: 'src/greeting.txt' } },
            { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
            { name: 'submit_receipt', args: { summary: 'Done' } }
        ]
    };

    const manifestPath = path.join(fixtureDir, 'manifest1.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code, stdout } = await runCli(manifestPath);
    const result = JSON.parse(stdout);

    assert.equal(code, 0);
    assert.equal(result.state, 'review_ready');
    assert.equal(result.sourceUnchanged, true);

    // Verify source truly unchanged
    const sourceContent = await readFile(path.join(root, 'src', 'greeting.txt'), 'utf8');
    assert.equal(sourceContent, 'hello\n');
});

test('run-offline reject missing files before snapshot', async () => {
    const root = path.join(tmpDir, 'source-missing');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-run-offline-missing',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    };

    const manifestPath = path.join(fixtureDir, 'manifest2.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    await rm(path.join(root, 'src', 'greeting.txt'));

    const { code, stdout } = await runCli(manifestPath);
    const result = JSON.parse(stdout);

    assert.equal(code, 1);
    assert.equal(result.status, 'error');
    assert.ok(result.reason.includes('vanished') || result.reason.includes('Scope path'));
});

test('run-offline reject unsupported createPaths', async () => {
    const root = path.join(tmpDir, 'source-create');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-run-offline-create',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: ['src/newfile.txt']
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    };

    const manifestPath = path.join(fixtureDir, 'manifest4.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code, stdout } = await runCli(manifestPath);
    const result = JSON.parse(stdout);

    assert.equal(code, 1);
    assert.equal(result.status, 'error');
    assert.ok(result.reason.includes('createPaths are not safely executable'));
});

test('run-offline false worker completion yields failed state', async () => {
    const root = path.join(tmpDir, 'source-false-completion');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-false-completion',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
        _fakeSteps: [
            { name: 'submit_receipt', args: { summary: 'I did not actually patch anything' } }
        ]
    };

    const manifestPath = path.join(fixtureDir, 'manifest5.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code, stdout } = await runCli(manifestPath);
    const result = JSON.parse(stdout);

    assert.equal(code, 1);
    assert.equal(result.state, 'failed');
    assert.equal(result.sourceUnchanged, true);
});
