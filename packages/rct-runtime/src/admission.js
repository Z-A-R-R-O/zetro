import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_VERSION = 'rct.assignment.v1';

const SUPPORTED_CHECK_PROFILES = ['equals', 'contains'];

const SUPPORTED_DATA_CLASSIFICATIONS = ['public', 'internal', 'sensitive'];

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function rejectIf(condition, reason, details = {}) {
  if (condition) return { accepted: false, reason, ...details };
  return null;
}

function validateRelativePath(value) {
  if (typeof value !== 'string' || !value) return { ok: false, reason: 'empty or non-string path' };
  if (value.includes('\0')) return { ok: false, reason: 'null byte in path' };
  if (value.includes('\\')) return { ok: false, reason: 'backslash in path' };
  const segments = value.split('/');
  if (path.posix.isAbsolute(value)) return { ok: false, reason: 'absolute path' };
  for (const seg of segments) {
    if (!seg) return { ok: false, reason: 'empty segment' };
    if (seg === '.' || seg === '..') return { ok: false, reason: 'traversal segment: ' + seg };
    if (seg.startsWith('.')) return { ok: false, reason: 'hidden path segment: ' + seg };
    if (seg.includes(':')) return { ok: false, reason: 'colon in path segment' };
  }
  return { ok: true, canonical: segments.join('/') };
}

async function checkScopedPath(rootReal, relative, allowMissing) {
  let current = rootReal;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (err) {
      if (err.code === 'ENOENT' && allowMissing) return null;
      return { path: relative, reason: err.code === 'ENOENT' ? 'path does not exist' : `path is not accessible: ${err.code ?? err.message}` };
    }
    if (stat.isSymbolicLink()) return { path: relative, reason: 'symlink or junction detected' };
  }
  try {
    const resolved = await realpath(current);
    const diff = path.relative(rootReal, resolved);
    if (diff === '..' || diff.startsWith(`..${path.sep}`) || path.isAbsolute(diff)) {
      return { path: relative, reason: 'path resolves outside source.root' };
    }
  } catch (err) {
    return { path: relative, reason: `path is not accessible: ${err.code ?? err.message}` };
  }
  return null;
}

function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false, reason: `${label}: ${value} not in [${min}, ${max}]` };
  return { ok: true, value };
}

