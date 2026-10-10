#!/usr/bin/env node
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { MCPBridge } = require('./index.js');

const storageDir = process.env.MCP_STORAGE_DIR 
  ? path.resolve(process.env.MCP_STORAGE_DIR)
  : path.resolve(__dirname, '../artifact-storage');

const maxOutputBudget = parseInt(process.env.MCP_MAX_BUDGET || '50000', 10);
if (!Number.isFinite(maxOutputBudget) || maxOutputBudget <= 0 || maxOutputBudget > 1000000) {
  throw new Error("Invalid or excessively large MCP_MAX_BUDGET");
}

const bridge = new MCPBridge(storageDir, maxOutputBudget);

const server = new Server({
  name: 'zetro-antigravity-bridge',
  version: '1.0.0'
}, {
  capabilities: { tools: {} }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetch_task',
        description: 'Fetch bounded task context for the worker. Treats capabilityDigest as an unguessable per-task bearer capability.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            capabilityDigest: { type: 'string' },
            sectionRef: { type: 'string' }
          },
          required: ['taskId', 'capabilityDigest']
        }
      },
      {
        name: 'submit_receipt',
        description: 'Submit an idempotent typed receipt. Replays are rejected.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            capabilityDigest: { type: 'string' },
            receipt: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['success', 'failure'] },
                agent: { type: 'string' },
                paths: { type: 'array', items: { type: 'string' } }
              },
              required: ['status', 'agent']
            }
          },
          required: ['taskId', 'capabilityDigest', 'receipt']
        }
      }
    ]
  };
});

const { performance } = require('perf_hooks');
const diagLogPath = process.env.ZETRO_MCP_DIAG_LOG || null;

function logDiag(entry) {
  if (!diagLogPath) return;
  try {
    const fs = require('fs');
    fs.appendFileSync(diagLogPath, JSON.stringify(entry) + '\n');
  } catch {}
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const entryMs = performance.now();
  const entryIso = new Date().toISOString();
  
  try {
    let result;
    if (name === 'fetch_task') {
      const { taskId, capabilityDigest, sectionRef } = args;
      const data = bridge.fetch_task(taskId, capabilityDigest, sectionRef);
      result = {
        content: [{ type: 'text', text: JSON.stringify(data) }]
      };
    } else if (name === 'submit_receipt') {
      const { taskId, capabilityDigest, receipt } = args;
      const ack = bridge.submit_receipt(taskId, capabilityDigest, receipt);
      result = {
        content: [{ type: 'text', text: JSON.stringify(ack) }]
      };
    } else {
      throw new Error('Unknown tool');
    }

    const exitMs = performance.now();
    logDiag({ tool: name, entryIso, exitIso: new Date().toISOString(), durationMs: Math.round((exitMs - entryMs) * 100) / 100, status: 'ok' });
    return result;
  } catch (err) {
    const exitMs = performance.now();
    logDiag({ tool: name, entryIso, exitIso: new Date().toISOString(), durationMs: Math.round((exitMs - entryMs) * 100) / 100, status: 'error', error: err.message });
    return {
      isError: true,
      content: [{ type: 'text', text: err.message }]
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { server, bridge };
