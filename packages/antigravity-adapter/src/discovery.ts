import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export interface Endpoint {
  address: string;
  csrfToken: string;
  source: 'sidecar-env' | 'windows-process';
  pid?: number;
}

// Only the bundled agentapi executable receives these credentials. They are never
// written to disk, included in errors, or forwarded to a ZETRO client.
const WINDOWS_DISCOVERY = String.raw`
$ErrorActionPreference = 'Stop'
$rows = @()
$servers = Get-CimInstance Win32_Process -Filter "Name='language_server.exe'"
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
foreach ($server in $servers) {
  if ($server.ExecutablePath -notmatch '(?i)\\antigravity\\resources\\bin\\language_server\.exe$') { continue }
  $match = [regex]::Match($server.CommandLine, '--csrf_token(?:=|\s+)([^\s]+)')
  if (-not $match.Success) { continue }
  $token = $match.Groups[1].Value.Trim('"')
  foreach ($listener in $listeners) {
    if ($listener.OwningProcess -ne $server.ProcessId) { continue }
    if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) { continue }
    $rows += [pscustomobject]@{
      address = "127.0.0.1:$($listener.LocalPort)"
      csrfToken = $token
      pid = $server.ProcessId
    }
  }
}
ConvertTo-Json -InputObject @($rows) -Compress -Depth 3
`;

export async function discoverEndpoints(): Promise<Endpoint[]> {
  const address = process.env.ANTIGRAVITY_LS_ADDRESS;
  const token = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (address || token) {
    if (!address || !token) throw new Error('Both Antigravity sidecar environment variables are required');
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(address)) {
      throw new Error('Antigravity sidecar address must be loopback');
    }
    return [{ address, csrfToken: token, source: 'sidecar-env' }];
  }
  if (process.platform !== 'win32') {
    throw new Error('Outside an Antigravity sidecar, automatic discovery currently supports Windows only');
  }
  const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_DISCOVERY], {
    timeout: 8000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(stdout.trim() || '[]');
  if (!Array.isArray(parsed)) throw new Error('Invalid Antigravity discovery response');
  const endpoints: Endpoint[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.address !== 'string' || typeof row.csrfToken !== 'string') continue;
    if (!/^127\.0\.0\.1:\d+$/.test(row.address) || !row.csrfToken) continue;
    endpoints.push({
      address: row.address,
      csrfToken: row.csrfToken,
      source: 'windows-process',
      pid: typeof row.pid === 'number' ? row.pid : undefined,
    });
  }
  return endpoints.sort((a, b) => Number(b.address.split(':').at(-1)) - Number(a.address.split(':').at(-1)));
}
