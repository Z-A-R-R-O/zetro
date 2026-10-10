# @zetro/context-budget

Zero-dependency context packet engine to reduce tokens for AGR workers and coordinators. Uses content-addressed local artifact refs to deterministically compress and dedup context payloads, while strictly enforcing character budgets without truncating required fields. 

**Note on Shared Artifact Storage:** 
The `$ref` pointers rely on local file paths. Coordinators and AGR workers must share the exact same physical or mounted artifact storage directory to successfully resolve deduplicated packets.

## API & Example

```javascript
const { ContextEngine } = require('@zetro/context-budget');

const engine = new ContextEngine('./artifact-storage', 2000);

const packetData = {
  objective: 'Fix bug',
  acceptanceCriteria: 'Tests pass',
  permissions: ['fs.read'],
  blockers: [],
  context: {
    largeLog: '... huge string ...'
  }
};

// Will deduplicate largeLog using SHA-256 and output a ref if needed/seen before
const { packet, json } = engine.createPacket(packetData);

// Resolves $ref pointers back into raw content from local artifact storage
// Verifies SHA-256 hash integrity to prevent tampering
const resolved = engine.resolvePacket(packet);
```

## CLI Usage

The package provides a zero-dependency CLI that emits and consumes compact machine JSON. Since no root bin installation is guaranteed, it is recommended to invoke the CLI directly via node.

### Pack

Compresses an input JSON packet and saves large context payloads into the `--store` directory if they exceed the `--budget`.

```bash
node products/zetro/packages/context-budget/src/cli.js pack --input task.json --store ./artifacts --budget 2000
```

**Output:**
```json
{
  "packet": {
    "objective": "...",
    "acceptanceCriteria": "...",
    "permissions": [],
    "blockers": [],
    "context": {
      "largeLog": { "$ref": "abc123def456..." }
    }
  },
  "metrics": {
    "originalChars": 15000,
    "packetChars": 150,
    "savedChars": 14850
  }
}
```

### Resolve

Rehydrates a packed JSON packet, restoring the full context from the `--store` directory.

```bash
node products/zetro/packages/context-budget/src/cli.js resolve --packet packed-task.json --store ./artifacts
```

**Output:**
```json
{
  "resolved": {
    "objective": "...",
    "acceptanceCriteria": "...",
    "permissions": [],
    "blockers": [],
    "context": {
      "largeLog": "FULL ORIGINAL CONTENT"
    }
  }
}
```

### Exit Codes

- `0`: Success
- `1`: Error (Outputs JSON with `"error"` and `"code"`, e.g., `"code": "BUDGET_EXCEEDED"`, `"INVALID_ARGS"`)
