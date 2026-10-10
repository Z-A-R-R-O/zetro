import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSnapshot, ScopedWorkspace, sha256 } from '../src/index.js';

async function sourceFixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rct-source-test-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('snapshot edits cannot modify the source', () => sourceFixture(async sourceRoot => {
  const snapshot = await createSnapshot(sourceRoot, ['src/greeting.txt']);
  try {
    const worker = new ScopedWorkspace(snapshot.root, snapshot.files);
    await worker.proposePatch('src/greeting.txt', sha256('hello\n'), 'hello world\n');
    assert.equal(await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8'), 'hello\n');
    assert.equal(await readFile(path.join(snapshot.root, 'src', 'greeting.txt'), 'utf8'), 'hello world\n');
    assert.equal(await snapshot.sourceUnchanged(), true);
  } finally {
    await snapshot.dispose();
  }
}));

test('snapshot refuses hidden paths and escape attempts', () => sourceFixture(async sourceRoot => {
  await assert.rejects(createSnapshot(sourceRoot, ['../outside.txt']));
  await assert.rejects(createSnapshot(sourceRoot, ['.env']));
}));

test('snapshot rejects symlinked source file', () => sourceFixture(async sourceRoot => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'rct-secret-test-'));
  try {
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    try {
      await symlink(path.join(outside, 'secret.txt'), path.join(sourceRoot, 'src', 'link.txt'), 'file');
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') return;
      throw error;
    }
    await assert.rejects(createSnapshot(sourceRoot, ['src/link.txt']));
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
}));
