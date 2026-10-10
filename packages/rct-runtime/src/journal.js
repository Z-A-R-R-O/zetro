import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export class RctJournal {
  constructor(file) {
    if (!path.isAbsolute(file)) throw new Error('Journal path must be absolute');
    this.file = file;
  }

  async append(event) {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify({ version: 1, at: new Date().toISOString(), ...event }) + '\n', { encoding: 'utf8', mode: 0o600 });
  }
}
