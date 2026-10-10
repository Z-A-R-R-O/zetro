import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export class AgentTools {
    constructor(adapter, options = {}) {
        this.adapter = adapter;
        let max = parseInt(options.maxOutputChar, 10);
        if (Number.isNaN(max) || max < 128) {
            throw new Error('maxOutputChar must be an integer >= 128');
        }
        this.maxOutputChar = max;
    }

    _generateId() {
        return crypto.randomBytes(4).toString('hex');
    }

    _replacer(key, value) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('token') || lowerKey.includes('prompt')) {
            return '[REDACTED]';
        }
        if (typeof value === 'string' && value.length > 250) {
            return value.substring(0, 247) + '...';
        }
        return value;
    }

    _format(payload) {
        let str = JSON.stringify(payload, (k, v) => this._replacer(k, v));
        if (str.length > this.maxOutputChar) {
            return JSON.stringify({
                status: 'error',
                requestId: payload.requestId,
                message: `Exceeded ${this.maxOutputChar} chars`
            });
        }
        return str;
    }

    async verifyAll() {
        const reqId = this._generateId();
        try {
            const data = await this.adapter.verifyAll();
            return this._format({ status: 'success', requestId: reqId, data });
        } catch (err) {
            return this._format({ status: 'error', requestId: reqId, message: err.message || String(err) });
        }
    }

    async inspect(agrId) {
        const reqId = this._generateId();
        try {
            const data = typeof this.adapter.inspect === 'function' 
                ? await this.adapter.inspect(agrId) 
                : await this.adapter.verify(agrId);
            return this._format({ status: 'success', requestId: reqId, data });
        } catch (err) {
            return this._format({ status: 'error', requestId: reqId, message: err.message || String(err) });
        }
    }

    async send(agrId, message, dryRun = false) {
        const reqId = this._generateId();
        try {
            const result = dryRun ? { delivery: 'not_attempted', dryRun: true } : await this.adapter.send(agrId, message);
            const finalStatus = (dryRun || result?.delivery === 'not_attempted') ? 'not_attempted' : 'submitted';
            return this._format({ status: finalStatus, requestId: reqId, result });
        } catch (err) {
            return this._format({ status: 'error', requestId: reqId, message: err.message || String(err) });
        }
    }

    async sendPacked(agrId, inputPath, storeDir, budgetStr, dryRun = false) {
        const reqId = this._generateId();
        try {
            if (!agrId || !inputPath || !storeDir || !budgetStr) {
                return this._format({ status: 'error', requestId: reqId, message: 'Missing required args' });
            }
            if (!/^[1-9]\d*$/.test(budgetStr)) {
                return this._format({ status: 'error', requestId: reqId, message: 'Budget must be an exact positive integer string' });
            }
            const budget = parseInt(budgetStr, 10);

            const absInput = path.resolve(inputPath);
            if (!fs.existsSync(absInput)) {
                return this._format({ status: 'error', requestId: reqId, message: 'Input file not found' });
            }

            const inputData = JSON.parse(fs.readFileSync(absInput, 'utf8'));
            if (inputData.acceptance && !inputData.acceptanceCriteria) {
                inputData.acceptanceCriteria = inputData.acceptance;
                delete inputData.acceptance;
            }
            
            const absStore = path.resolve(storeDir);

            const contextBudget = require('../../../packages/context-budget/src/index.js');
            const engine = new contextBudget.ContextEngine(absStore, budget);
            const originalChars = contextBudget.deterministicStringify(inputData).length;

            let packet;
            try {
                const created = engine.createPacket(inputData);
                packet = created.packet;
            } catch (engineErr) {
                return this._format({ status: 'error', requestId: reqId, message: engineErr.message });
            }

            const absoluteCliPath = require.resolve('../../../packages/context-budget/src/cli.js');
            const finalPayload = {
                _system: 'context-budget',
                store: absStore,
                resolve_command: `node ${absoluteCliPath} resolve --packet <saved_packet.json> --store ${absStore}`,
                packet
            };
            const finalPayloadStr = JSON.stringify(finalPayload);

            if (finalPayloadStr.length > budget) {
                return this._format({ status: 'error', requestId: reqId, message: 'Budget exceeded including envelope' });
            }

            const result = dryRun 
                ? { delivery: 'not_attempted', dryRun: true } 
                : await this.adapter.send(agrId, finalPayloadStr);

            const finalStatus = (dryRun || result?.delivery === 'not_attempted') ? 'not_attempted' : 'submitted';

            return this._format({
                status: finalStatus,
                requestId: reqId,
                metrics: {
                    originalChars,
                    packetChars: finalPayloadStr.length,
                    savedChars: originalChars - finalPayloadStr.length
                },
                result
            });
        } catch (err) {
            return this._format({ status: 'error', requestId: reqId, message: err.message || String(err) });
        }
    }

    async poll(agrId) {
        const reqId = this._generateId();
        try {
            if (typeof this.adapter.observe === 'function') {
                const data = await this.adapter.observe(agrId);
                return this._format({ status: 'success', requestId: reqId, data });
            } else {
                return this._format({ status: 'error', requestId: reqId, message: 'unavailable' });
            }
        } catch (err) {
            return this._format({ status: 'error', requestId: reqId, message: err.message || String(err) });
        }
    }

    async statusAll() {
        const reqId = this._generateId();
        try {
            if (typeof this.adapter.observeAll === 'function') {
                const data = await this.adapter.observeAll();
                return this._format({ status: 'success', requestId: reqId, data });
            } else {
                return this._format({ status: 'error', requestId: reqId, message: 'unavailable' });
            }
        } catch (err) {
            return this._format({ status: 'error', requestId: reqId, message: err.message || String(err) });
        }
    }

    async statusCompact() {
        const reqId = this._generateId();
        try {
            if (typeof this.adapter.observeAll !== 'function') {
                return this._format({ status: 'error', requestId: reqId, message: 'unavailable' });
            }
            const data = await this.adapter.observeAll();
            const compact = data.map(d => ({
                agent: d.agent,
                connected: d.connected,
                state: d.state,
                stepCount: d.stepCount
            }));
            return this._format({ status: 'success', requestId: reqId, data: compact });
        } catch (err) {
            return this._format({ status: 'error', requestId: reqId, message: err.message || String(err) });
        }
    }
}
