const { TaskJournal } = require('../src/journal');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function runTests() {
    console.log('Running TaskJournal integration harness...');
    
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-integration-'));
    const storagePath = path.join(tmpDir, 'journal.jsonl');

    try {
        let journal = new TaskJournal(storagePath);
        
        journal.createTask('task1', 'AGR-4');
        
        journal.intentToSubmit('task1', 'conv1', 1);
        journal.markSubmitted('task1', 'conv1', 1);
        journal.recordWorkerReport('task1', 'conv1', 1, { files: [] });
        
        assert.throws(() => journal.verify('task1', 'conv1', 1, 'invalid-state', { passed: true }), /Invalid verification result/);
        assert.throws(() => journal.verify('task1', 'conv1', 1, 'independently-verified', { passed: false }), /indicate a passed check for success/);
        assert.throws(() => journal.verify('task1', 'conv1', 1, 'independently-failed', { passed: true }), /indicate a failed check for failure/);
        
        journal.verify('task1', 'conv1', 1, 'independently-failed', { passed: false });
        assert.strictEqual(journal.getTaskState('task1'), 'independently-failed');
        
        journal.createTask('task2', 'AGR-4');
        journal.intentToSubmit('task2', 'conv2', 1);
        
        const realStorage = journal.storagePath;
        journal.storagePath = '/invalid_path/that_does_not_exist/file.jsonl';
        
        let threw = false;
        try {
            journal.markSubmitted('task2', 'conv2', 1);
        } catch (e) {
            threw = true;
        }
        assert.ok(threw, 'Should throw on disk failure');
        
        journal.storagePath = realStorage;
        assert.strictEqual(journal.getTaskState('task2'), 'intent-to-submit');
        
        console.log('All integration tests passed!');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runTests();
