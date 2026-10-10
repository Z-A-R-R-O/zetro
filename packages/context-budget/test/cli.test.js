const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

test('CLI tests', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-budget-cli-test-'));
  const cliPath = path.join(__dirname, '../src/cli.js');

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('pack and resolve end to end', () => {
    const storeDir = path.join(tmpDir, 'store');
    const inputFile = path.join(tmpDir, 'input.json');
    const packetFile = path.join(tmpDir, 'packet.json');

    const inputData = {
      objective: 'T',
      acceptanceCriteria: 'D',
      permissions: [],
      blockers: [],
      context: { 
        large: 'A'.repeat(1000) 
      }
    };
    fs.writeFileSync(inputFile, JSON.stringify(inputData));

    // Pack
    const packCmd = `node "${cliPath}" pack --input "${inputFile}" --store "${storeDir}" --budget 500`;
    const packOutput = execSync(packCmd, { encoding: 'utf8' });
    const packResult = JSON.parse(packOutput);

    assert.ok(packResult.packet.context.large.$ref !== undefined);
    assert.ok(packResult.metrics.originalChars > 1000);
    assert.ok(packResult.metrics.packetChars < 300);
    assert.ok(packResult.metrics.savedChars > 700);

    fs.writeFileSync(packetFile, JSON.stringify(packResult.packet));

    // Resolve
    const resolveCmd = `node "${cliPath}" resolve --packet "${packetFile}" --store "${storeDir}"`;
    const resolveOutput = execSync(resolveCmd, { encoding: 'utf8' });
    const resolveResult = JSON.parse(resolveOutput);

    assert.strictEqual(resolveResult.resolved.context.large, inputData.context.large);
  });

  await t.test('pack enforces budget', () => {
    const storeDir = path.join(tmpDir, 'store2');
    const inputFile = path.join(tmpDir, 'input2.json');

    const inputData = {
      objective: 'T',
      acceptanceCriteria: 'D',
      permissions: [],
      blockers: [],
      context: {}
    };
    fs.writeFileSync(inputFile, JSON.stringify(inputData));

    const packCmd = `node "${cliPath}" pack --input "${inputFile}" --store "${storeDir}" --budget 10`;
    
    assert.throws(() => {
      execSync(packCmd, { encoding: 'utf8', stdio: 'pipe' });
    }, (err) => {
      assert.strictEqual(err.status, 1);
      const stderr = err.stderr.toString();
      const result = JSON.parse(stderr);
      assert.strictEqual(result.code, 'BUDGET_EXCEEDED');
      return true;
    });
  });

  await t.test('pack rejects invalid budgets', () => {
    const storeDir = path.join(tmpDir, 'store3');
    const inputFile = path.join(tmpDir, 'input3.json');
    fs.writeFileSync(inputFile, JSON.stringify({}));

    const invalidBudgets = ['-5', '0', '12junk', 'NaN', '3.14'];

    for (const budget of invalidBudgets) {
      assert.throws(() => {
        execSync(`node "${cliPath}" pack --input "${inputFile}" --store "${storeDir}" --budget "${budget}"`, { encoding: 'utf8', stdio: 'pipe' });
      }, (err) => {
        assert.strictEqual(err.status, 1);
        const result = JSON.parse(err.stderr.toString());
        assert.strictEqual(result.code, 'INVALID_ARGS');
        assert.ok(result.error.includes('finite positive integer'));
        return true;
      });
    }
  });
});
