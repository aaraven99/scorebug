'use strict';

// This starts the real application; it does not mock Electron or bypass its sandbox.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const packagedExecutable = process.env.SCOREBUG_SMOKE_EXECUTABLE;
const executable = packagedExecutable || require('electron');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'scorebug-smoke-'));
const child = spawn(executable, packagedExecutable ? ['--smoke-test'] : ['.', '--smoke-test'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, SCOREBUG_SMOKE_USER_DATA: userData, SCOREBUG_VERIFY_PACKAGE: packagedExecutable ? '1' : '0',
    SCOREBUG_SMOKE_EVIDENCE: path.join(__dirname, 'release', packagedExecutable ? 'smoke-packaged' : 'smoke') }
});
let timedOut = false;
let finished = false;

function cleanUp(code) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch { console.warn('[native smoke] Temporary profile cleanup deferred to the runner.'); }
  process.exitCode = timedOut ? 1 : (code ?? 1);
}

const deadline = setTimeout(() => {
  timedOut = true;
  console.error('[native smoke] FAIL: Electron exceeded the 165-second runtime limit.');
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'inherit' });
    killer.on('error', () => child.kill('SIGKILL'));
  } else child.kill('SIGKILL');
}, 165000);

child.on('error', (error) => { console.error(`[native smoke] Could not launch Electron: ${error.message}`); cleanUp(1); });
child.on('close', (code) => cleanUp(code));
