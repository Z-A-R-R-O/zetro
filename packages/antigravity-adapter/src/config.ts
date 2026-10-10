import { readFile } from 'node:fs/promises';

export type AgentName = 'AGR-1' | 'AGR-2' | 'AGR-3' | 'AGR-4' | 'AGR-5';

export interface AgentConfig {
  schemaVersion: '1';
  projectId: string;
  workspace: string;
  agents: Record<AgentName, string>;
}

export const AGENT_NAMES: AgentName[] = ['AGR-1', 'AGR-2', 'AGR-3', 'AGR-4', 'AGR-5'];

export function isAgentName(value: string): value is AgentName {
  return AGENT_NAMES.includes(value as AgentName);
}

export async function loadConfig(): Promise<AgentConfig> {
  const raw = await readFile(new URL('../agents.json', import.meta.url), 'utf8');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid agents.json');
  const config = value as Partial<AgentConfig>;
  if (config.schemaVersion !== '1' || !config.projectId || !config.workspace || !config.agents) {
    throw new Error('agents.json is missing required fields');
  }
  const ids = new Set<string>();
  for (const name of AGENT_NAMES) {
    const id = config.agents[name];
    if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || ids.has(id)) {
      throw new Error(`Invalid or duplicate conversation ID for ${name}`);
    }
    ids.add(id);
  }
  return config as AgentConfig;
}