export async function admitAssignment(manifestPath) {
  // Read and parse manifest
  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    return { accepted: false, reason: `Cannot read manifest: ${err.message}` };
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { accepted: false, reason: 'Manifest is not valid JSON' };
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { accepted: false, reason: 'Manifest must be a JSON object' };
  }

  // Schema version
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    return { accepted: false, reason: `Unsupported schemaVersion: expected '${SCHEMA_VERSION}', got '${manifest.schemaVersion}'` };
  }

  // Task identity
  if (typeof manifest.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(manifest.taskId)) {
    return { accepted: false, reason: 'Invalid or missing taskId (1-64 alphanumeric/dash/underscore)' };
  }

  // Objective and acceptance
  if (typeof manifest.objective !== 'string' || manifest.objective.length < 3 || manifest.objective.length > 2000) {
    return { accepted: false, reason: 'Invalid objective (string, 3-2000 chars)' };
  }
  if (!Array.isArray(manifest.acceptance) || manifest.acceptance.length < 1 || manifest.acceptance.length > 20) {
    return { accepted: false, reason: 'acceptance must be a non-empty array (1-20 entries)' };
  }
  for (const a of manifest.acceptance) {
    if (typeof a !== 'string' || a.length < 3 || a.length > 2000) {
      return { accepted: false, reason: `Invalid acceptance entry: ${JSON.stringify(a)?.slice(0, 100)}` };
    }
  }

  // Source root
  if (!manifest.source || typeof manifest.source !== 'object') {
    return { accepted: false, reason: 'Missing or invalid source object' };
  }
  if (typeof manifest.source.root !== 'string' || !manifest.source.root) {
    return { accepted: false, reason: 'Missing source.root' };
  }
  const sourceRoot = path.resolve(manifest.source.root);
  // Reject filesystem roots
  const rootParsed = path.parse(sourceRoot);
  if (sourceRoot === rootParsed.root || sourceRoot.length <= 3) {
    return { accepted: false, reason: 'source.root must not be a filesystem root' };
  }
  let sourceRootReal;
  try {
    const rootStat = await lstat(sourceRoot);
    if (rootStat.isSymbolicLink()) return { accepted: false, reason: 'source.root must not be a symlink or junction' };
    if (!rootStat.isDirectory()) return { accepted: false, reason: 'source.root must be a directory' };
    sourceRootReal = await realpath(sourceRoot);
  } catch (err) {
    return { accepted: false, reason: `source.root is not accessible: ${err.code ?? err.message}` };
  }

  // Scope
  if (!manifest.scope || typeof manifest.scope !== 'object') {
    return { accepted: false, reason: 'Missing or invalid scope object' };
  }
  const readPaths = [];
  const writePaths = [];
  const createPaths = [];
  const pathErrors = [];

  for (const [key, arr, target] of [
    ['scope.readPaths', manifest.scope.readPaths, readPaths],
    ['scope.writePaths', manifest.scope.writePaths, writePaths],
    ['scope.createPaths', manifest.scope.createPaths ?? [], createPaths]
  ]) {
    if (!Array.isArray(arr)) {
      return { accepted: false, reason: `${key} must be an array` };
    }
    for (const p of arr) {
      const result = validateRelativePath(p);
      if (!result.ok) {
        pathErrors.push({ field: key, path: p, reason: result.reason });
      } else {
        target.push(result.canonical);
      }
    }
  }

  if (pathErrors.length > 0) {
    return { accepted: false, reason: 'Invalid paths in scope', pathErrors };
  }

  if (readPaths.length === 0 && writePaths.length === 0) {
    return { accepted: false, reason: 'Scope must include at least one readPath or writePath' };
  }

  // Existing reads/writes must exist; only createPaths may name new files.
  const scopeErrors = [];
  for (const p of [...readPaths, ...writePaths]) {
    const error = await checkScopedPath(sourceRootReal, p, false);
    if (error) scopeErrors.push(error);
  }
  for (const p of createPaths) {
    const error = await checkScopedPath(sourceRootReal, p, true);
    if (error) scopeErrors.push(error);
  }
  if (scopeErrors.length > 0) {
    return { accepted: false, reason: 'Scope path is missing, inaccessible, or unsafe', scopeErrors };
  }

  // Data policy
  if (!manifest.dataPolicy || typeof manifest.dataPolicy !== 'object') {
    return { accepted: false, reason: 'Missing or invalid dataPolicy object' };
  }
  const dp = manifest.dataPolicy;
  if (!SUPPORTED_DATA_CLASSIFICATIONS.includes(dp.classification)) {
    return { accepted: false, reason: `Unsupported data classification: '${dp.classification}'. Supported: ${SUPPORTED_DATA_CLASSIFICATIONS.join(', ')}` };
  }
  const remoteInferencePermitted = dp.allowRemoteInference === true;
  if (dp.classification === 'sensitive' && remoteInferencePermitted) {
    return { accepted: false, reason: 'Remote inference is not permitted for sensitive data classification' };
  }
  // Private-source remote use requires explicit allow flag
  if (dp.classification !== 'public' && remoteInferencePermitted !== true && dp.allowRemoteInference !== false) {
    return { accepted: false, reason: 'Non-public data requires explicit allowRemoteInference: true or false' };
  }

  // Checks
  if (!Array.isArray(manifest.checks) || manifest.checks.length < 1 || manifest.checks.length > 20) {
    return { accepted: false, reason: 'At least one independent check is required (1-20)' };
  }
  const allScopePaths = new Set([...readPaths, ...writePaths, ...createPaths]);
  const checkProfiles = [];
  for (const check of manifest.checks) {
    if (!check || typeof check !== 'object') {
      return { accepted: false, reason: 'Invalid check entry' };
    }
    if (!SUPPORTED_CHECK_PROFILES.includes(check.type)) {
      return { accepted: false, reason: `Unsupported check profile: '${check.type}'. Supported: ${SUPPORTED_CHECK_PROFILES.join(', ')}` };
    }
    if (typeof check.text !== 'string' || check.text.length > 4096) {
      return { accepted: false, reason: 'Check text must be a string under 4096 chars' };
    }
    const pathResult = validateRelativePath(check.path);
    if (!pathResult.ok) {
      return { accepted: false, reason: `Invalid check path: ${pathResult.reason}` };
    }
    if (!allScopePaths.has(pathResult.canonical)) {
      return { accepted: false, reason: `Check path '${pathResult.canonical}' is outside declared scope` };
    }
    checkProfiles.push({ type: check.type, path: pathResult.canonical });
  }

  // Budget
  const budget = manifest.budget ?? {};
  const budgetErrors = [];
  const budgetResult = {};
  for (const [key, def, min, max] of [
    ['maxTurns', 6, 1, 20],
    ['maxInputTokens', 6000, 100, 100000],
    ['maxOutputTokens', 3000, 100, 100000],
    ['maxPromptChars', 16000, 500, 100000],
    ['maxReadBytes', 8192, 1, 65536],
    ['maxWriteBytes', 8192, 1, 65536],
    ['maxWallMs', 30000, 100, 300000]
  ]) {
    const val = budget[key] ?? def;
    const check = integer(val, key, min, max);
    if (!check.ok) budgetErrors.push(check.reason);
    else budgetResult[key] = check.value;
  }
  if (budgetErrors.length > 0) {
    return { accepted: false, reason: 'Invalid budget', budgetErrors };
  }

  // All validations passed — produce the dry-run plan
  const plan = {
    accepted: true,
    schemaVersion: SCHEMA_VERSION,
    taskId: manifest.taskId,
    manifestHash: sha256(raw),
    sourceRoot: sourceRootReal,
    scope: {
      readPaths: [...new Set(readPaths)].sort(),
      writePaths: [...new Set(writePaths)].sort(),
      createPaths: [...new Set(createPaths)].sort()
    },
    checkProfiles,
    dataPolicy: {
      classification: dp.classification,
      remoteInferencePermitted,
      provider: typeof dp.provider === 'string' ? dp.provider : null,
      model: typeof dp.model === 'string' ? dp.model : null
    },
    budget: budgetResult,
    estimatedResourceCeilings: {
      maxSourceBytesRead: budgetResult.maxReadBytes,
      maxSourceBytesWritten: budgetResult.maxWriteBytes,
      maxModelTurns: budgetResult.maxTurns,
      maxWallTimeMs: budgetResult.maxWallMs,
      maxInputTokens: budgetResult.maxInputTokens,
      maxOutputTokens: budgetResult.maxOutputTokens
    },
    dryRun: true,
    networkCallsMade: 0,
    sourceEdited: false
  };

  return plan;
}
