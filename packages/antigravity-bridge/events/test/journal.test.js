const { TaskJournal } = require('../src/journal');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function runTests() {
    console.log('Running TaskJournal tests...');
    
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
    const storagePath = path.join(tmpDir, 'journal.jsonl');

    try {
        let journal = new TaskJournal(storagePath);
        
        journal.createTask('task1', 'AGR-4');
        assert.strictEqual(journal.getTaskState('task1'), 'created');

        assert.throws(() => journal.getTask('no-task'), /Task not found/);

        journal.intentToSubmit('task1', 'conv1', 1);
        journal.markSubmitted('task1', 'conv1', 1);
        journal.recordHook('task1', 'conv1', 1, 'idle');
        journal.recordWorkerReport('task1', 'conv1', 1, { some: 'receipt' });
        
        assert.throws(() => journal.verify('task1', 'conv1', 1, 'independently-verified', null), /evidence must be structured/);
        
        journal.verify('task1', 'conv1', 1, 'independently-verified', { passed: true });
        assert.strictEqual(journal.isCompleted('task1'), true);

        journal.createTask('task2', 'AGR-4');
        journal.intentToSubmit('task2', 'conv2', 1);
        journal.markSubmitted('task2', 'conv2', 1);
        assert.throws(() => journal.verify('task2', 'conv2', 1, 'independently-verified', { passed: true }), /Cannot verify success without a worker report/);
        
        journal.createTask('task3', 'AGR-4');
        journal.intentToSubmit('task3', 'conv3', 1);
        journal.markSubmitted('task3', 'conv3', 1);
        
        fs.appendFileSync(storagePath, '{"type":"created","taskId":"task-corrupt"\n');
        
        let recoveredJournal = new TaskJournal(storagePath);
        
        assert.strictEqual(recoveredJournal.getTaskState('task3'), 'independently-unknown');
        
        assert.throws(() => recoveredJournal.intentToSubmit('task3', 'conv3', 2), /Task not in submittable state/);
        
        const lines = fs.readFileSync(storagePath, 'utf8').split('\n');
        lines.splice(1, 0, '{"type":"broken-json",');
        const brokenPath = path.join(tmpDir, 'broken.jsonl');
        fs.writeFileSync(brokenPath, lines.join('\n'));
        
        assert.throws(() => new TaskJournal(brokenPath), /Journal corrupted at line 2/);
        
        console.log('All tests passed!');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runTests();
