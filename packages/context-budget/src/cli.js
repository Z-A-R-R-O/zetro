#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ContextEngine, BudgetExceededError, deterministicStringify } = require('./index.js');

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      parsed[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  if (command === 'pack') {
    const { input, store, budget } = args;
    if (!input || !store || !budget) {
      console.error(JSON.stringify({ error: 'Missing required arguments: --input, --store, --budget', code: 'INVALID_ARGS' }));
      process.exit(1);
    }

    const budgetNum = Number(budget);
    if (!Number.isInteger(budgetNum) || budgetNum <= 0) {
      console.error(JSON.stringify({ error: 'Budget must be a finite positive integer', code: 'INVALID_ARGS' }));
      process.exit(1);
    }

    try {
      const inputContent = fs.readFileSync(input, 'utf8');
      const data = JSON.parse(inputContent);
      const originalChars = deterministicStringify(data).length;

      const engine = new ContextEngine(store, budgetNum);
      const { packet, json } = engine.createPacket(data);
      const packetChars = json.length;

      console.log(JSON.stringify({
        packet,
        metrics: {
          originalChars,
          packetChars,
          savedChars: originalChars - packetChars
        }
      }));
      process.exit(0);
    } catch (err) {
      console.error(JSON.stringify({ 
        error: err.message, 
        code: err.name === 'BudgetExceededError' ? 'BUDGET_EXCEEDED' : 'PACK_ERROR' 
      }));
      process.exit(1);
    }
  } else if (command === 'resolve') {
    const { packet: packetFile, store } = args;
    if (!packetFile || !store) {
      console.error(JSON.stringify({ error: 'Missing required arguments: --packet, --store', code: 'INVALID_ARGS' }));
      process.exit(1);
    }

    try {
      const packetContent = fs.readFileSync(packetFile, 'utf8');
      const packetData = JSON.parse(packetContent);

      const engine = new ContextEngine(store, Number.MAX_SAFE_INTEGER);
      const resolved = engine.resolvePacket(packetData);

      console.log(JSON.stringify({ resolved }));
      process.exit(0);
    } catch (err) {
      console.error(JSON.stringify({ error: err.message, code: 'RESOLVE_ERROR' }));
      process.exit(1);
    }
  } else {
    console.error(JSON.stringify({ error: 'Unknown command: use pack or resolve', code: 'UNKNOWN_COMMAND' }));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
