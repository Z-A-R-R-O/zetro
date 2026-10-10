#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { stdin, stdout, stderr } from 'node:process';
import { AntigravityAdapter } from './adapter.js';
import { isAgentName, loadConfig } from './config.js';

function usage(): string {
  return `ZETRO Antigravity adapter
Usage:
  zetro-ag verify [--json]
  zetro-ag status [--json]
  zetro-ag inspect AGR-1 [--json]
  zetro-ag observe AGR-1 [--json]
  zetro-ag send AGR-1 "message"
  zetro-ag send AGR-1 --stdin
  zetro-ag send AGR-1 --file <path>
  zetro-ag send AGR-1 "message" --dry-run

The adapter verifies conversation, project and workspace before sending.
Sending reports delivery acknowledgement, not task completion.`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    stdout.write(`${usage()}\n`);
    return 0;
  }
  const json = args.includes('--json');
  const dryRun = args.includes('--dry-run');
  const command = args[0];
  const config = await loadConfig();
  const adapter = new AntigravityAdapter(config);

  if (command === 'verify') {
    const results = await adapter.verifyAll();
    if (json) stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    else for (const result of results) stdout.write(`${result.agent}: ${result.connected ? 'CONNECTED' : `FAILED (${result.error})`}\n`);
    return results.every((result) => result.connected) ? 0 : 2;
  }

  if (command === 'status') {
    const results = await adapter.observeAll();
    if (json) stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    else for (const result of results) stdout.write(`${result.agent}: ${result.connected ? 'CONNECTED' : `FAILED (${result.error})`} - ${result.state} (${result.stepCount} steps)\n`);
    return results.every((result) => result.connected) ? 0 : 2;
  }

  const agent = args[1];
  if (!agent || !isAgentName(agent)) throw new Error('Expected one of AGR-1 through AGR-5');
  
  if (command === 'inspect') {
    const result = await adapter.verify(agent);
    if (json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else stdout.write(`${result.agent}: CONNECTED - ${result.conversationId} - ${result.workspace}\n`);
    return 0;
  }

  if (command === 'observe') {
    const result = await adapter.observe(agent);
    if (json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else stdout.write(`${result.agent}: ${result.connected ? 'CONNECTED' : 'FAILED'} - ${result.state} (${result.stepCount} steps)\n`);
    return 0;
  }

  if (command === 'send') {
    let content: string;
    if (args.includes('--stdin')) content = await readStdin();
    else if (args.includes('--file')) {
      const index = args.indexOf('--file');
      const file = args[index + 1];
      if (!file) throw new Error('--file requires a path');
      content = await readFile(file, 'utf8');
    } else {
      content = args.slice(2).filter((part) => !part.startsWith('--')).join(' ');
    }
    if (dryRun) {
      const result = await adapter.verify(agent);
      stdout.write(`${JSON.stringify({ ...result, delivery: 'not_attempted', messageLength: content.length }, null, 2)}\n`);
      return 0;
    }
    const result = await adapter.send(agent, content);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  stderr.write(`zetro-ag: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
  process.exitCode = 1;
});
