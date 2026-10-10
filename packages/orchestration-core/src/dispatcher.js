import { States } from './types.js';
import { Journal } from './journal.js';

export class Dispatcher {
  constructor(adapter, journalPath) {
    this.adapter = adapter;
    this.journal = new Journal(journalPath);
    this.queue = [];
    this.stateMap = new Map();
    this.isProcessing = false;
    this.abortControllers = new Map();
    this._drainResolvers = [];
  }

  async init() {
    const events = await this.journal.init();
    for (const event of events) {
      if (event.type === 'SUBMIT') {
        this.stateMap.set(event.payload.id, States.PENDING);
        this.queue.push(event.payload);
      } else if (event.type === 'TRANSITION') {
        this.stateMap.set(event.payload.id, event.payload.state);
        if (event.payload.state !== States.PENDING && event.payload.state !== States.RUNNING) {
          this.queue = this.queue.filter(e => e.id !== event.payload.id);
        }
      }
    }
    
    const tasks = [...this.queue];
    for (const task of tasks) {
      if (this.stateMap.get(task.id) === States.RUNNING) {
        await this._transition(task.id, States.UNKNOWN, { error: 'Crashed while RUNNING' });
      }
    }
    this.queue = this.queue.filter(e => this.stateMap.get(e.id) === States.PENDING);
  }

  validateEnvelope(envelope) {
    if (!envelope.id || !envelope.agent || !envelope.objective || typeof envelope.deadlineMs !== 'number') {
      throw new Error('Invalid TaskEnvelope: missing required fields');
    }
    if (!Array.isArray(envelope.contextRefs) || !Array.isArray(envelope.allowedPaths)) {
      throw new Error('Invalid TaskEnvelope: contextRefs/allowedPaths must be arrays');
    }
    if (typeof envelope.acceptance !== 'string' || typeof envelope.verification !== 'string') {
      throw new Error('Invalid TaskEnvelope: acceptance/verification must be strings');
    }
    if (!envelope.budget || typeof envelope.budget.maxContextChars !== 'number' || typeof envelope.budget.maxReplyChars !== 'number' || envelope.budget.maxContextChars <= 0 || envelope.budget.maxReplyChars <= 0) {
      throw new Error('Invalid TaskEnvelope: budget fields missing or invalid bounds');
    }
    if (this.stateMap.has(envelope.id)) {
      throw new Error(`Duplicate Task ID: ${envelope.id}`);
    }
  }

  async submit(envelope) {
    this.validateEnvelope(envelope);
    await this.journal.append({ type: 'SUBMIT', payload: envelope });
    this.stateMap.set(envelope.id, States.PENDING);
    this.queue.push(envelope);
    this._processQueue();
  }

  async drain() {
    if (!this.isProcessing && this.queue.length === 0) return;
    await new Promise(resolve => this._drainResolvers.push(resolve));
  }

  async cancel(id) {
    if (!this.stateMap.has(id)) return false;
    const state = this.stateMap.get(id);
    if ([States.COMPLETED, States.SUBMITTED, States.FAILED, States.UNKNOWN, States.CANCELLED].includes(state)) {
      return false;
    }
    
    let ac = this.abortControllers.get(id);
    if (!ac) {
      ac = new AbortController();
      this.abortControllers.set(id, ac);
    }
    ac.abort();
    
    await this._transition(id, States.CANCELLED);
    return true;
  }

  async _transition(id, state, extra = {}) {
    await this.journal.append({ type: 'TRANSITION', payload: { id, state, ...extra } });
    this.stateMap.set(id, state);
  }

  async _processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      while (this.queue.length > 0) {
        const index = this.queue.findIndex(e => this.stateMap.get(e.id) === States.PENDING);
        if (index === -1) {
          this.queue = [];
          break;
        }
        const envelope = this.queue.splice(index, 1)[0];
        try {
          await this._executeTask(envelope);
        } catch (err) {
          this.lastError = err;
        }
      }
    } finally {
      this.isProcessing = false;
      while (this._drainResolvers.length) {
        this._drainResolvers.pop()();
      }
      if (this.queue.length > 0) {
        this._processQueue();
      }
    }
  }

  async _executeTask(envelope) {
    let ac = this.abortControllers.get(envelope.id);
    if (ac?.signal.aborted) return;
    if (this.stateMap.get(envelope.id) !== States.PENDING) return;
    
    await this._transition(envelope.id, States.RUNNING);
    
    ac = this.abortControllers.get(envelope.id);
    if (ac?.signal.aborted) {
      await this._transition(envelope.id, States.CANCELLED);
      return;
    }
    
    if (!ac) {
      ac = new AbortController();
      this.abortControllers.set(envelope.id, ac);
    }

    let timeoutId;
    const deadlinePromise = new Promise((_, reject) => {
      if (envelope.deadlineMs > 0) {
        timeoutId = setTimeout(() => reject(new Error('Deadline exceeded')), envelope.deadlineMs);
      }
    });

    try {
      const receipt = await Promise.race([
        this.adapter.execute(envelope, ac.signal),
        deadlinePromise
      ]);
      
      if (!receipt || receipt.id !== envelope.id || receipt.agent !== envelope.agent || ![States.SUBMITTED, States.COMPLETED, States.FAILED, States.UNKNOWN].includes(receipt.state)) {
        throw new Error('Invalid adapter receipt: mismatch or bad state');
      }
      await this._transition(envelope.id, receipt.state, { receipt });
    } catch (error) {
      if (error.name === 'AbortError' || (ac && ac.signal.aborted)) {
        // Handled by cancel
      } else if (error.message === 'Deadline exceeded') {
        ac.abort();
        await this._transition(envelope.id, States.UNKNOWN, { error: 'Deadline exceeded', uncertainty: 'In-flight when deadline exceeded' });
      } else {
        await this._transition(envelope.id, States.FAILED, { error: error.message });
      }
    } finally {
      clearTimeout(timeoutId);
      this.abortControllers.delete(envelope.id);
    }
  }

  getState(id) {
    return this.stateMap.get(id);
  }
}
