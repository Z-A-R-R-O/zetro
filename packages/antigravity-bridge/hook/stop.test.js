const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const hookPath = path.join(__dirname, 'stop.js');
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zetro-hook-test-'));
const journalPath = path.join(tmpDataDir, 'journal.jsonl');
const mockConfigPath = path.join(tmpDataDir, 'agents.json');

const VALID_DECISION = '{"decision":"allow"}';
const agr1Id = 'f4881509-063a-4690-b5c4-985fd16cb39f';
fs.writeFileSync(mockConfigPath, JSON.stringify({ agents: { 'AGR-1': agr1Id } }), 'utf8');

function runHook(payloadStr, customConfig) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: payloadStr,
    encoding: 'utf8',
    env: { 
      ...process.env, 
      ZETRO_DATA_DIR: tmpDataDir,
      ZETRO_AGENTS_CONFIG: customConfig !== undefined ? customConfig : mockConfigPath
    }
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status
  };
}

fs.writeFileSync(journalPath, '{"existing":true}\n', 'utf8');

// Prove AGR-1 Filtering
const resIgnored = runHook(JSON.stringify({ conversationId: 'other', fullyIdle: true, executionNum: 1 }));
assert.equal(resIgnored.stdout.trim(), VALID_DECISION);
assert.equal(fs.readFileSync(journalPath, 'utf8').trim().split('\n').length, 1);
console.log('✓ [Evidence] AGR-1 filtering proved: non-AGR-1 conversation ignored safely.');

// Prove Event Journal outside source via ZETRO_DATA_DIR & Preexisting preservation
const payload1 = { conversationId: agr1Id, fullyIdle: true, terminationReason: 'stopped', executionNum: 1 };
const res1 = runHook(JSON.stringify(payload1));
assert.equal(res1.stdout.trim(), VALID_DECISION);
let lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n');
assert.equal(lines.length, 2);
let entry = JSON.parse(lines[1]);
assert.equal(JSON.parse(lines[0]).existing, true);
console.log('✓ [Evidence] Event journal outside source via ZETRO_DATA_DIR proved: tmpdir successfully targeted and preexisting data preserved.');

// Prove No taskId invention
assert.equal(entry.taskId, null);
console.log('✓ [Evidence] No taskId invention proved: taskId strictly null.');

// Prove malformed payload safe behavior
const payloadBadBool = { conversationId: agr1Id, fullyIdle: "true", terminationReason: 'stopped', executionNum: 1 };
const res3 = runHook(JSON.stringify(payloadBadBool));
assert.ok(res3.stderr.includes('fullyIdle must be boolean'));
assert.equal(res3.stdout.trim(), VALID_DECISION);

const payloadBadInt = { conversationId: agr1Id, fullyIdle: true, terminationReason: 'stopped', executionNum: "1" };
const res4 = runHook(JSON.stringify(payloadBadInt));
assert.ok(res4.stderr.includes('executionNum must be integer'));
assert.equal(res4.stdout.trim(), VALID_DECISION);

const res5 = runHook('{"invalid_json"');
assert.ok(res5.stderr.includes('Stop hook error:'));
assert.equal(res5.stdout.trim(), VALID_DECISION);

const largePayload = JSON.stringify({ a: 'a'.repeat(2 * 1024 * 1024) });
const res6 = runHook(largePayload);
assert.ok(res6.stderr.includes('Payload too large'));
assert.equal(res6.stdout.trim(), VALID_DECISION);

lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n');
assert.equal(lines.length, 2); // No new appends from malformed payloads

console.log('✓ [Evidence] Malformed payload safe behavior proved: type/bound validations catch errors, stderr is bounded, and decision string is safely returned.');

// Prove default localappdata usage when ZETRO_DATA_DIR is unset
const mockLocalAppData = path.join(tmpDataDir, 'mock_localappdata');
const envOverride = { ...process.env, ZETRO_AGENTS_CONFIG: mockConfigPath, LOCALAPPDATA: mockLocalAppData };
delete envOverride.ZETRO_DATA_DIR;

const res7 = spawnSync(process.execPath, [hookPath], {
  input: JSON.stringify(payload1),
  encoding: 'utf8',
  env: envOverride
});
assert.equal(res7.stdout.trim(), VALID_DECISION);
const defaultJournalPath = path.join(mockLocalAppData, 'Zetro', 'bridge', 'journal.jsonl');
assert.equal(fs.existsSync(defaultJournalPath), true, 'Must write to default LOCALAPPDATA\\Zetro\\bridge path');
console.log('✓ [Evidence] Live command default proved: writes journal to LOCALAPPDATA\\Zetro\\bridge when ZETRO_DATA_DIR is unset.');


// Prove eventId uniqueness across repeated executionNum=0
const payloadExec0 = { conversationId: agr1Id, fullyIdle: true, terminationReason: 'stopped', executionNum: 0 };
runHook(JSON.stringify(payloadExec0));
runHook(JSON.stringify(payloadExec0));
runHook(JSON.stringify(payloadExec0));
const allLines = fs.readFileSync(journalPath, 'utf8').trim().split('\n');
const stopEvents = allLines.filter(l => { try { return JSON.parse(l).eventId; } catch { return false; } });
const eventIds = stopEvents.map(l => JSON.parse(l).eventId);
const uniqueIds = new Set(eventIds);
assert.equal(uniqueIds.size, eventIds.length, `eventId collision detected: ${eventIds.join(', ')}`);
// Verify UUID format in eventId
for (const eid of eventIds) {
  assert.ok(/^stop-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(eid), `eventId not UUID format: ${eid}`);
}
console.log(`✓ [Evidence] eventId uniqueness proved: ${eventIds.length} events with executionNum=0, all unique UUIDs.`);

// Cleanup
fs.rmSync(tmpDataDir, { recursive: true, force: true });
console.log('All synthetic fixture tests passed.');
