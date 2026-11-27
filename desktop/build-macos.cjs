'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') throw new Error('Build the Mac application on macOS.');
const output = path.join(__dirname, 'native', 'bin', 'mac-mouse-release');
fs.mkdirSync(path.dirname(output), { recursive: true });
// A universal helper also works when a developer deliberately cross-builds an
// Apple Silicon app on Intel or an Intel app on Apple Silicon.
execFileSync('xcrun', ['clang', '-O2', '-Wall', '-Wextra', '-Werror', '-arch', 'arm64', '-arch', 'x86_64',
  '-mmacosx-version-min=13.0', path.join(__dirname, 'native', 'mac-mouse-release.c'),
  '-framework', 'ApplicationServices', '-o', output], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--sign', '-', output], { stdio: 'inherit' });
execFileSync(output, ['--probe'], { stdio: 'inherit', timeout: 3000 });
console.log('Built the Mac drag-release helper for Apple Silicon and Intel.');
