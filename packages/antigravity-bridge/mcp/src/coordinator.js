#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MCPBridge, hasSecretKeys } = require('./index.js');

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const defaultStorage = path.join(localAppData, 'Zetro', 'bridge', 'mcp');
const storageDir = process.env.MCP_STORAGE_DIR ? path.resolve(process.env.MCP_STORAGE_DIR) : defaultStorage;

const maxOutputBudget = parseInt(process.env.MCP_MAX_BUDGET || '50000', 10);
if (!Number.isFinite(maxOutputBudget) || maxOutputBudget <= 0 || maxOutputBudget > 1000000) {
  console.error("Invalid or excessively large MCP_MAX_BUDGET");
  process.exit(1);
}

const bridge = new MCPBridge(storageDir, maxOutputBudget);

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (key === 'allowedPaths') {
        parsed[key] = args[i + 1].split(',').map(s => path.resolve(s.trim()));
      } else {
        parsed[key] = args[i + 1];
      }
      i++;
    }
  }
  return parsed;
}

function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  if (hasSecretKeys(args)) {
    console.error(JSON.stringify({ error: 'Arguments contain secret-bearing keys or values' }));
    process.exit(1);
  }

  if (command === 'seed') {
    const { agent, objective, acceptanceCriteria, allowedPaths } = args;
    if (!agent || !objective || !acceptanceCriteria || !allowedPaths) {
      console.error(JSON.stringify({ error: 'Missing --agent, --objective, --acceptanceCriteria, --allowedPaths' }));
      process.exit(1);
    }

    for (const p of allowedPaths) {
      const root = path.parse(p).root;
      if (p === root || p.length <= 3) {
         console.error(JSON.stringify({ error: 'allowedPaths must be narrowed (not a filesystem root)' }));
         process.exit(1);
      }
    }

    const taskId = crypto.randomBytes(16).toString('hex');
    const capabilityDigest = crypto.randomBytes(32).toString('hex');

    const taskData = {
      taskId,
      agent,
      objective,
      acceptanceCriteria,
      allowedPaths,
      contextRefs: {},
      capabilityDigest
    };

    try {
      bridge._seedTask(taskData);
      console.log(JSON.stringify({
        dispatch: {
          taskId,
          capabilityDigest,
          agent
        }
      }));
      process.exit(0);
    } catch (err) {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    }

  } else if (command === 'inspect') {
    const { taskId, capabilityDigest } = args;
    if (!taskId || !capabilityDigest) {
      console.error(JSON.stringify({ error: 'Missing --taskId, --capabilityDigest' }));
      process.exit(1);
    }
    
    try {
      bridge.fetch_task(taskId, capabilityDigest);
      
      const { receiptPath } = bridge._getSafePaths(taskId, capabilityDigest);
      
      if (fs.existsSync(receiptPath)) {
        const content = fs.readFileSync(receiptPath, 'utf8');
        console.log(JSON.stringify({ receipt: JSON.parse(content) }));
        process.exit(0);
      } else {
        console.error(JSON.stringify({ error: 'Receipt not found' }));
        process.exit(1);
      }
    } catch (err) {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    }
  } else {
    console.error(JSON.stringify({ error: 'Unknown command: use seed or inspect' }));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
