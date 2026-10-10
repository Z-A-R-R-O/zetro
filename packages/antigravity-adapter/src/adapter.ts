import { fileURLToPath } from 'node:url';
import { normalize } from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AGENT_NAMES, type AgentConfig, type AgentName } from './config.js';
import { discoverEndpoints, type Endpoint } from './discovery.js';
import { resolveExecutable, runAgentApi, type AgentApiResponse } from './agentapi.js';

export interface VerifiedAgent {
  agent: AgentName;
  conversationId: string;
  projectId: string;
  workspace: string;
  connected: true;
  source: Endpoint['source'];
}

export interface AgentCheck {
  agent: AgentName;
  conversationId: string;
  connected: boolean;
  projectId?: string;
  workspace?: string;
  source?: Endpoint['source'];
  error?: string;
}

export interface AgentObservation extends AgentCheck {
  state: 'idle' | 'running' | 'unknown';
  stepCount: number;
  lastActivity?: string;
  confidence: 'diagnostic_fallback';
}

export interface SubmitResult {
  agent: AgentName;
  conversationId: string;
  delivery: 'submitted';
  verification: 'not_requested';
}

export interface AdapterDependencies {
  discover(): Promise<Endpoint[]>;
  executable(): Promise<string>;
  run(executable: string, endpoint: Endpoint, command: 'get-conversation-metadata' | 'send-message', args: string[]): Promise<AgentApiResponse>;
}

const defaultDependencies: AdapterDependencies = {
  discover: discoverEndpoints,
  executable: resolveExecutable,
  run: runAgentApi,
};

function sameWorkspace(actualUri: string, expectedPath: string): boolean {
  try {
    const actual = normalize(fileURLToPath(actualUri));
    const expected = normalize(expectedPath);
    return process.platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  } catch {
    return false;
  }
}

function readMetadata(response: AgentApiResponse): Record<string, unknown> {
  const outer = response.response;
  if (!outer || typeof outer !== 'object') throw new Error('Missing metadata response');
  const conversation = (outer as Record<string, unknown>).conversationMetadata;
  if (!conversation || typeof conversation !== 'object') throw new Error('Missing conversation metadata');
  const metadata = (conversation as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== 'object') throw new Error('Missing metadata body');
  return metadata as Record<string, unknown>;
}

// Cache valid endpoint discovery per process with safe invalidation
let cachedEndpoints: Endpoint[] | undefined;

export class AntigravityAdapter {
  constructor(private readonly config: AgentConfig, private readonly deps: AdapterDependencies = defaultDependencies) {}

  private async getEndpoints(): Promise<Endpoint[]> {
    if (cachedEndpoints) return cachedEndpoints;
    cachedEndpoints = await this.deps.discover();
    return cachedEndpoints;
  }

  private invalidateCache() {
    cachedEndpoints = undefined;
  }

