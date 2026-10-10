#!/usr/bin/env node
import { AgentTools } from './index.js';

const args = process.argv.slice(2);
let maxChars = 5000;
const maxCharIndex = args.findIndex(a => a === '--max-chars');
if (maxCharIndex !== -1 && args[maxCharIndex + 1]) {
    const raw = args[maxCharIndex + 1];
    maxChars = parseInt(raw, 10);
    if (Number.isNaN(maxChars) || maxChars < 128) {
        console.log(JSON.stringify({
            status: 'error',
            message: '--max-chars must be an integer >= 128'
        }));
        process.exit(1);
    }
    args.splice(maxCharIndex, 2);
}

const dryRunIndex = args.indexOf('--dry-run');
let dryRun = false;
if (dryRunIndex !== -1) {
    dryRun = true;
    args.splice(dryRunIndex, 1);
}

let adapterInstance;
try {
    const { AntigravityAdapter, loadConfig } = await import('../../../packages/antigravity-adapter/dist/index.js');
    const config = await loadConfig();
    adapterInstance = new AntigravityAdapter(config);
} catch (e) {
    adapterInstance = {
        verifyAll: async () => { throw new Error('Adapter failed to load: ' + e.message) },
        verify: async () => { throw new Error('Adapter failed to load: ' + e.message) },
        send: async () => { throw new Error('Adapter failed to load: ' + e.message) },
        observe: async () => { throw new Error('Adapter failed to load: ' + e.message) },
        observeAll: async () => { throw new Error('Adapter failed to load: ' + e.message) }
    };
}

const command = args[0];
const tools = new AgentTools(adapterInstance, { maxOutputChar: maxChars });

function parseNamedArgs(argsList) {
    const obj = {};
    for (let i = 0; i < argsList.length; i++) {
        if (argsList[i].startsWith('--')) {
            obj[argsList[i].slice(2)] = argsList[i + 1];
            i++;
        }
    }
    return obj;
}

async function run() {
    let outStr;
    try {
        switch(command) {
            case 'verify-all':
                outStr = await tools.verifyAll();
                break;
            case 'inspect':
                outStr = await tools.inspect(args[1]);
                break;
            case 'send':
                outStr = await tools.send(args[1], args.slice(2).join(' '), dryRun);
                break;
            case 'send-packed': {
                const agrId = args[1];
                const named = parseNamedArgs(args.slice(2));
                outStr = await tools.sendPacked(agrId, named.input, named.store, named.budget, dryRun);
                break;
            }
            case 'poll':
                outStr = await tools.poll(args[1]);
                break;
            case 'status-all':
                outStr = await tools.statusAll();
                break;
            case 'status-compact':
                outStr = await tools.statusCompact();
                break;
            default:
                outStr = JSON.stringify({status: 'error', message: 'Unknown command'});
        }
    } catch (err) {
        outStr = JSON.stringify({status: 'error', message: 'CLI internal error: ' + err.message});
    }

    try {
        const parsed = JSON.parse(outStr);
        if (parsed.status === 'error') {
            process.exitCode = 1;
        } else if (parsed.status === 'success' && Array.isArray(parsed.data)) {
            const hasFailure = parsed.data.some(d => d.connected === false || d.state === 'error' || d.status === 'failed');
            if (hasFailure) process.exitCode = 1;
        }
    } catch (e) {
        process.exitCode = 1;
    }

    console.log(outStr);
}
run();
