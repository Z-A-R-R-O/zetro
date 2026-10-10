import fs from 'node:fs';
import path from 'node:path';

export class InboxListener {
    constructor(dataDir, probe) {
        this.dataDir = dataDir;
        this.inboxDir = path.join(dataDir, 'inbox');
        this.journalFile = path.join(dataDir, 'journal.log');
        this.lockFile = path.join(dataDir, 'sidecar.lock');
        this.probe = probe;
        this.attemptedTasks = new Set();
        this.isShuttingDown = false;
        this.lockFd = undefined;
    }

    init() {
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
        if (!fs.existsSync(this.inboxDir)) fs.mkdirSync(this.inboxDir, { recursive: true });

        try {
            this.lockFd = fs.openSync(this.lockFile, 'wx');
            fs.writeSync(this.lockFd, String(process.pid));
        } catch (err) {
            if (err.code === 'EEXIST') {
                let stalePid = 'unknown';
                try { stalePid = fs.readFileSync(this.lockFile, 'utf8'); } catch(e) {}
                throw new Error(`Lockfile exists (PID: ${stalePid}). If stale after a crash, explicitly remove ${this.lockFile} to reconcile and preserve crash evidence.`);
            }
            throw err;
        }

        if (fs.existsSync(this.journalFile)) {
            const journal = fs.readFileSync(this.journalFile, 'utf8').split('\n').filter(Boolean);
            const state = {};
            journal.forEach(line => {
                const [taskId, intent] = line.split(':');
                if (taskId) state[taskId] = intent;
            });

            for (const [taskId, intent] of Object.entries(state)) {
                if (intent === 'ATTEMPT_INTENT') {
                    // Crash detected mid-flight! Mark UNKNOWN, never auto-resubmit.
                    this.attemptedTasks.add(taskId);
                    this._appendJournalSync(taskId, 'UNKNOWN');
                } else if (intent === 'SUBMITTED' || intent === 'FAILED' || intent === 'UNKNOWN') {
                    this.attemptedTasks.add(taskId);
                }
            }
        }
    }

    _appendJournalSync(taskId, status) {
        const fd = fs.openSync(this.journalFile, 'a');
        fs.appendFileSync(fd, `${taskId}:${status}\n`, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
    }

    async processTask(taskId, filePath) {
        if (this.attemptedTasks.has(taskId)) return false;
        this.attemptedTasks.add(taskId); // Memory lock

        this._appendJournalSync(taskId, 'ATTEMPT_INTENT');

        const res = await this.probe.runProbe(taskId);
        
        if (res.status === 'submitted') {
            this._appendJournalSync(taskId, 'SUBMITTED');
            try { fs.unlinkSync(filePath); } catch(e) {}
        } else {
            this._appendJournalSync(taskId, 'FAILED');
        }
        return res;
    }

    async tick() {
        const results = [];
        const files = fs.readdirSync(this.inboxDir);
        for (const file of files) {
            if (file.endsWith('.task')) {
                const taskId = path.basename(file, '.task');
                const filePath = path.join(this.inboxDir, file);
                const res = await this.processTask(taskId, filePath);
                if (res) results.push(res);
            }
        }
        return results;
    }

    async startPolling(intervalMs = 1000) {
        while (!this.isShuttingDown) {
            await this.tick();
            await new Promise(r => setTimeout(r, intervalMs));
        }
    }

    shutdown() {
        this.isShuttingDown = true;
        if (this.lockFd !== undefined) {
            try { fs.closeSync(this.lockFd); } catch(e) {}
            try { fs.unlinkSync(this.lockFile); } catch(e) {}
            this.lockFd = undefined;
        }
    }
}
