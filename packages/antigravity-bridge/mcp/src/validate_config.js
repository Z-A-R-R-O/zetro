#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function validateConfig(configPath) {
  const configContent = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configContent);
  
  if (!config.mcpServers || !config.mcpServers.zetro) {
    throw new Error('Missing mcpServers.zetro section');
  }
  
  const zetro = config.mcpServers.zetro;
  if (zetro.command !== 'node') {
    throw new Error('Command must be node');
  }
  
  if (!Array.isArray(zetro.args) || zetro.args.length === 0) {
    throw new Error('Missing args containing absolute path to server.js');
  }
  
  const serverJsPath = zetro.args[0];
  if (!path.isAbsolute(serverJsPath)) {
    throw new Error('Path to server.js must be absolute');
  }
  
  if (!fs.existsSync(serverJsPath)) {
    throw new Error('server.js not found at specified path');
  }
  
  if (!zetro.env || !zetro.env.MCP_STORAGE_DIR) {
    throw new Error('Missing env.MCP_STORAGE_DIR');
  }
  
  if (!path.isAbsolute(zetro.env.MCP_STORAGE_DIR)) {
    throw new Error('MCP_STORAGE_DIR must be absolute after resolution: ' + zetro.env.MCP_STORAGE_DIR);
  }

  // Ensure it's not pointing inside the workspace to protect capabilities
  if (zetro.env.MCP_STORAGE_DIR.includes('Veyminore') || zetro.env.MCP_STORAGE_DIR.includes(process.cwd())) {
     throw new Error('MCP_STORAGE_DIR must not be inside the source tree to prevent leaking bearer capabilities.');
  }

  // Ensure config doesn't have literal secrets
  if (configContent.toLowerCase().includes('secret') || configContent.toLowerCase().includes('password') || configContent.toLowerCase().includes('token')) {
    throw new Error('Config contains sensitive data literals');
  }
  
  console.log('mcp_config is valid and safely configured for external storage.');
}

const configPath = process.argv[2] || path.join(__dirname, 'mcp_config_proposal.json');
validateConfig(configPath);