  private async verifyOn(endpoint: Endpoint, executable: string, agent: AgentName): Promise<VerifiedAgent> {
    const conversationId = this.config.agents[agent];
    const raw = await this.deps.run(executable, endpoint, 'get-conversation-metadata', [conversationId]);
    const metadata = readMetadata(raw);
    if (metadata.rootConversationId !== conversationId) throw new Error('Root conversation ID mismatch');
    if (metadata.projectId !== this.config.projectId) throw new Error('Antigravity project ID mismatch');
    const workspaces = Array.isArray(metadata.workspaces) ? metadata.workspaces : [];
    const matched = workspaces.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const uri: unknown = (item as Record<string, unknown>).workspaceFolderAbsoluteUri;
      return typeof uri === 'string' && sameWorkspace(uri, this.config.workspace);
    });
    if (!matched) throw new Error('Antigravity workspace mismatch');
    return {
      agent,
      conversationId,
      projectId: this.config.projectId,
      workspace: this.config.workspace,
      connected: true,
      source: endpoint.source,
    };
  }

  private async findEndpoint(agent: AgentName): Promise<{ endpoint: Endpoint; executable: string; verified: VerifiedAgent }> {
    let endpoints = await this.getEndpoints();
    if (endpoints.length === 0) {
      this.invalidateCache();
      endpoints = await this.getEndpoints();
      if (endpoints.length === 0) throw new Error('No live Antigravity language server found');
    }

    const executable = await this.deps.executable();
    let lastError = 'No endpoint returned matching conversation metadata';

    for (const endpoint of endpoints) {
      try {
        const verified = await this.verifyOn(endpoint, executable, agent);
        return { endpoint, executable, verified };
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown connection error';
      }
    }

    // Invalidate cache and retry discovery
    this.invalidateCache();
    endpoints = await this.getEndpoints();
    if (endpoints.length === 0) throw new Error(lastError);

    for (const endpoint of endpoints) {
      try {
        const verified = await this.verifyOn(endpoint, executable, agent);
        return { endpoint, executable, verified };
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown connection error';
      }
    }

    throw new Error(lastError);
  }

  async verify(agent: AgentName): Promise<VerifiedAgent> {
    return (await this.findEndpoint(agent)).verified;
  }

  async verifyAll(): Promise<AgentCheck[]> {
    const results: AgentCheck[] = [];
    let endpoints: Endpoint[];
    let executable: string;
    try {
      endpoints = await this.getEndpoints();
      if (endpoints.length === 0) {
        this.invalidateCache();
        endpoints = await this.getEndpoints();
        if (endpoints.length === 0) throw new Error('No live Antigravity language server found');
      }
      executable = await this.deps.executable();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown connection error';
      return AGENT_NAMES.map((agent) => ({ agent, conversationId: this.config.agents[agent], connected: false, error: message }));
    }

    let preferred: Endpoint | undefined;
    for (const agent of AGENT_NAMES) {
      let verified: VerifiedAgent | undefined;
      let errorText = 'No endpoint returned matching conversation metadata';
      const candidates = preferred ? [preferred, ...endpoints.filter((item) => item !== preferred)] : endpoints;
      for (const endpoint of candidates) {
        try {
          verified = await this.verifyOn(endpoint, executable, agent);
          preferred = endpoint;
          break;
        } catch (error) {
          errorText = error instanceof Error ? error.message : 'Unknown connection error';
        }
      }
      if (!verified) {
        // Fallback: invalidate cache and retry for this agent if preferred failed
        this.invalidateCache();
        try {
          endpoints = await this.getEndpoints();
          for (const endpoint of endpoints) {
            try {
              verified = await this.verifyOn(endpoint, executable, agent);
              preferred = endpoint;
              break;
            } catch (err) {
              errorText = err instanceof Error ? err.message : 'Unknown connection error';
            }
          }
        } catch (err) {}
      }

      if (verified) results.push(verified);
      else {
        results.push({
          agent,
          conversationId: this.config.agents[agent],
          connected: false,
          error: errorText,
        });
      }
    }
    return results;
  }

  private async readDiagnosticFallback(conversationId: string): Promise<{ state: 'idle' | 'running' | 'unknown', stepCount: number, lastActivity?: string }> {
    try {
      // Use node:sqlite natively available in Node 22.5.0+ as a version-specific diagnostic fallback
      const { DatabaseSync } = await import('node:sqlite');
      const dbPath = path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const stmt = db.prepare('SELECT status, not_fully_idle, step_count, last_modified_time FROM conversation_summaries WHERE conversation_id = ?');
      const row = stmt.get(conversationId) as { status: string, not_fully_idle: number, step_count: number, last_modified_time: string } | undefined;
      db.close();

      if (!row) return { state: 'unknown', stepCount: 0 };
      const state = row.not_fully_idle ? 'running' : 'idle';
      return { state, stepCount: row.step_count || 0, lastActivity: row.last_modified_time };
    } catch {
      return { state: 'unknown', stepCount: 0 };
    }
  }

  /**
   * Observes the state of an agent by verifying its metadata identity and reading
   * diagnostic fallbacks (like local sqlite) for state/step count.
   * Returns explicit confidence levels since the agent API only gives identity verification.
   */
  async observe(agent: AgentName): Promise<AgentObservation> {
    try {
      const { verified } = await this.findEndpoint(agent);
      const diagnostic = await this.readDiagnosticFallback(verified.conversationId);
      return {
        ...verified,
        state: diagnostic.state,
        stepCount: diagnostic.stepCount,
        lastActivity: diagnostic.lastActivity,
        confidence: 'diagnostic_fallback'
      };
    } catch (error) {
      return {
        agent,
        conversationId: this.config.agents[agent],
        connected: false,
        state: 'unknown',
        stepCount: 0,
        confidence: 'diagnostic_fallback',
        error: error instanceof Error ? error.message : 'Unknown connection error'
      };
    }
  }

  async observeAll(): Promise<AgentObservation[]> {
    const checks = await this.verifyAll();
    return Promise.all(checks.map(async (check) => {
      const diagnostic = await this.readDiagnosticFallback(check.conversationId);
      return {
        ...check,
        state: diagnostic.state,
        stepCount: diagnostic.stepCount,
        lastActivity: diagnostic.lastActivity,
        confidence: 'diagnostic_fallback'
      };
    }));
  }

  async send(agent: AgentName, content: string): Promise<SubmitResult> {
    if (!content.trim()) throw new Error('Message content is empty');
    if (content.length > 100_000) throw new Error('Message exceeds 100,000 characters');
    const { endpoint, executable } = await this.findEndpoint(agent);
    
    try {
      const response = await this.deps.run(executable, endpoint, 'send-message', [this.config.agents[agent], content]);
      if (!response.response) throw new Error('Delivery unknown: no acknowledgement from Antigravity');
    } catch (error) {
      // Invalidate cache on failure just in case the endpoint died
      this.invalidateCache();
      throw error;
    }

    return {
      agent,
      conversationId: this.config.agents[agent],
      delivery: 'submitted',
      verification: 'not_requested',
    };
  }
}
