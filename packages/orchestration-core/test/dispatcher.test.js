import { test } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Dispatcher } from '../src/dispatcher.js';
import { States } from '../src/types.js';

const journalPath = join(process.cwd(), 'test-journal.jsonl');

async function cleanup() {
  await rm(journalPath, { force: true }).catch(() => {});
}

function createDummyAdapter(delayMs, receiptState = States.COMPLETED) {
  return {
    execute: async (envelope, signal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({
            id: envelope.id, agent: envelope.agent, state: receiptState,
            changedFiles: [], checks: [], evidenceRefs: [],
            summary: 'Done', uncertainty: 'None'
          });
        }, delayMs);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('AbortError'));
        });
      });
    }
  };
}

function validEnvelope(id) {
  return {
    id, agent: 'agent1', objective: 'test',
    contextRefs: [], allowedPaths: [], acceptance: '', verification: '',
    deadlineMs: 1000,
    budget: { maxContextChars: 100, maxReplyChars: 100 }
  };
}

test('Validation failure', async (t) => {
  await cleanup();
  const d = new Dispatcher(createDummyAdapter(10), journalPath);
  await d.init();
  const badEnv = validEnvelope('bad');
  badEnv.budget.maxContextChars = -1;
  await assert.rejects(d.submit(badEnv), /invalid bounds/);
  await cleanup();
});

test('Dispatcher basic flow', async (t) => {
  await cleanup();
  const d = new Dispatcher(createDummyAdapter(10), journalPath);
  await d.init();
  await d.submit(validEnvelope('task1'));
  await d.drain();
  assert.equal(d.getState('task1'), States.COMPLETED);
  await cleanup();
});

test('Cancellation', async (t) => {
  await cleanup();
  const d = new Dispatcher(createDummyAdapter(100), journalPath);
  await d.init();
  await d.submit(validEnvelope('cancel_me'));
  await d.cancel('cancel_me');
  await d.drain();
  assert.equal(d.getState('cancel_me'), States.CANCELLED);
  await cleanup();
});

test('Deadline exceeded is UNKNOWN', async (t) => {
  await cleanup();
  const d = new Dispatcher(createDummyAdapter(200), journalPath);
  await d.init();
  const env = validEnvelope('timeout');
  env.deadlineMs = 50;
  await d.submit(env);
  await d.drain();
  assert.equal(d.getState('timeout'), States.UNKNOWN);
  await cleanup();
});

test('Crash-after-send replay', async (t) => {
  await cleanup();
  let d = new Dispatcher(createDummyAdapter(100), journalPath);
  await d.init();
  await d.submit(validEnvelope('persist1'));
  await new Promise(r => setTimeout(r, 20));
  
  let d2 = new Dispatcher(createDummyAdapter(10), journalPath);
  await d2.init();
  assert.equal(d2.getState('persist1'), States.UNKNOWN);
  await cleanup();
});

test('Submitted != Completed', async (t) => {
  await cleanup();
  const d = new Dispatcher(createDummyAdapter(10, States.SUBMITTED), journalPath);
  await d.init();
  await d.submit(validEnvelope('sub1'));
  await d.drain();
  assert.equal(d.getState('sub1'), States.SUBMITTED);
  await cleanup();
});

// NEW DETERMINISTIC RACE & FAILURE TESTS
test('Race condition: Cancel immediately after submit', async (t) => {
  await cleanup();
  let executed = false;
  const adapter = { 
    execute: async (env) => { 
      executed = true; 
      return { id: env.id, state: States.COMPLETED }; 
    } 
  };
  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  
  const env = validEnvelope('race');
  await d.submit(env); // Await submit so it enters queue!
  await d.cancel('race'); // Cancel immediately while _processQueue is yielding on RUNNING transition
  await d.drain();
  
  assert.equal(d.getState('race'), States.CANCELLED);
  assert.equal(executed, false, 'Adapter should not execute');
  await cleanup();
});

test('Invalid receipt identity/state', async (t) => {
  await cleanup();
  const adapter = {
    execute: async (env) => ({ id: 'wrong_id', agent: env.agent, state: States.COMPLETED })
  };
  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  await d.submit(validEnvelope('bad_rec_id'));
  await d.drain();
  assert.equal(d.getState('bad_rec_id'), States.FAILED);
  await cleanup();
});

test('Invalid receipt agent', async (t) => {
  await cleanup();
  const adapter = {
    execute: async (env) => ({ id: env.id, agent: 'wrong_agent', state: States.COMPLETED })
  };
  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  await d.submit(validEnvelope('bad_rec_agent'));
  await d.drain();
  assert.equal(d.getState('bad_rec_agent'), States.FAILED);
  await cleanup();
});

test('processQueue error handling leaves safe state', async (t) => {
  await cleanup();
  const adapter = {
    execute: async () => { throw new Error('Adapter crash'); }
  };
  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  await d.submit(validEnvelope('crash'));
  await d.drain();
  assert.equal(d.getState('crash'), States.FAILED);
  assert.equal(d.isProcessing, false);
  await cleanup();
});

test('Cancellation during delayed RUNNING append', async (t) => {
  await cleanup();
  const d = new Dispatcher(createDummyAdapter(50), journalPath);
  await d.init();
  
  const origAppend = d.journal.append.bind(d.journal);
  d.journal.append = async (event) => {
    if (event.payload?.state === States.RUNNING) {
      await new Promise(r => setTimeout(r, 30));
    }
    return origAppend(event);
  };
  
  await d.submit(validEnvelope('delay_cancel'));
  await new Promise(r => setTimeout(r, 5));
  
  await d.cancel('delay_cancel');
  await d.drain();
  
  assert.equal(d.getState('delay_cancel'), States.CANCELLED);
  await cleanup();
});
