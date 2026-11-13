/**
 * Stops local dev servers on the ports this project uses.
 *
 * Windows: netstat + taskkill. macOS/Linux: lsof + kill.
 * Useful after a terminal was closed without Ctrl+C, which can leave
 * `next dev` and the mock upstreams running in the background.
 */
import { execFileSync } from 'node:child_process';

const DEV_PORTS = [3000, 4100];

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function listWindowsPids(port) {
  const output = run('netstat', ['-ano']);
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    const columns = line.trim().split(/\s+/);
    const localAddress = columns[1] ?? '';
    const pid = columns[columns.length - 1] ?? '';
    if (localAddress.endsWith(`:${port}`) && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }
  return [...pids];
}

function listUnixPids(port) {
  try {
    const output = run('lsof', ['-ti', `:${port}`]);
    return output
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value));
  } catch {
    return [];
  }
}

function stopPid(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    } else {
      execFileSync('kill', ['-9', pid], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

let stopped = 0;

for (const port of DEV_PORTS) {
  const pids = process.platform === 'win32' ? listWindowsPids(port) : listUnixPids(port);
  if (pids.length === 0) {
    process.stdout.write(`Port ${port}: nothing listening.\n`);
    continue;
  }
  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    const wasStopped = stopPid(pid);
    stopped += wasStopped ? 1 : 0;
    process.stdout.write(
      `Port ${port}: PID ${pid} ${wasStopped ? 'stopped' : 'could not be stopped'}.\n`,
    );
  }
}

process.stdout.write(
  stopped > 0
    ? `\nStopped ${stopped} process(es). Next.js lock files are released automatically.\n`
    : '\nNothing needed stopping.\n',
);
