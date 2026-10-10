const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class BudgetExceededError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'BudgetExceededError';
    this.details = details;
  }
}

function deterministicStringify(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(v => deterministicStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => `${JSON.stringify(k)}:${deterministicStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

function computeHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

class ContextEngine {
  constructor(storageDir, maxBudget) {
    this.storageDir = storageDir;
    this.maxBudget = maxBudget;
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
  }

  createPacket(data) {
    const { objective, acceptanceCriteria, permissions, blockers, context = {} } = data;

    if (objective === undefined || acceptanceCriteria === undefined || permissions === undefined || blockers === undefined) {
      throw new Error('Missing required fields: objective, acceptanceCriteria, permissions, or blockers');
    }

    const requiredData = { objective, acceptanceCriteria, permissions, blockers };
    const requiredJson = deterministicStringify(requiredData);

    if (requiredJson.length > this.maxBudget) {
      throw new BudgetExceededError('Required fields exceed max budget', {
        requiredLength: requiredJson.length,
        budget: this.maxBudget
      });
    }

    const processedContext = {};

    for (const [key, value] of Object.entries(context)) {
      // Always stringify to preserve exact type upon parsing
      const valStr = JSON.stringify(value);
      const valHash = computeHash(valStr);
      
      const storagePath = path.join(this.storageDir, valHash);
      const existsOnDisk = fs.existsSync(storagePath);

      if (!existsOnDisk) {
        fs.writeFileSync(storagePath, valStr, 'utf8');
      }

      // If it exists on disk, it means we can deduplicate across ContextEngine instances
      if (existsOnDisk) {
        processedContext[key] = { $ref: valHash };
      } else {
        const testContext = { ...processedContext, [key]: value };
        const testObj = { ...requiredData, context: testContext };
        const testLen = deterministicStringify(testObj).length;

        if (testLen <= this.maxBudget) {
          processedContext[key] = value;
        } else {
          processedContext[key] = { $ref: valHash };
        }
      }
    }

    const packet = { ...requiredData, context: processedContext };
    const packetJson = deterministicStringify(packet);

    if (packetJson.length > this.maxBudget) {
       throw new BudgetExceededError('Packet exceeds budget even with refs', {
          packetLength: packetJson.length,
          budget: this.maxBudget
       });
    }

    return { packet, json: packetJson };
  }

  resolvePacket(packet) {
    const resolvedContext = {};
    const context = packet.context || {};
    
    for (const [key, value] of Object.entries(context)) {
      if (value && typeof value === 'object' && typeof value.$ref === 'string') {
        const ref = value.$ref;
        if (!/^[a-f0-9]{64}$/.test(ref)) {
          throw new Error('Invalid $ref format');
        }
        
        const storagePath = path.join(this.storageDir, ref);
        if (!fs.existsSync(storagePath)) {
          throw new Error('Artifact not found for $ref: ' + ref);
        }
        
        const content = fs.readFileSync(storagePath, 'utf8');
        const computed = computeHash(content);
        if (computed !== ref) {
          throw new Error('Integrity check failed: hash mismatch');
        }
        
        resolvedContext[key] = JSON.parse(content);
      } else {
        resolvedContext[key] = value;
      }
    }
    
    return { ...packet, context: resolvedContext };
  }
}

module.exports = { ContextEngine, BudgetExceededError, deterministicStringify };
