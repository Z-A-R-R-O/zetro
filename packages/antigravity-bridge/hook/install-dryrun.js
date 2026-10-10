#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function checkInstallation() {
  const workspaceRoot = path.resolve(__dirname, '../../../../..'); 
  const hooksDir = path.join(workspaceRoot, '.agents');
  const hooksPath = path.join(hooksDir, 'hooks.json');
  const hookCommand = `node ${path.resolve(__dirname, 'stop.js')}`;

  console.log(`[Dry-Run Validator] Workspace: ${workspaceRoot}`);
  console.log(`[Dry-Run Validator] Target config: ${hooksPath}`);
  
  const prospectiveStructure = {
    "zetro-bridge": {
      "Stop": [
        {
          "type": "command",
          "command": hookCommand,
          "timeout": 10
        }
      ]
    }
  };

  console.log(`[Dry-Run Validator] Prospective insertion: \n${JSON.stringify(prospectiveStructure, null, 2)}`);

  if (!fs.existsSync(hooksPath)) {
    console.log(`[Dry-Run Validator] Status: .agents/hooks.json does NOT exist.`);
    console.log(`[Dry-Run Validator] Action: Would create .agents/hooks.json with named map schema. No live config written.`);
    return;
  }

  try {
    const configRaw = fs.readFileSync(hooksPath, 'utf8');
    const config = JSON.parse(configRaw);
    
    const zetroBridge = config['zetro-bridge'];
    if (!zetroBridge || !zetroBridge.Stop || !Array.isArray(zetroBridge.Stop)) {
      console.log(`[Dry-Run Validator] Status: CLEAN INSERTION. No existing zetro-bridge Stop hooks found.`);
      return;
    }

    const existingStop = zetroBridge.Stop.find(h => h.type === 'command');
    if (existingStop) {
      if (existingStop.command === hookCommand) {
        console.log(`[Dry-Run Validator] Status: EXACT MATCH. Hook is already correctly installed in named map.`);
      } else {
        console.log(`[Dry-Run Validator] Status: CONFLICT DETECTED. Another Stop hook command exists: \n  ${existingStop.command}`);
      }
    } else {
      console.log(`[Dry-Run Validator] Status: CLEAN INSERTION. No existing Stop command hooks found.`);
    }
    console.log(`[Dry-Run Validator] Action: Validation complete. No live config written.`);
  } catch (err) {
    console.log(`[Dry-Run Validator] Status: ERROR reading existing hooks.json: ${err.message}`);
  }
}

checkInstallation();
