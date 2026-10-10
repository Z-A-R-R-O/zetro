import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { SidecarProbe } from '../src/index.js';
import { InboxListener } from '../src/inbox.js';

const mockAdapter = {
    verify: async () => ({ agent: 'AGR-1', connected: true }),
    send: async (agent, msg) => {
        // Mock 50ms network latency
        await new Promise(r => setTimeout(r, 50));
        return { delivery: 'submitted' };
    }
};

async function runBenchmark() {
    console.log('--- Sidecar Architecture Benchmark ---');
    console.log('Comparing direct adapter send vs queued local inbox sidecar path\n');

    const taskId = 'task-' + 'A'.repeat(64); // Simulate 64-char hash/UUID
    const probe = new SidecarProbe(mockAdapter);

    // 1. Direct Adapter Path
    const startDirect = performance.now();
    const resDirect = await probe.runProbe(taskId);
    const endDirect = performance.now();
    
    const directLatency = endDirect - startDirect;
    const directPromptChars = taskId.length;
    const directResChars = JSON.stringify(resDirect).length;

    console.log('[Direct Adapter Path]');
    console.log(`Latency: ${directLatency.toFixed(2)} ms`);
    console.log(`Input Payload: ${directPromptChars} chars, Output Result: ${directResChars} chars\n`);

    // 2. Queued Sidecar Path
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-inbox-'));
    const listener = new InboxListener(tmpDir, probe);
    listener.init();

    const startQueued = performance.now();
    
    // Simulate orchestrator dropping file
    fs.writeFileSync(path.join(listener.inboxDir, `${taskId}.task`), '', 'utf8');
    
    // Simulate sidecar processing tick
    const results = await listener.tick();
    const endQueued = performance.now();
    
    const queuedLatency = endQueued - startQueued;
    const queuedResChars = JSON.stringify(results[0]).length;
    
    const journalSize = fs.statSync(listener.journalFile).size;

    console.log('[Queued Sidecar Path]');
    console.log(`Latency: ${queuedLatency.toFixed(2)} ms`);
    console.log(`Input Payload: ${directPromptChars} chars, Output Result: ${queuedResChars} chars`);
    console.log(`Disk Overhead (Journal): ${journalSize} bytes\n`);

    console.log('--- Summary ---');
    console.log(`Queue I/O Overhead Latency: ${(queuedLatency - directLatency).toFixed(2)} ms`);
    console.log('Note: No token costs are claimed or simulated; byte/character sizes purely reflect string lengths and disk serialization limits.');
    
    listener.shutdown();
}

runBenchmark().catch(console.error);
