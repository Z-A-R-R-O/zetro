import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '../src/cli.js');

function runCli(args) {
    const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return { exitCode: result.status, output: JSON.parse(result.stdout) };
}

try {
    console.log('Running integration tests...');
    
    const { exitCode: statusExitCode, output: sCompact } = runCli(['status-compact']);
    assert.strictEqual(sCompact.status, 'success');
    assert.strictEqual(statusExitCode, sCompact.data.some(d => d.connected === false) ? 1 : 0);
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

    const { exitCode: packExitCode, output: sPackRes } = runCli([
        'send-packed', 'AGR-1', '--input', taskJson, '--store', storeDir, '--budget', '2000', '--dry-run'
    ]);
    assert.strictEqual(packExitCode, 0);
    assert.strictEqual(sPackRes.status, 'not_attempted');
    assert.ok(sPackRes.metrics.savedChars > 300);

    console.log('Integration tests passed.');
} catch (err) {
    console.error('Integration tests failed', err);
    process.exit(1);
}
