import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, symlink, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { admitAssignment } from '../src/admission.js';

const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

let tmpDir;
let fixtureDir;

before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rct-admission-test-'));
  fixtureDir = path.join(tmpDir, 'fixtures');
  await mkdir(fixtureDir, { recursive: true });
  // Create a source root with a sample file
  const srcRoot = path.join(tmpDir, 'source', 'src');
  await mkdir(srcRoot, { recursive: true });
  await writeFile(path.join(srcRoot, 'main.js'), 'console.log("hello");\n');
  await writeFile(path.join(srcRoot, 'util.js'), 'export const add = (a,b) => a+b;\n');
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function validManifest(overrides = {}) {
  return {
    schemaVersion: 'rct.assignment.v1',
    taskId: 'test-task-001',
    objective: 'Add a greeting function to main.js',
    acceptance: ['main.js contains the greeting function'],
    source: { root: path.join(tmpDir, 'source') },
    scope: {
      readPaths: ['src/main.js', 'src/util.js'],
      writePaths: ['src/main.js'],
      createPaths: []
    },
    dataPolicy: {
      classification: 'public',
      allowRemoteInference: true,
      provider: 'groq',
      model: 'openai/gpt-oss-120b'
    },
    checks: [
      { type: 'contains', path: 'src/main.js', text: 'greeting' }
    ],
    budget: {
      maxTurns: 6,
      maxInputTokens: 6000,
      maxOutputTokens: 3000,
      maxPromptChars: 16000,
      maxReadBytes: 8192,
      maxWriteBytes: 8192,
      maxWallMs: 30000
    },
    ...overrides
  };
}

async function writeAndAdmit(name, manifest) {
  const fpath = path.join(fixtureDir, name + '.json');
  await writeFile(fpath, JSON.stringify(manifest));
  return admitAssignment(fpath);
}

// ==================== POSITIVE TESTS ====================

describe('Admission — positive', () => {
  it('accepts a valid manifest with full plan output', async () => {
    const result = await writeAndAdmit('valid', validManifest());
    assert.equal(result.accepted, true);
    assert.equal(result.schemaVersion, 'rct.assignment.v1');
    assert.equal(result.taskId, 'test-task-001');
    assert.ok(result.manifestHash);
    assert.equal(result.dryRun, true);
    assert.equal(result.networkCallsMade, 0);
    assert.equal(result.sourceEdited, false);
    assert.deepStrictEqual(result.scope.readPaths, ['src/main.js', 'src/util.js']);
    assert.deepStrictEqual(result.scope.writePaths, ['src/main.js']);
    assert.deepStrictEqual(result.scope.createPaths, []);
    assert.equal(result.dataPolicy.classification, 'public');
    assert.equal(result.dataPolicy.remoteInferencePermitted, true);
    assert.ok(result.budget.maxTurns > 0);
    assert.ok(result.estimatedResourceCeilings.maxModelTurns > 0);
  });

  it('accepts internal classification with explicit allowRemoteInference false', async () => {
    const result = await writeAndAdmit('internal-no-remote', validManifest({
      dataPolicy: { classification: 'internal', allowRemoteInference: false }
    }));
    assert.equal(result.accepted, true);
    assert.equal(result.dataPolicy.remoteInferencePermitted, false);
  });

  it('accepts with createPaths', async () => {
    const result = await writeAndAdmit('with-create', validManifest({
      scope: {
        readPaths: ['src/main.js'],
        writePaths: ['src/main.js'],
        createPaths: ['src/new-file.js']
      },
      checks: [{ type: 'contains', path: 'src/main.js', text: 'greeting' }]
    }));
    assert.equal(result.accepted, true);
    assert.deepStrictEqual(result.scope.createPaths, ['src/new-file.js']);
  });

  it('accepts with default budget', async () => {
    const m = validManifest();
    delete m.budget;
    const result = await writeAndAdmit('default-budget', m);
    assert.equal(result.accepted, true);
    assert.equal(result.budget.maxTurns, 6);
  });
});

// ==================== ADVERSARIAL REJECTION TESTS ====================

