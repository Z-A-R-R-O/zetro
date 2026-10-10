import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class Journal {
  constructor(filepath) {
    this.filepath = filepath;
  }

  async init() {
    await mkdir(dirname(this.filepath), { recursive: true });
    try {
      const content = await readFile(this.filepath, 'utf8');
      return content.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return [];
    }
  }

  async append(event) {
    await appendFile(this.filepath, JSON.stringify({ ...event, timestamp: Date.now() }) + '\n');
  }
}
