# @zetro/orchestration-core

Finite single-worker dispatch core.

## Features
- `TaskEnvelope` / `TaskReceipt` entity structures.
- Sequential dispatch via injected adapter port.
- Configurable timeouts and manual cancellation via AbortController.
- Duplicate ID validation.
- Durable append-only journal (`.jsonl`) for crash recovery.
- Maintains `UNKNOWN` states without automatically retrying.

## API
```js
import { Dispatcher, States } from '@zetro/orchestration-core';

// 1. Injected adapter separates core logic from Antigravity environment
const adapter = {
  execute: async (envelope, abortSignal) => {
    // Return a TaskReceipt...
  }
};

const dispatcher = new Dispatcher(adapter, 'logs/journal.jsonl');

// 2. Initialize from journal
await dispatcher.init();

// 3. Submit tasks
await dispatcher.submit({
  id: 'task_1', agent: 'agent1', objective: 'do work',
  contextRefs: [], allowedPaths: [], acceptance: '', verification: '',
  deadlineMs: 60000, budget: { maxContextChars: 1000, maxReplyChars: 1000 }
});

// 4. Manual cancellation
await dispatcher.cancel('task_1');
```