describe('Admission — rejections', () => {
  it('rejects wrong schemaVersion', async () => {
    const result = await writeAndAdmit('bad-schema', validManifest({ schemaVersion: 'rct.assignment.v2' }));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('schemaVersion'));
  });

  it('rejects missing schemaVersion', async () => {
    const m = validManifest();
    delete m.schemaVersion;
    const result = await writeAndAdmit('no-schema', m);
    assert.equal(result.accepted, false);
  });

  it('rejects invalid taskId', async () => {
    const result = await writeAndAdmit('bad-taskid', validManifest({ taskId: '../escape' }));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('taskId'));
  });

  it('rejects traversal in readPaths (..)', async () => {
    const result = await writeAndAdmit('traversal-read', validManifest({
      scope: { readPaths: ['../etc/passwd'], writePaths: ['src/main.js'], createPaths: [] }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.pathErrors?.some(e => e.reason.includes('traversal')));
  });

  it('rejects hidden paths (.secret)', async () => {
    const result = await writeAndAdmit('hidden', validManifest({
      scope: { readPaths: ['.secret/key'], writePaths: ['src/main.js'], createPaths: [] }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.pathErrors?.some(e => e.reason.includes('hidden')));
  });

  it('rejects backslash paths', async () => {
    const result = await writeAndAdmit('backslash', validManifest({
      scope: { readPaths: ['src\\main.js'], writePaths: ['src/main.js'], createPaths: [] }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.pathErrors?.some(e => e.reason.includes('backslash')));
  });

  it('rejects absolute paths in scope', async () => {
    const result = await writeAndAdmit('abs-path', validManifest({
      scope: { readPaths: ['/etc/passwd'], writePaths: ['src/main.js'], createPaths: [] }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.pathErrors?.some(e => e.reason.includes('absolute')));
  });

  it('rejects missing checks', async () => {
    const result = await writeAndAdmit('no-checks', validManifest({ checks: [] }));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('check'));
  });

  it('rejects unsupported check profile', async () => {
    const result = await writeAndAdmit('bad-check', validManifest({
      checks: [{ type: 'regex', path: 'src/main.js', text: '.*' }]
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('Unsupported check profile'));
  });

  it('rejects check path outside scope', async () => {
    const result = await writeAndAdmit('scope-mismatch', validManifest({
      checks: [{ type: 'equals', path: 'src/other.js', text: 'x' }]
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('outside declared scope'));
  });

  it('rejects sensitive + remote inference', async () => {
    const result = await writeAndAdmit('sensitive-remote', validManifest({
      dataPolicy: { classification: 'sensitive', allowRemoteInference: true }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('not permitted'));
  });

  it('rejects internal classification without explicit allowRemoteInference', async () => {
    const result = await writeAndAdmit('internal-ambiguous', validManifest({
      dataPolicy: { classification: 'internal' }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('explicit allowRemoteInference'));
  });

  it('rejects filesystem root as source.root', async () => {
    const result = await writeAndAdmit('fs-root', validManifest({
      source: { root: path.parse(tmpDir).root }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('filesystem root'));
  });

  it('rejects a nonexistent source.root', async () => {
    const result = await writeAndAdmit('missing-root', validManifest({
      source: { root: path.join(tmpDir, 'missing-source') }
    }));
    assert.equal(result.accepted, false);
    assert.match(result.reason, /source.root is not accessible/);
  });

  it('rejects a nonexistent readPath', async () => {
    const result = await writeAndAdmit('missing-read', validManifest({
      scope: { readPaths: ['src/missing.js'], writePaths: ['src/main.js'] }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.scopeErrors?.some(e => e.path === 'src/missing.js' && e.reason.includes('does not exist')));
  });

  it('rejects a nonexistent writePath unless declared as createPath', async () => {
    const result = await writeAndAdmit('missing-write', validManifest({
      scope: { readPaths: ['src/main.js'], writePaths: ['src/missing.js'] }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.scopeErrors?.some(e => e.path === 'src/missing.js' && e.reason.includes('does not exist')));
  });

  it('rejects invalid budget values', async () => {
    const result = await writeAndAdmit('bad-budget', validManifest({
      budget: { maxTurns: 0 }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('budget'));
  });

  it('rejects non-JSON file', async () => {
    const fpath = path.join(fixtureDir, 'not-json.txt');
    await writeFile(fpath, 'this is not json');
    const result = await admitAssignment(fpath);
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('not valid JSON'));
  });

  it('rejects missing file', async () => {
    const result = await admitAssignment(path.join(fixtureDir, 'nonexistent.json'));
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('Cannot read'));
  });

  it('rejects null byte in path', async () => {
    const result = await writeAndAdmit('null-byte', validManifest({
      scope: { readPaths: ['src/main\0.js'], writePaths: ['src/main.js'], createPaths: [] }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.pathErrors?.some(e => e.reason.includes('null byte')));
  });

  it('rejects colon in path segment', async () => {
    const result = await writeAndAdmit('colon', validManifest({
      scope: { readPaths: ['src:alt/main.js'], writePaths: ['src/main.js'], createPaths: [] }
    }));
    assert.equal(result.accepted, false);
    assert.ok(result.pathErrors?.some(e => e.reason.includes('colon')));
  });
});

// ==================== SYMLINK ESCAPE TEST ====================

describe('Admission — symlink escape', () => {
  it('rejects symlink in writePaths', async () => {
    const linkSource = path.join(tmpDir, 'source', 'src');
    const linkDir = path.join(linkSource, 'linked');
    try {
      await symlink(os.tmpdir(), linkDir, 'junction');
      const result = await writeAndAdmit('symlink-escape', validManifest({
        scope: {
          readPaths: ['src/main.js'],
          writePaths: ['src/linked/escape.txt'],
          createPaths: []
        },
        checks: [{ type: 'contains', path: 'src/main.js', text: 'greeting' }]
      }));
      assert.equal(result.accepted, false);
      assert.ok(result.scopeErrors?.some(e => e.path === 'src/linked/escape.txt' && /symlink|junction/.test(e.reason)));
    } finally {
      await rm(linkDir, { force: true });
    }
  });

  it('rejects symlink in readPaths', async () => {
    const linkDir = path.join(tmpDir, 'source', 'src', 'read-linked');
    try {
      await symlink(os.tmpdir(), linkDir, 'junction');
      const result = await writeAndAdmit('read-symlink-escape', validManifest({
        scope: { readPaths: ['src/read-linked/secret.txt'], writePaths: ['src/main.js'] }
      }));
      assert.equal(result.accepted, false);
      assert.ok(result.scopeErrors?.some(e => e.path === 'src/read-linked/secret.txt' && /symlink|junction/.test(e.reason)));
    } finally {
      await rm(linkDir, { force: true });
    }
  });

  it('rejects symlink in createPaths', async () => {
    const linkDir = path.join(tmpDir, 'source', 'src', 'create-linked');
    try {
      await symlink(os.tmpdir(), linkDir, 'junction');
      const result = await writeAndAdmit('create-symlink-escape', validManifest({
        scope: { readPaths: ['src/main.js'], writePaths: [], createPaths: ['src/create-linked/new.js'] }
      }));
      assert.equal(result.accepted, false);
      assert.ok(result.scopeErrors?.some(e => e.path === 'src/create-linked/new.js' && /symlink|junction/.test(e.reason)));
    } finally {
      await rm(linkDir, { force: true });
    }
  });
});

// ==================== CLI INTEGRATION TEST ====================

describe('CLI plan command', () => {
  it('emits bounded JSON for valid manifest via CLI', async () => {
    const fpath = path.join(fixtureDir, 'cli-valid.json');
    await writeFile(fpath, JSON.stringify(validManifest()));
    const { stdout } = await exec(process.execPath, [cliPath, 'plan', fpath]);
    const result = JSON.parse(stdout);
    assert.equal(result.accepted, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.networkCallsMade, 0);
    assert.equal(result.sourceEdited, false);
    assert.strictEqual(result._rawManifest, undefined, '_rawManifest should not be serialized');
  });

  it('exits non-zero for rejected manifest via CLI', async () => {
    const fpath = path.join(fixtureDir, 'cli-bad.json');
    await writeFile(fpath, JSON.stringify(validManifest({ schemaVersion: 'wrong' })));
    try {
      await exec(process.execPath, [cliPath, 'plan', fpath]);
      assert.fail('Should have exited non-zero');
    } catch (err) {
      assert.ok(err.code !== 0);
      const result = JSON.parse(err.stdout);
      assert.equal(result.accepted, false);
    }
  });
});
