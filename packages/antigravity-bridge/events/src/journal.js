const fs = require('fs');
const crypto = require('crypto');

class TaskJournal {
    constructor(storagePath) {
        this.storagePath = storagePath;
        this.tasks = new Map();
        if (this.storagePath) {
            this.load();
        }
    }

    load() {
        if (!fs.existsSync(this.storagePath)) return;

        const content = fs.readFileSync(this.storagePath, 'utf8');
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            try {
                const event = JSON.parse(line);
                this._validateEvent(event);
                this._applyEvent(event);
            } catch (e) {
                if (i === lines.length - 1 || (i === lines.length - 2 && !lines[lines.length-1].trim())) {
                    break;
                } else {
                    throw new Error(`Journal corrupted at line ${i + 1}: ${e.message}`);
                }
            }
        }
        this.recover();
    }

    _validateEvent(event) {
        const task = this.tasks.get(event.taskId);
        if (!task && event.type !== 'created') {
            throw new Error(`Invalid replay: event ${event.type} for unknown task ${event.taskId}`);
        }

        if (!task) return;

        switch (event.type) {
            case 'created':
                break;
            case 'intent-to-submit':
                if (!['created', 'independently-failed', 'hook-error'].includes(task.state)) {
                    throw new Error(`Invalid transition: intent-to-submit from ${task.state}`);
                }
                break;
            case 'submitted':
                if (task.state !== 'intent-to-submit') {
                    throw new Error(`Invalid transition: submitted from ${task.state}`);
                }
                break;
            case 'hook-error':
                if (!['intent-to-submit', 'submitted', 'hook-idle'].includes(task.state)) {
                    throw new Error(`Invalid transition: hook-error from ${task.state}`);
                }
                break;
            case 'hook-idle':
                if (!['submitted', 'hook-idle'].includes(task.state)) {
                    throw new Error(`Invalid transition: hook-idle from ${task.state}`);
                }
                break;
            case 'worker-reported':
                if (!['submitted', 'hook-idle'].includes(task.state)) {
                    throw new Error(`Invalid transition: worker-reported from ${task.state}`);
                }
                break;
            case 'verified':
                if (event.status === 'independently-verified' && task.state !== 'worker-reported') {
                    throw new Error(`Invalid transition: verified from ${task.state}`);
                }
                break;
            case 'unknown-transition':
                break;
            default:
                throw new Error(`Unknown event type: ${event.type}`);
        }
    }

    _applyEvent(event) {
        let task = this.tasks.get(event.taskId);
        if (!task && event.type === 'created') {
            task = {
                taskId: event.taskId,
                agent: event.agent,
                checkId: event.checkId || 'npm-test',
                state: 'created',
                attempts: [],
                currentAttempt: null,
                events: [],
                receipt: null
            };
            this.tasks.set(event.taskId, task);
        }
        
        switch (event.type) {
            case 'created':
                break;
            case 'intent-to-submit':
                task.state = 'intent-to-submit';
                task.currentAttempt = { conversationId: event.conversationId, attempt: event.attempt };
                task.attempts.push(task.currentAttempt);
                break;
            case 'submitted':
                task.state = 'submitted';
                break;
            case 'hook-error':
                task.state = 'hook-error';
                break;
            case 'hook-idle':
                break;
            case 'worker-reported':
                task.state = 'worker-reported';
                task.receipt = event.receipt;
                break;
            case 'verified':
                task.state = event.status; 
                break;
            case 'unknown-transition':
                task.state = 'independently-unknown';
                break;
        }

        task.events.push(event);
        if (task.events.length > 100) task.events = task.events.slice(-50);
    }

    _appendEvent(event) {
        this._validateEvent(event);

        event.eventId = crypto.randomUUID();
        event.timestamp = Date.now();
        
        if (this.storagePath) {
            fs.appendFileSync(this.storagePath, JSON.stringify(event) + '\n');
        }
        
        this._applyEvent(event);
    }

    recover() {
        for (const [taskId, task] of this.tasks.entries()) {
            if (['intent-to-submit', 'submitted', 'worker-reported'].includes(task.state)) {
                this._appendEvent({ type: 'unknown-transition', taskId });
            }
        }
    }

    createTask(taskId, agent, checkId = 'npm-test') {
        if (!agent) throw new Error('Task creation requires an expected agent');
        if (this.tasks.has(taskId)) throw new Error('Task already exists');
        this._appendEvent({ type: 'created', taskId, agent, checkId });
    }

    getTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) throw new Error('Task not found');
        return task;
    }

    canSubmit(taskId) {
        const task = this.getTask(taskId);
        return ['created', 'independently-failed', 'hook-error'].includes(task.state);
    }

    intentToSubmit(taskId, conversationId, attempt) {
        const task = this.getTask(taskId);
        
        if (task.attempts.some(a => a.conversationId === conversationId && a.attempt === attempt)) {
            throw new Error('At-most-once send intent violated: Duplicate attempt');
        }

        if (!this.canSubmit(taskId)) {
            throw new Error('Task not in submittable state. Current state: ' + task.state);
        }

        this._appendEvent({ type: 'intent-to-submit', taskId, conversationId, attempt });
    }

    markSubmitted(taskId, conversationId, attempt) {
        const task = this.getTask(taskId);
        if (!task.currentAttempt || task.currentAttempt.conversationId !== conversationId || task.currentAttempt.attempt !== attempt) {
            throw new Error('Mismatched attempt for markSubmitted');
        }
        if (task.state !== 'intent-to-submit') {
            throw new Error('Task is not in intent-to-submit state');
        }
        this._appendEvent({ type: 'submitted', taskId, conversationId, attempt });
    }

    recordHook(taskId, conversationId, attempt, status) {
        const task = this.getTask(taskId);
        if (!task.currentAttempt || task.currentAttempt.conversationId !== conversationId || task.currentAttempt.attempt !== attempt) {
            return false;
        }

        if (status === 'error') {
            this._appendEvent({ type: 'hook-error', taskId, conversationId, attempt });
            return true;
        } else if (status === 'idle') {
            const last = task.events.length > 0 ? task.events[task.events.length - 1] : null;
            if (last && last.type === 'hook-idle' && last.attempt === attempt) {
                return true; 
            }
            this._appendEvent({ type: 'hook-idle', taskId, conversationId, attempt });
            return true;
        }
        return false;
    }

    recordWorkerReport(taskId, conversationId, attempt, receipt) {
        const task = this.getTask(taskId);
        if (!task.currentAttempt || task.currentAttempt.conversationId !== conversationId || task.currentAttempt.attempt !== attempt) {
            return false;
        }

        this._appendEvent({ type: 'worker-reported', taskId, conversationId, attempt, receipt });
        return true;
    }

    verify(taskId, conversationId, attempt, result, evidence) {
        const validResults = ['independently-verified', 'independently-failed', 'independently-unknown'];
        if (!validResults.includes(result)) {
            throw new Error(`Invalid verification result: ${result}`);
        }

        const task = this.getTask(taskId);
        
        if (!task.currentAttempt || task.currentAttempt.conversationId !== conversationId || task.currentAttempt.attempt !== attempt) {
            return false;
        }

        if (result === 'independently-verified') {
            if (task.state !== 'worker-reported') {
                throw new Error('Cannot verify success without a worker report');
            }
            if (!evidence || typeof evidence !== 'object' || evidence.passed !== true) {
                throw new Error('Independent check evidence must be structured and indicate a passed check for success');
            }
        } else if (result === 'independently-failed') {
            if (!evidence || typeof evidence !== 'object' || evidence.passed !== false) {
                throw new Error('Independent check evidence must be structured and indicate a failed check for failure');
            }
        }

        this._appendEvent({ type: 'verified', taskId, conversationId, attempt, status: result, evidence });
        return true;
    }

    isCompleted(taskId) {
        return this.getTask(taskId).state === 'independently-verified';
    }

    getTaskState(taskId) {
        return this.getTask(taskId).state;
    }
}

module.exports = { TaskJournal };
