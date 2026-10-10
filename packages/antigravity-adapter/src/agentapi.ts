import { execFile as execFileCallback } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Endpoint } from './discovery.js';

const execFile = promisify(execFileCallback);

export interface AgentApiResponse {
  response?: unknown;
  error?: unknown;
}

export async function resolveExecutable(): Promise<string> {
  const local = process.env.LOCALAPPDATA;
  const path = process.env.ZETRO_ANTIGRAVITY_EXECUTABLE ||
    (local ? join(local, 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe') : '');
  if (!path) throw new Error('Antigravity executable location is unavailable');
  const info = await stat(path);
  if (!info.isFile()) throw new Error('Antigravity executable is not a file');
  return path;
}

export async function runAgentApi(
  executable: string,
  endpoint: Endpoint,
  command: 'get-conversation-metadata' | 'send-message',
  args: string[],
): Promise<AgentApiResponse> {
  let stdout: string;
  try {
    const result = await execFile(executable, ['agentapi', command, ...args], {
      env: {
        ...process.env,
        ANTIGRAVITY_LS_ADDRESS: endpoint.address,
        ANTIGRAVITY_CSRF_TOKEN: endpoint.csrfToken,
      },
      timeout: command === 'send-message' ? 20000 : 7000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
  } catch {
    // A send may have reached Antigravity before the process failed. Do not retry.
    throw new Error(command === 'send-message' ? 'Delivery unknown: agentapi failed after send attempt' : 'Metadata request failed');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(command === 'send-message' ? 'Delivery unknown: agentapi returned invalid JSON' : 'Metadata response was not JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid agentapi response');
  const value = parsed as AgentApiResponse;
  if (value.error) throw new Error(command === 'send-message' ? 'Delivery unknown: Antigravity reported an error' : 'Antigravity rejected metadata request');
  return value;
}
