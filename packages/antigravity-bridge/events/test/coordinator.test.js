const { Coordinator } = require('../src/coordinator');
const { TaskJournal } = require('../src/journal');
const { Verifier } = require('../../../workspace-runner/src/verifier');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function runTests() {
    console.log('Running Coordinator integration tests...');
    
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-test-'));
    const journalPath = path.join(tmpDir, 'journal.jsonl');
    
    fs.mkdirSync(path.join(tmpDir, 'allowed'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        scripts: { test: "echo pass" }
    }));

    try {
        const journal = new TaskJournal(journalPath);
        const verifier = new Verifier(tmpDir, ['allowed', 'package.json']);
        const coordinator = new Coordinator(journal, verifier);

        // 1. Valid receipt + hook -> success
        journal.createTask('task1', 'AGR-4', 'npm-test');
        journal.intentToSubmit('task1', 'conv1', 1);
        journal.markSubmitted('task1', 'conv1', 1);

        const receiptJson = JSON.stringify({
            taskId: 'task1',
            agent: 'AGR-4',
            changes: ['allowed/test.txt']
        });
        
        // Include non-matching conversation in hook stream, should be ignored safely
        const stopHookJsonl = `{"executionNum":41,"conversationId":"other-conv"}\n{"executionNum":42,"conversationId":"conv1","status":"completed"}\n`;
        
        await coordinator.ingest(receiptJson, stopHookJsonl);
        assert.strictEqual(journal.getTaskState('task1'), 'independently-verified');

        // 2. Agent spoof attempt
        journal.createTask('task2', 'AGR-4', 'npm-test');
        journal.intentToSubmit('task2', 'conv2', 1);
        journal.markSubmitted('task2', 'conv2', 1);
        
        const spoofedReceipt = JSON.stringify({ taskId: 'task2', agent: 'AGR-99' });
        let threw = false;
        try {
            await coordinator.ingest(spoofedReceipt, null);
        } catch(e) {
            assert.ok(e.message.includes('Agent spoof attempt'));
            threw = true;
        }
        assert.ok(threw, 'Should throw on agent spoofing');

        // 3. Failed verification using checkId from coordinator
        journal.createTask('task3', 'AGR-4', 'invalid-check');
        journal.intentToSubmit('task3', 'conv3', 1);
        journal.markSubmitted('task3', 'conv3', 1);
        
        // Receipt tries to supply 'npm-test', but coordinator uses 'invalid-check'
        const failReceipt = JSON.stringify({ taskId: 'task3', agent: 'AGR-4', checkId: 'npm-test' });
        await coordinator.ingest(failReceipt, null);
        assert.strictEqual(journal.getTaskState('task3'), 'independently-failed');

        console.log('All coordinator tests passed!');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runTests();
