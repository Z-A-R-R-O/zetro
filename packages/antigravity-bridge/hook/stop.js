#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const crypto = require('node:crypto');

const VALID_DECISION = JSON.stringify({ decision: 'allow' });

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  try {
    const input = await readStdin();
    if (!input.trim()) {
      process.stdout.write(VALID_DECISION);
      return;
    }

    const payload = JSON.parse(input);
    const { conversationId, fullyIdle, terminationReason, executionNum } = payload;
    
    if (!conversationId) {
      process.stdout.write(VALID_DECISION);
      return;
    }

    if (typeof fullyIdle !== 'boolean') throw new Error('fullyIdle must be boolean');
    if (!Number.isInteger(executionNum)) throw new Error('executionNum must be integer');

    const configPath = process.env.ZETRO_AGENTS_CONFIG || path.resolve(__dirname, '../../antigravity-adapter/agents.json');
    
    let agr1Id;
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      agr1Id = config.agents && config.agents['AGR-1'];
    } catch (e) {}

    if (!agr1Id || conversationId !== agr1Id) {
      process.stdout.write(VALID_DECISION);
      return;
    }

    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || process.env.HOME || '', 'AppData', 'Local');
    const dataDir = process.env.ZETRO_DATA_DIR || path.join(localAppData, 'Zetro', 'bridge');

    fs.mkdirSync(dataDir, { recursive: true });

    const journalPath = path.join(dataDir, 'journal.jsonl');
    const eventId = `stop-${crypto.randomUUID()}`;
    
    const event = {
      eventId,
      timestamp: new Date().toISOString(),
      conversationId,
      taskId: null,
      fullyIdle,
      terminationReason: terminationReason || 'unknown',
      executionNum,
      note: 'Stop event is execution loop termination only, not verified task completion'
    };

    fs.appendFileSync(journalPath, JSON.stringify(event) + '\n');
    process.stdout.write(VALID_DECISION);
  } catch (err) {
    process.stderr.write(`Stop hook error: ${err.message.substring(0, 200)}\n`);
    process.stdout.write(VALID_DECISION);
  }
}

main();
