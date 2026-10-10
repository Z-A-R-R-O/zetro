import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarProbe } from './index.js';
import { InboxListener } from './inbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || path.resolve(__dirname, '../.data');

async function run() {
    let adapterInstance;
    try {
        const { AntigravityAdapter, loadConfig } = await import('../../../antigravity-adapter/dist/index.js');
        const config = await loadConfig();
        adapterInstance = new AntigravityAdapter(config);
    } catch (e) {
        console.error(JSON.stringify({ status: 'error', message: 'Adapter load failed: ' + e.message }));
        process.exitCode = 1;
        return;
    }

    const probe = new SidecarProbe(adapterInstance);
    const listener = new InboxListener(DATA_DIR, probe);
    
    listener.init();
    
    const shutdown = () => {
        console.log('Shutting down inbox listener...');
        listener.shutdown();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('Managed sidecar started. Listening on:', listener.inboxDir);
    await listener.startPolling(1000);
}

run();
