const { TaskJournal } = require('./journal');
const { Verifier } = require('../../../workspace-runner/src/verifier.js');

class Coordinator {
    constructor(journal, verifier) {
        this.journal = journal;
        this.verifier = verifier;
    }

    async ingest(mcpReceiptJson, stopHookJsonl) {
        const receipt = typeof mcpReceiptJson === 'string' ? JSON.parse(mcpReceiptJson) : mcpReceiptJson;
        
        if (!receipt.taskId) throw new Error('Receipt missing taskId');
        if (!receipt.agent) throw new Error('Receipt missing agent');

        const taskId = receipt.taskId;
        const task = this.journal.getTask(taskId);

        if (receipt.agent !== task.agent) {
            throw new Error(`Agent spoof attempt: expected ${task.agent}, got ${receipt.agent}`);
        }
        
        if (!task.currentAttempt) {
            throw new Error('Task has no active attempt');
        }

        const { conversationId, attempt } = task.currentAttempt;

        if (stopHookJsonl) {
            const lines = (typeof stopHookJsonl === 'string' ? stopHookJsonl : '').split('\n').filter(Boolean);
            for (const line of lines) {
                let event;
                try {
                    event = JSON.parse(line);
                } catch (e) {
                    continue; 
                }
                if (event && event.conversationId && event.conversationId !== conversationId) {
                    continue; // ignore non-matching conversations safely
                }
            }
        }

        const reported = this.journal.recordWorkerReport(taskId, conversationId, attempt, receipt);
        if (!reported) {
            throw new Error('Failed to record worker report (mismatched or stale attempt)');
        }

        // Use independent checkId from coordinator task spec
        const checkId = task.checkId || 'npm-test';
        const result = await this.verifier.runCheck(checkId);

        if (result.success) {
            this.journal.verify(taskId, conversationId, attempt, 'independently-verified', {
                passed: true,
                output: result.stdout
            });
        } else {
            this.journal.verify(taskId, conversationId, attempt, 'independently-failed', {
                passed: false,
                output: result.stderr || result.error || 'Check failed',
                code: result.code
            });
        }

        return { taskId, result };
    }
}

module.exports = { Coordinator };
