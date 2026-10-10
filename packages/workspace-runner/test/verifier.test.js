const { Verifier } = require('../src/verifier');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

async function runTests() {
    console.log('Running tests...');
    
    // Test: Require explicit non-empty allowedPaths
    try {
        new Verifier('./', []);
        assert.fail('Should throw if allowedPaths is empty');
    } catch (e) {
        assert.strictEqual(e.message, 'Explicit non-empty allowedPaths is required');
    }
    
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-test-'));
    fs.mkdirSync(path.join(tmpDir, 'allowed'));
    fs.mkdirSync(path.join(tmpDir, 'disallowed'));
    
    fs.writeFileSync(path.join(tmpDir, 'allowed', 'test.txt'), 'hello world');
    fs.writeFileSync(path.join(tmpDir, 'disallowed', 'secret.txt'), 'secret');
    
    fs.symlinkSync(
        path.join(tmpDir, 'disallowed', 'secret.txt'),
        path.join(tmpDir, 'allowed', 'symlink.txt')
    );

    // Write a dummy package.json in allowed to test npm test
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        scripts: { test: "echo pass" }
    }));

    const verifier = new Verifier(tmpDir, ['allowed', 'package.json']);
    
    try {
        assert.strictEqual(await verifier.isPathAllowed('allowed/test.txt'), true);
        assert.strictEqual(await verifier.isPathAllowed('disallowed/secret.txt'), false);
        assert.strictEqual(await verifier.isPathAllowed('allowed/symlink.txt'), false);
        
        const resArbitrary = await verifier.runCheck('arbitrary-cmd');
        assert.strictEqual(resArbitrary.success, false);
        assert.strictEqual(resArbitrary.error, 'Command not in allowlist');

        const receipt = await verifier.generateReceipt(['allowed/test.txt', 'allowed/symlink.txt', 'disallowed/secret.txt']);
        assert.ok(receipt.files['allowed/test.txt'].hash);
        assert.strictEqual(receipt.files['allowed/symlink.txt'].error, 'Path not allowed or escape attempted');
        
        // Smoke test for npm-test (Windows compatible)
        const npmRes = await verifier.runCheck('npm-test');
        // Will be success because dummy package.json has 'echo pass'
        assert.strictEqual(npmRes.success, true);
        assert.ok(npmRes.stdout.includes('pass') || npmRes.stdout.trim() !== '');

        console.log('All tests passed!');
    } catch (e) {
        console.error('Test failed:', e);
        process.exit(1);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runTests();
