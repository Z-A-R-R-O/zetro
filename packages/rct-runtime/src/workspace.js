import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function cleanRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) throw new Error('Invalid relative path');
  const segments = value.split('/');
  if (path.posix.isAbsolute(value) || segments.some(x => !x || x === '.' || x === '..' || x.startsWith('.'))) throw new Error('Invalid relative path');
  if (segments.some(x => x.includes(':'))) throw new Error('Invalid relative path');
  return segments.join('/');
}

export class ScopedWorkspace {
  constructor(root, allowedPaths, limits = {}) {
    if (!path.isAbsolute(root)) throw new Error('Workspace root must be absolute');
    this.root = path.resolve(root);
    this.allowed = new Set(allowedPaths.map(cleanRelative));
    if (!this.allowed.size) throw new Error('At least one allowed file is required');
    this.maxReadBytes = limits.maxReadBytes ?? 8192;
    this.maxWriteBytes = limits.maxWriteBytes ?? 8192;
    this.readBytes = 0;
    this.searchBytes = 0;
    this.writeBytes = 0;
  }

  async resolveFile(relative) {
    const name = cleanRelative(relative);
    if (!this.allowed.has(name)) throw new Error('Path outside assignment scope');
    const rootReal = await realpath(this.root);
    let current = rootReal;
    for (const segment of name.split('/')) {
      current = path.join(current, segment);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed');
    }
    const resolved = await realpath(current);
    if (!resolved.startsWith(rootReal + path.sep)) throw new Error('Path escaped workspace');
    const stat = await lstat(resolved);
    if (!stat.isFile()) throw new Error('Only regular files are allowed');
    return resolved;
  }

  async listPaths() {
    const found = [];
    for (const name of [...this.allowed].sort()) {
      try { await this.resolveFile(name); found.push(name); } catch { /* inaccessible files are not exposed */ }
    }
    return found;
  }

  async readSlice(relative, start = 0, length = 2048) {
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1 || length > 4096) throw new Error('Invalid slice');
    const file = await this.resolveFile(relative);
    const bytes = await readFile(file);
    if (bytes.length > 65536) throw new Error('File exceeds pilot size limit');
    const end = Math.min(bytes.length, start + length);
    const slice = bytes.subarray(start, end);
    if (this.readBytes + slice.length > this.maxReadBytes) throw new Error('Read budget exhausted');
    this.readBytes += slice.length;
    return { path: cleanRelative(relative), start, end, totalBytes: bytes.length, sha256: sha256(bytes), content: slice.toString('utf8') };
  }

  async search(term) {
    if (typeof term !== 'string' || term.length < 2 || term.length > 100) throw new Error('Invalid search term');
    const hits = [];
    for (const name of await this.listPaths()) {
      const file = await this.resolveFile(name);
      const bytes = await readFile(file);
      if (bytes.length > 65536) continue;
      if (this.searchBytes + bytes.length > this.maxReadBytes) throw new Error('Search budget exhausted');
      this.searchBytes += bytes.length;
      const content = bytes.toString('utf8');
      let from = 0;
      while (hits.length < 20) {
        const index = content.indexOf(term, from);
        if (index < 0) break;
        hits.push({ path: name, offset: index });
        from = index + term.length;
      }
      if (hits.length === 20) break;
    }
    return hits;
  }

  async proposePatch(relative, expectedSha256, content) {
    if (typeof content !== 'string' || typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid patch');
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > 65536 || this.writeBytes + bytes.length > this.maxWriteBytes) throw new Error('Write budget exhausted');
    const file = await this.resolveFile(relative);
    const before = await readFile(file);
    if (sha256(before) !== expectedSha256) throw new Error('Stale preimage');
    if (before.equals(bytes)) return { path: cleanRelative(relative), before: expectedSha256, after: expectedSha256, bytes: bytes.length, applied: false, reason: 'no_change' };
    // Recheck the path before writing. The pilot only runs in a private snapshot;
    // hostile concurrent filesystem mutation is not a supported security boundary.
    if (await this.resolveFile(relative) !== file) throw new Error('Path changed');
    await writeFile(file, bytes, { flag: 'w' });
    this.writeBytes += bytes.length;
    return { path: cleanRelative(relative), before: expectedSha256, after: sha256(bytes), bytes: bytes.length, applied: true };
  }
}
