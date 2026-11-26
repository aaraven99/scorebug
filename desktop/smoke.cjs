'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(label, probe, timeout = 10000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try { if (await probe()) return; } catch (error) { lastError = error; }
    await pause(100);
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

async function windowsWindowStyles(win) {
  const buffer = win.getNativeWindowHandle();
  const handle = buffer.length >= 8 ? buffer.readBigUInt64LE().toString() : String(buffer.readUInt32LE());
  // Query the actual HWND, so the frameless check observes Windows state rather
  // than simply asserting the constructor options that our code passed in.
  const source = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ScorebugWindowStyle {
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
}
'@
$hwnd = [IntPtr]::new([long]'${handle}')
$style = [ScorebugWindowStyle]::GetWindowLongPtr($hwnd, -16).ToInt64()
$extendedStyle = [ScorebugWindowStyle]::GetWindowLongPtr($hwnd, -20).ToInt64()
@{ caption = (($style -band 0x00C00000) -ne 0); topmost = (($extendedStyle -band 0x00000008) -ne 0) } | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], {
    windowsHide: true,
    timeout: 10000
  });
  return JSON.parse(stdout.trim());
}

async function runNativeSmoke({ widget, screen, origin, getSettings, getDetails, preferencesPath }) {
  const evidenceDir = path.join(__dirname, 'release', 'smoke');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const summary = { passed: false, platform: process.platform, electron: process.versions.electron, feedRequired: false, checks: [] };
  let deadline;
  const check = (name) => { summary.checks.push(name); console.log(`[native smoke] PASS: ${name}`); };
  const evaluate = (code) => widget.webContents.executeJavaScript(code, true);
  try {
    await Promise.race([
      (async () => {
        await waitFor('Widget renderer and preload', () => evaluate(`Boolean(
          document.querySelector('#widget-root .widget-toolbar') &&
          document.querySelector('#widget-root .widget-board') &&
          window.scorebugDesktop?.getState && document.body.dataset.desktop === 'true'
        )`), 18000);
        assert.equal(new URL(widget.webContents.getURL()).origin, origin);
        const state = await evaluate('window.scorebugDesktop.getState()');
        assert.equal(state.preferences.team, 'CHI');
        assert.equal(state.preferences.anchor, 'bottom-center');
        assert.equal(await evaluate('typeof window.require'), 'undefined');
        assert.equal(await evaluate('typeof window.process'), 'undefined');
        check('Real widget DOM, isolated preload and validated getState IPC');

        assert.equal(widget.isAlwaysOnTop(), true);
        assert.equal(widget.isResizable(), false);
        // The getter omits alpha; the capture below verifies actual transparency.
        assert.equal(widget.getBackgroundColor().toLowerCase(), '#000000');
        const bounds = widget.getBounds();
        const content = widget.getContentBounds();
        for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(bounds[key] - content[key]) <= 2, `Unexpected window frame ${key}`);
        if (process.platform === 'win32') {
          const native = await windowsWindowStyles(widget);
          assert.equal(native.caption, false, 'Windows HWND still has a caption');
          assert.equal(native.topmost, true, 'Windows HWND is not topmost');
          assert.equal(widget.isWindowMessageHooked(0x0231), true);
          assert.equal(widget.isWindowMessageHooked(0x0232), true);
        }
        const capture = await widget.webContents.capturePage();
        assert.ok(!capture.isEmpty(), 'Widget capture is empty');
        assert.equal(capture.toBitmap()[3], 0, 'Transparent corner should have zero alpha');
        fs.writeFileSync(path.join(evidenceDir, 'native-widget.png'), capture.toPNG());
        check('Native frameless, transparent, always-on-top window and drag-release hooks');

        const anchors = [
          ['top-left', 0, 0], ['top-center', 0.5, 0], ['top-right', 1, 0],
          ['middle-left', 0, 0.5], ['center', 0.5, 0.5], ['middle-right', 1, 0.5],
          ['bottom-left', 0, 1], ['bottom-center', 0.5, 1], ['bottom-right', 1, 1]
        ];
        for (const [anchor, horizontal, vertical] of anchors) {
          await evaluate(`window.scorebugDesktop.setPreferences(${JSON.stringify({ anchor, scale: 1, locked: false })})`);
          await pause(160);
          const actual = widget.getBounds();
          const area = screen.getDisplayMatching(actual).workArea;
          const xGap = Math.min(16, (area.width - actual.width) / 2);
          const yGap = Math.min(16, (area.height - actual.height) / 2);
          const x = area.x + xGap + horizontal * (area.width - actual.width - 2 * xGap);
          const y = area.y + yGap + vertical * (area.height - actual.height - 2 * yGap);
          assert.ok(Math.abs(actual.x - x) <= 2, `${anchor}: incorrect native x`);
          assert.ok(Math.abs(actual.y - y) <= 2, `${anchor}: incorrect native y`);
          const positioned = await evaluate('window.scorebugDesktop.getState()');
          assert.equal(positioned.anchor, anchor);
          const expectedOrientation = anchor === 'middle-left' || anchor === 'middle-right' ? 'vertical' : 'horizontal';
          assert.equal(positioned.preferences.orientation, expectedOrientation);
          assert.equal(actual.height > actual.width, expectedOrientation === 'vertical');
        }
        check('All nine native anchors work; side anchors become vertical and other anchors stay horizontal');

        await evaluate('window.scorebugDesktop.setPreferences({ locked: true })');
        await waitFor('Locked state in the renderer', () => evaluate(`document.body.dataset.locked === 'true' && document.documentElement.dataset.desktopLocked === 'true'`), 3000);
        assert.equal((await evaluate('window.scorebugDesktop.getState()')).locked, true);
        if (process.platform === 'win32' || process.platform === 'darwin') assert.equal(widget.isMovable(), false);
        assert.equal(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).locked, true);
        await evaluate('window.scorebugDesktop.setPreferences({ locked: false, anchor: "bottom-center" })');
        if (process.platform === 'win32' || process.platform === 'darwin') assert.equal(widget.isMovable(), true);
        check('Lock changes reach the OS, renderer, IPC state and persistent preferences');

        await evaluate('window.scorebugDesktop.openSettings()');
        await waitFor('Native settings page', async () => {
          const settings = getSettings();
          return settings && !settings.isDestroyed() && await settings.webContents.executeJavaScript(`Boolean(document.querySelector('#game-select') && window.scorebugDesktop?.getState && !document.querySelector('#desktop-controls').hidden)`);
        }, 8000);
        const settingsState = await getSettings().webContents.executeJavaScript('window.scorebugDesktop.getState()');
        assert.equal(settingsState.preferences.anchor, 'bottom-center');
        getSettings().close();
        check('Settings opens with the same native preference state');

        await evaluate('window.scorebugDesktop.setPreferences({ anchor: "middle-left" })');
        await pause(180);
        const beforeDetails = widget.getBounds();
        await evaluate('window.scorebugDesktop.showDetails()');
        await waitFor('Native game-details page', async () => {
          const panel = getDetails();
          return panel && !panel.isDestroyed() && panel.isVisible() && await panel.webContents.executeJavaScript(`Boolean(window.scorebugDesktop?.getState && document.body.childElementCount)`);
        }, 8000);
        const panel = getDetails();
        assert.equal(new URL(panel.webContents.getURL()).pathname, '/details.html');
        assert.equal(panel.isAlwaysOnTop(), true);
        assert.deepEqual(widget.getBounds(), beforeDetails, 'Opening details moved or resized the scorebug');
        const panelBounds = panel.getBounds();
        const panelArea = screen.getDisplayMatching(panelBounds).workArea;
        assert.ok(panelBounds.x >= beforeDetails.x + beforeDetails.width, 'Left-side details should open inward');
        assert.ok(panelBounds.x >= panelArea.x && panelBounds.y >= panelArea.y);
        assert.ok(panelBounds.x + panelBounds.width <= panelArea.x + panelArea.width);
        assert.ok(panelBounds.y + panelBounds.height <= panelArea.y + panelArea.height);
        const detailState = await panel.webContents.executeJavaScript('window.scorebugDesktop.getState()');
        assert.equal(detailState.preferences.orientation, 'vertical');
        assert.equal(detailState.detailsVisible, true);
        fs.writeFileSync(path.join(evidenceDir, 'native-details.png'), (await panel.webContents.capturePage()).toPNG());
        await evaluate('window.scorebugDesktop.hideDetails()');
        await waitFor('Destroyed details renderer', () => !getDetails(), 3000);
        assert.deepEqual(widget.getBounds(), beforeDetails, 'Closing details moved or resized the scorebug');
        await evaluate('window.scorebugDesktop.setPreferences({ anchor: "bottom-center" })');
        check('Details opens inward without moving the scorebug, shares validated IPC, and destroys its renderer on dismissal');
        summary.passed = true;
      })(),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Native integration checks exceeded 35 seconds')), 35000); })
    ]);
  } catch (error) {
    summary.error = error.stack || String(error);
    throw error;
  } finally {
    clearTimeout(deadline);
    fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`[native smoke] ${summary.passed ? 'SUCCESS' : 'FAILED'}: ${summary.checks.length} integration groups checked. ESPN availability does not gate this test.`);
  }
}

module.exports = { runNativeSmoke };
