import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SidecarProbe } from '../src/index.js';
import { InboxListener } from '../src/inbox.js';

const mockAdapterSuccess = {
    verify: async (agent) => {
        if (agent === 'AGR-1') return { agent: 'AGR-1', connected: true };
        throw new Error('Not AGR-1');
    },
    send: async (agent, msg) => {
        return { delivery: 'submitted' }; // Strict requirement
    }
};

const mockAdapterFail = {
    verify: async () => ({ agent: 'AGR-1', connected: true }),
    send: async () => { throw new Error('Network failure during send'); }
};

const mockAdapterBadDelivery = {
    verify: async () => ({ agent: 'AGR-1', connected: true }),
    send: async () => ({ delivery: 'queued_but_unconfirmed' })
};

async function runTests() {
    console.log('Running sidecar probe tests...');
    
    const probeSuccess = new SidecarProbe(mockAdapterSuccess);
    const probeFail = new SidecarProbe(mockAdapterFail);
    const probeBadDelivery = new SidecarProbe(mockAdapterBadDelivery);

    const result = await probeSuccess.runProbe('task-888');
    assert.strictEqual(result.status, 'submitted');
    assert.strictEqual(result.completed, false);

    const badDeliveryResult = await probeBadDelivery.runProbe('task-889');
    assert.strictEqual(badDeliveryResult.status, 'error');

    console.log('Running persistent inbox queue tests...');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-inbox-'));
    
    const listener = new InboxListener(tmpDir, probeSuccess);
    listener.init();

    try {
        const dupListener = new InboxListener(tmpDir, probeSuccess);
        dupListener.init();
        assert.fail('Should have thrown lockfile error');
    } catch (e) {
        assert.ok(e.message.includes('Lockfile exists'), 'Must enforce single process lock');
        assert.ok(e.message.includes('explicitly remove'), 'Must direct operator to remove lock explicitly');
    }

    fs.writeFileSync(path.join(listener.inboxDir, 'task-100.task'), '', 'utf8');
    const results = await listener.tick();
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, 'submitted');
    assert.ok(!fs.existsSync(path.join(listener.inboxDir, 'task-100.task')), 'Successful task file should be deleted');
    
    fs.writeFileSync(path.join(listener.inboxDir, 'task-100.task'), '', 'utf8');
    const dupResults = await listener.tick();
    assert.strictEqual(dupResults.length, 0, 'Duplicate task must be ignored');

    listener.probe = probeFail;

    fs.writeFileSync(path.join(listener.inboxDir, 'task-err.task'), '', 'utf8');
    const failResults = await listener.tick();
    assert.strictEqual(failResults.length, 1);
    assert.strictEqual(failResults[0].status, 'error');
    assert.ok(fs.existsSync(path.join(listener.inboxDir, 'task-err.task')), 'Failed task file must be retained');

    const journal = fs.readFileSync(listener.journalFile, 'utf8').trim().split('\n');
    assert.ok(journal.includes('task-err:FAILED'), 'Failed task must be journaled');
    assert.ok(journal.includes('task-err:ATTEMPT_INTENT'), 'Intent must be logged before fail');

    listener.shutdown(); 

    // Test: Crash Window (At-most-once delivery)
    console.log('Running crash window at-most-once tests...');
    const crashTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-crash-'));
    const crashListener = new InboxListener(crashTmpDir, probeSuccess);
    crashListener.init();

    // Directly write the intent to simulate a crash mid-flight
    fs.writeFileSync(path.join(crashListener.inboxDir, 'task-crash.task'), '', 'utf8');
    const fd = fs.openSync(crashListener.journalFile, 'a');
    fs.appendFileSync(fd, `task-crash:ATTEMPT_INTENT\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    crashListener.shutdown(); // Release lock for recovery

    const recoveredListener = new InboxListener(crashTmpDir, probeSuccess);
    recoveredListener.init();

    const journalAfterRecovery = fs.readFileSync(recoveredListener.journalFile, 'utf8').trim().split('\n');
    assert.ok(journalAfterRecovery.includes('task-crash:UNKNOWN'), 'Crash intent must be reconciled as UNKNOWN');
    
    const crashResults = await recoveredListener.tick();
    assert.strictEqual(crashResults.length, 0, 'Must NOT auto-resubmit a crashed task');
    assert.ok(fs.existsSync(path.join(recoveredListener.inboxDir, 'task-crash.task')), 'Task file must be retained for crash evidence');
    
    recoveredListener.shutdown();

    console.log('All tests passed.');
}

runTests().catch(e => {
    console.error(e);
    process.exit(1);
});
