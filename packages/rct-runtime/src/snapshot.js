import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ScopedWorkspace, cleanRelative, sha256 } from './workspace.js';

export async function createSnapshot(sourceRoot, allowedPaths) {
  if (!path.isAbsolute(sourceRoot)) throw new Error('Source root must be absolute');
  if (!Array.isArray(allowedPaths) || allowedPaths.length < 1 || allowedPaths.length > 20) throw new Error('Invalid snapshot file list');
  const files = [...new Set(allowedPaths.map(cleanRelative))];
  const source = new ScopedWorkspace(sourceRoot, files);
  const root = await mkdtemp(path.join(os.tmpdir(), 'zetro-rct-snapshot-'));
  const sourceHashes = {};
  let total = 0;
  try {
    for (const relative of files) {
      const original = await source.resolveFile(relative);
      const bytes = await readFile(original);
      if (bytes.length > 65536 || total + bytes.length > 131072) throw new Error('Snapshot byte limit exceeded');
      total += bytes.length;
      sourceHashes[relative] = sha256(bytes);
      const destination = path.join(root, ...relative.split('/'));
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    }
    return {
      root,
      files,
      sourceHashes,
      async sourceUnchanged() {
        for (const relative of files) {
          const original = await source.resolveFile(relative);
          if (sha256(await readFile(original)) !== sourceHashes[relative]) return false;
        }
        return true;
      },
      async dispose() { await rm(root, { recursive: true, force: true }); }
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
