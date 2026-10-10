import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function checkReadiness() {
    console.log('--- Managed Sidecar Readiness Validation ---');
    
    // 1. Config Template Validation
    const sidecarJsonPath = path.resolve(__dirname, '../sidecar.json');
    if (fs.existsSync(sidecarJsonPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(sidecarJsonPath, 'utf8'));
            console.log('✓ sidecar.json template is valid JSON.');
            if (parsed.command && parsed.args && Array.isArray(parsed.args)) {
                console.log('✓ sidecar.json contains expected Antigravity command/args schema.');
            } else {
                console.error('✗ sidecar.json schema invalid: Missing command or args array.');
            }
        } catch (e) {
            console.error('✗ sidecar.json parse failure: ' + e.message);
        }
    } else {
        console.error('✗ sidecar.json template not found.');
    }

    // 2. Data Directory Discovery Validation
    console.log('\n--- Environment Mapping ---');
    if (process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR) {
        console.log('✓ ANTIGRAVITY_EXECUTABLE_DATA_DIR is natively mapped: ' + process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR);
    } else {
        console.log('⚠ ANTIGRAVITY_EXECUTABLE_DATA_DIR is missing (Expected behavior for local/standalone unmanaged executions).');
        console.log('  -> Sidecar safely falls back to .data/ exclusively for tests.');
    }

    // 3. Global Sidecars Path (Installation Target)
    const homedir = os.homedir();
    const targetDir = path.join(homedir, '.gemini', 'config', 'sidecars');
    console.log('\n--- Global Discovery Target ---');
    console.log('Antigravity sidecars are inherently discovered strictly within:');
    console.log(targetDir);
    console.log('\nValidation Complete: Target environment evaluated successfully.');
    console.log('WARNING: The configuration remains a local template. DO NOT explicitly install or enable live configurations unless prompted by architecture performance metrics.');
}

checkReadiness();
