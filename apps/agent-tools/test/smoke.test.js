import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '../src/cli.js');

function runCli(args, expectFail = false) {
    try {
        const out = execSync(`node "${cliPath}" ${args}`, { encoding: 'utf8' }).trim();
        if (expectFail) assert.fail('Expected command to exit with non-zero code');
        return JSON.parse(out);
    } catch (err) {
        if (!expectFail) {
            console.error('Command failed unexpectedly', err.stdout, err.stderr);
            assert.fail('Command failed: ' + args);
        }
        try { return JSON.parse(err.stdout.trim()); } catch (e) { return err.stdout.trim(); }
    }
}

try {
    console.log('Running integration tests...');
    
    const sCompact = runCli('status-compact');
    assert.strictEqual(sCompact.status, 'success');
    if (sCompact.data.length > 0) {
        assert.strictEqual(sCompact.data[0].workspace, undefined);
    }

    // Dry-run send-packed live integration
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-tools-test-'));
    const taskJson = path.join(tmpDir, 'task.json');
    fs.writeFileSync(taskJson, JSON.stringify({
        objective: 'smoke packed',
        acceptanceCriteria: 'pass',
        permissions: 'none',
        blockers: 'none',
        context: { big: 'A'.repeat(5000) }
    }));
    const storeDir = path.join(tmpDir, 'store');

    const sPackRes = runCli(`send-packed AGR-1 --input "${taskJson}" --store "${storeDir}" --budget 2000 --dry-run`);
    assert.strictEqual(sPackRes.status, 'not_attempted');
    assert.ok(sPackRes.metrics.savedChars > 300);

    console.log('Integration tests passed.');
} catch (err) {
    console.error('Integration tests failed', err);
    process.exit(1);
}
