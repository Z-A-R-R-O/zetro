const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function hasSecretKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.some(hasSecretKeys);
  } else if (obj !== null && typeof obj === 'object') {
    const keys = Object.keys(obj);
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (lower.includes('secret') || lower.includes('password') || lower.includes('token') || lower.includes('apikey')) {
        return true;
      }
      if (hasSecretKeys(obj[key])) return true;
    }
  }
  return false;
}

function isPathWithin(target, root) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(root, target); 
  return normalizedTarget.startsWith(normalizedRoot + path.sep) || normalizedTarget === normalizedRoot;
}

class MCPBridge {
  constructor(storageDir, maxOutputBudget) {
    this.storageDir = storageDir;
    this.maxOutputBudget = maxOutputBudget;
    
    this.tasksDir = path.join(storageDir, 'tasks');
    this.receiptsDir = path.join(storageDir, 'receipts');
    
    if (!fs.existsSync(this.tasksDir)) fs.mkdirSync(this.tasksDir, { recursive: true });
    if (!fs.existsSync(this.receiptsDir)) fs.mkdirSync(this.receiptsDir, { recursive: true });
  }

  _seedTask(taskData) {
    const required = ['taskId', 'agent', 'allowedPaths', 'objective', 'acceptanceCriteria', 'contextRefs', 'capabilityDigest'];
    for (const req of required) {
      if (!(req in taskData)) throw new Error(`Missing required schema field: ${req}`);
    }

    if (hasSecretKeys(taskData)) {
      throw new Error('Payload contains secret-bearing keys');
    }

    const safeTaskId = crypto.createHash('sha256').update(taskData.taskId).digest('hex').slice(0, 16);
    const safeCap = crypto.createHash('sha256').update(taskData.capabilityDigest).digest('hex').slice(0, 16);
    
    const taskPath = path.join(this.tasksDir, `${safeTaskId}_${safeCap}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(taskData));
  }

  _getSafePaths(taskId, capabilityDigest) {
    const safeTaskId = crypto.createHash('sha256').update(taskId).digest('hex').slice(0, 16);
    const safeCap = crypto.createHash('sha256').update(capabilityDigest).digest('hex').slice(0, 16);
    const taskPath = path.join(this.tasksDir, `${safeTaskId}_${safeCap}.json`);
    const receiptPath = path.join(this.receiptsDir, `${safeTaskId}_${safeCap}.json`);
    return { taskPath, receiptPath };
  }

  fetch_task(taskId, capabilityDigest, sectionRef = null) {
    const { taskPath } = this._getSafePaths(taskId, capabilityDigest);
    
    if (!fs.existsSync(taskPath)) {
      throw new Error(`Task not found or capability mismatch`);
    }

    const taskContent = fs.readFileSync(taskPath, 'utf8');
    const safeTask = JSON.parse(taskContent);

    let outObj;
    if (sectionRef) {
      if (!safeTask.contextRefs || !(sectionRef in safeTask.contextRefs)) {
        throw new Error('Unknown sectionRef requested');
      }
      outObj = { sectionRef, data: safeTask.contextRefs[sectionRef] };
    } else {
       outObj = {
         taskId: safeTask.taskId,
         agent: safeTask.agent,
         allowedPaths: safeTask.allowedPaths,
         capabilityDigest: safeTask.capabilityDigest,
         objective: safeTask.objective,
         acceptanceCriteria: safeTask.acceptanceCriteria,
         availableRefs: safeTask.contextRefs ? Object.keys(safeTask.contextRefs) : []
       };
    }

    const outStr = JSON.stringify(outObj);
    if (outStr.length > this.maxOutputBudget) {
      throw new Error('Task output exceeds budget');
    }

    return outObj;
  }

  submit_receipt(taskId, capabilityDigest, receipt) {
    const { taskPath, receiptPath } = this._getSafePaths(taskId, capabilityDigest);

    if (!fs.existsSync(taskPath)) {
      throw new Error(`Task not found or capability mismatch`);
    }
    
    const taskContent = JSON.parse(fs.readFileSync(taskPath, 'utf8'));

    if (!receipt || typeof receipt !== 'object') {
      throw new Error('Invalid typed receipt: must be an object');
    }
    
    const validStatuses = ['success', 'failure'];
    if (!validStatuses.includes(receipt.status)) {
      throw new Error('Invalid typed receipt: missing or invalid status enum');
    }
    if (receipt.agent !== taskContent.agent || receipt.taskId !== taskContent.taskId) {
      throw new Error('Invalid typed receipt: spoofed agent or taskId mismatch');
    }

    if (receipt.paths) {
      const allowedPaths = taskContent.allowedPaths || [];
      const invalidPath = receipt.paths.find(p => {
        return !allowedPaths.some(root => isPathWithin(p, root));
      });
      if (invalidPath) {
        throw new Error('Invalid typed receipt: path not allowed or directory traversal detected');
      }
    }

    if (hasSecretKeys(receipt)) {
      throw new Error('Payload contains secret-bearing keys');
    }

    const receiptStr = JSON.stringify(receipt);
    const newDigest = computeHash(receipt);

    if (fs.existsSync(receiptPath)) {
      const existingReceiptStr = fs.readFileSync(receiptPath, 'utf8');
      const existingDigest = computeHash(JSON.parse(existingReceiptStr));
      if (existingDigest === newDigest) {
        return { success: true, idempotent: true, taskId };
      } else {
        throw new Error('Conflicting replay rejected');
      }
    }

    if (receiptStr.length > this.maxOutputBudget) {
      throw new Error('Receipt payload exceeds budget');
    }
    
    const ack = { success: true, taskId };
    const ackStr = JSON.stringify(ack);
    if (ackStr.length > this.maxOutputBudget) {
      throw new Error('Ack output exceeds budget');
    }

    const tmpPath = receiptPath + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    fs.writeFileSync(tmpPath, receiptStr);
    try {
      const fd = fs.openSync(receiptPath, 'wx');
      fs.writeSync(fd, receiptStr);
      fs.closeSync(fd);
    } catch (err) {
      if (err.code === 'EEXIST') {
        const existingReceiptStr = fs.readFileSync(receiptPath, 'utf8');
        const existingDigest = computeHash(JSON.parse(existingReceiptStr));
        if (existingDigest === newDigest) {
           return { success: true, idempotent: true, taskId };
        } else {
           throw new Error('Conflicting replay rejected concurrently');
        }
      }
      throw err;
    } finally {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    }
    
    return ack;
  }
}

module.exports = { MCPBridge, hasSecretKeys };
