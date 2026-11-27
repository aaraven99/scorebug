'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { scorebugHitBounds, teamPanelBounds, teamAtPoint, detailsWindowShape, DETAILS_SIZE, COMPARISON_DETAILS_SIZE, containsPoint } = require('./geometry.cjs');
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

async function windowsMoveAndRelease(win, { x, y }) {
  const buffer = win.getNativeWindowHandle();
  const handle = buffer.length >= 8 ? buffer.readBigUInt64LE().toString() : String(buffer.readUInt32LE());
  // Exercise the actual HWND message hooks and resulting move events. Calling
  // setPreferences({anchor}) alone never tests release-to-snap behavior.
  const source = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ScorebugWindowMove {
  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
}

'@
$hwnd = [IntPtr]::new([long]'${handle}')
[void][ScorebugWindowMove]::SendMessage($hwnd, 0x0231, [IntPtr]::Zero, [IntPtr]::Zero)
try {
  if (-not [ScorebugWindowMove]::SetWindowPos($hwnd, [IntPtr]::Zero, ${Math.round(x)}, ${Math.round(y)}, 0, 0, 0x0015)) {
    throw 'SetWindowPos failed during the release-to-snap check'
  }
} finally {
  [void][ScorebugWindowMove]::SendMessage($hwnd, 0x0232, [IntPtr]::Zero, [IntPtr]::Zero)
}
`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], {
    windowsHide: true,
    timeout: 10000
  });
}

function nativeHandle(win) {
  const buffer = win.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigUInt64LE().toString() : String(buffer.readUInt32LE());
}

async function windowsRootAtPoint(point) {
  const source = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ScorebugWindowHit {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
}
'@
[void][ScorebugWindowHit]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
$point = [ScorebugWindowHit+Point]::new()
$point.X = ${Math.round(point.x)}
$point.Y = ${Math.round(point.y)}
$hit = [ScorebugWindowHit]::WindowFromPoint($point)
[ScorebugWindowHit]::GetAncestor($hit, 2).ToInt64().ToString()
`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { windowsHide: true, timeout: 10000 });
  return stdout.trim();
}

async function runNativeSmoke({ widget, screen, origin, getSettings, getDetails, getGameCenter, preferencesPath }) {
  const evidenceDir = path.join(__dirname, 'release', 'smoke');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const summary = { passed: false, platform: process.platform, electron: process.versions.electron, feedRequired: false, checks: [] };
  let deadline;
  const check = (name) => { summary.checks.push(name); console.log(`[native smoke] PASS: ${name}`); };
  const evaluate = (code) => widget.webContents.executeJavaScript(code, true);
  const readScorebugLayout = (options = {}) => evaluate(`(async () => {
    const [{ renderScorebug }, { referenceGame }] = await Promise.all([import('/scorebug.js'), import('/fixtures.js')]);
    const board = document.querySelector('.widget-board');
    const saved = [...board.childNodes];
    try {
      // Measure the actual SVG/CSS without depending on a live NFL response.
      // Keep the real runtime's alignment and orientation in this window.
      board.innerHTML = renderScorebug(referenceGame, {
        orientation: document.body.dataset.orientation,
        statusPosition: document.body.dataset.contentAlignment === 'top' ? 'below' : 'above',
        ...${JSON.stringify(options)}
      });
      const svg = board.querySelector('.scorebug');
      const matrix = svg.getScreenCTM();
      const origin = new DOMPoint(0, 0).matrixTransform(matrix);
      const rect = (element) => element?.getBoundingClientRect().toJSON() || null;
      return {
        origin: { x: origin.x, y: origin.y }, factor: matrix.a,
        alignment: document.body.dataset.contentAlignment,
        svg: rect(svg), toolbar: rect(document.querySelector('.widget-toolbar')),
        settings: rect(document.querySelector('.widget-toolbar [aria-label="Open scorebug settings"]')),
        badge: rect(svg.querySelector('.bug-status-flag')),
        away: rect(svg.querySelector('.bug-team--away .bug-team-panel')),
        home: rect(svg.querySelector('.bug-team--home .bug-team-panel'))
      };
    } finally { board.replaceChildren(...saved); }
  })()`);
  const readDragRegions = () => evaluate(`(() => {
    const existing = document.querySelector('.widget-board .bug-team');
    let probe;
    if (!existing) {
      // Keep this check independent of whether ESPN has returned a game yet.
      probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      probe.innerHTML = '<g class="bug-team"><g class="bug-details-target" data-details-side="away" role="button"><path d="M0 0h20v20H0Z"/></g></g>';
      document.querySelector('.widget-board').append(probe);
    }
    const region = (element) => getComputedStyle(element).getPropertyValue('app-region') || getComputedStyle(element).getPropertyValue('-webkit-app-region');
    const result = {
      team: region(existing || probe.firstElementChild),
      target: region((existing || probe.firstElementChild).querySelector('[data-details-side]')),
      toolbar: region(document.querySelector('.widget-toolbar button'))
    };
    probe?.remove();
    return result;
  })()`);
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
        assert.equal(state.preferences.team, null);
        assert.equal(state.preferences.gameId, null);
        assert.equal(state.preferences.date, null);
        assert.equal(state.preferences.anchor, 'bottom-center');
        assert.equal(await evaluate('typeof window.require'), 'undefined');
        assert.equal(await evaluate('typeof window.process'), 'undefined');
        check('Real widget DOM, isolated preload and validated getState IPC');
        await evaluate('window.scorebugDesktop.setPreferences({ gameId: "fox-11284" })');
        assert.equal(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).gameId, 'fox-11284');
        await assert.rejects(() => evaluate('window.scorebugDesktop.setPreferences({ gameId: "fox-../11284" })'));
        await evaluate('window.scorebugDesktop.setPreferences({ gameId: null, date: null, team: null })');
        assert.equal((await evaluate('window.scorebugDesktop.getState()')).preferences.gameId, null);
        check('An independent-provider game can stay pinned, and Automatic clears the pin');
        const updateState = await evaluate('window.scorebugDesktop.getUpdateState()');
        assert.equal(updateState.mode, 'development');
        assert.equal(updateState.currentVersion, require('./package.json').version);
        assert.equal(updateState.automatic, true);
        assert.equal((await evaluate('window.scorebugDesktop.checkForUpdates()')).status, 'idle');
        assert.equal((await evaluate('window.scorebugDesktop.restartToUpdate()')).status, 'idle');
        await evaluate('window.__observedUpdateState = null; window.scorebugDesktop.onUpdateStateChanged((value) => { window.__observedUpdateState = value; }); void 0;');
        await evaluate('window.scorebugDesktop.setAutomaticUpdates(false)');
        await waitFor('Update preference event reaches the preload', () => evaluate('window.__observedUpdateState?.automatic === false'), 3000);
        assert.equal(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).autoUpdates, false);
        await assert.rejects(() => evaluate('window.scorebugDesktop.setAutomaticUpdates("yes")'));
        await evaluate('window.scorebugDesktop.setAutomaticUpdates(true)');
        assert.equal(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).autoUpdates, true);
        assert.ok(!Object.keys(require.cache).some((entry) => /electron-updater[\\/]out[\\/]main\.js$/.test(entry)), 'A development smoke run must not load the live updater');
        check('Updater preload actions, persistent preferences and events work without checking or installing updates during development');
        if (process.platform === 'win32') {
          // A passive startup/show move must not enter the non-Windows free-move
          // debounce and erase the anchor after the renderer has initialized.
          widget.emit('move');
          await pause(450);
          assert.equal((await evaluate('window.scorebugDesktop.getState()')).preferences.anchor, 'bottom-center');
          assert.equal(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).anchor, 'bottom-center');
          check('Passive Windows move notifications preserve the startup anchor');
        }
        assert.deepEqual(await readDragRegions(), { team: 'drag', target: 'drag', toolbar: 'no-drag' });
        check('Colored team panels remain native drag targets while toolbar buttons stay clickable');

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
          const y = vertical === 0 ? area.y : area.y + yGap + vertical * (area.height - actual.height - 2 * yGap);
          assert.ok(Math.abs(actual.x - x) <= 2, `${anchor}: incorrect native x`);
          assert.ok(Math.abs(actual.y - y) <= 2, `${anchor}: incorrect native y`);
          const positioned = await evaluate('window.scorebugDesktop.getState()');
          assert.equal(positioned.anchor, anchor);
          const expectedOrientation = anchor === 'middle-left' || anchor === 'middle-right' ? 'vertical' : 'horizontal';
          assert.equal(positioned.preferences.orientation, expectedOrientation);
          assert.equal(positioned.preferences.contentAlignment, vertical === 0 ? 'top' : 'bottom');
          assert.equal(actual.height > actual.width, expectedOrientation === 'vertical');
        }
        check('All nine native anchors work; side anchors become vertical and other anchors stay horizontal');

        for (const scale of [0.65, 1, 1.8]) {
          await evaluate(`window.scorebugDesktop.setPreferences({ anchor: "top-center", scale: ${scale} })`);
          const actual = widget.getBounds();
          await waitFor('Top layout and resized viewport reach the renderer', () => evaluate(`document.body.dataset.contentAlignment === "top" && innerWidth === ${actual.width} && innerHeight === ${actual.height}`), 3000);
          const area = screen.getDisplayMatching(actual).workArea;
          const expected = scorebugHitBounds(actual, 'horizontal', 'top');
          let fresh;
          for (const options of [{}, { stale: true }, { demo: true }, {}]) {
            const layout = await readScorebugLayout(options);
            fresh ||= layout;
            assert.equal(layout.alignment, 'top');
            assert.ok(Math.abs(actual.y + layout.origin.y - expected.y) < 0.51, 'Native hits and rendered panel origin disagree');
            assert.ok(Math.abs(layout.factor * 600 - expected.width) < 0.51);
            assert.ok(Math.abs(layout.origin.y - fresh.origin.y) < 0.1, 'A status badge moved the panels');
            assert.ok(actual.y + layout.away.y >= area.y + 8 && actual.y + layout.away.y <= area.y + 16, 'Visible scoreboard is too far below the top edge');
            assert.ok(layout.toolbar.y >= layout.svg.bottom + 2, 'Below-board controls overlap the scoreboard or status badge');
            assert.ok(layout.toolbar.x >= 0 && layout.toolbar.right <= actual.width);
            assert.ok(actual.y + layout.toolbar.bottom <= area.y + area.height);
            for (const side of ['home', 'away']) {
              const panel = teamPanelBounds(actual, 'horizontal', side, 'top');
              assert.ok(Math.abs(actual.y + layout[side].y - panel.y) < 0.51, 'Blade edge and SVG edge disagree');
              assert.equal(teamAtPoint(actual, { x: actual.x + layout[side].x + layout[side].width / 2, y: actual.y + layout[side].y + layout[side].height / 2 }, 'horizontal', 'top'), side);
            }
          }
          const beforeFree = widget.getBounds();
          await evaluate('window.scorebugDesktop.setPreferences({ anchor: null })');
          assert.deepEqual(widget.getBounds(), beforeFree, 'Leaving a top anchor moved the free window');
          assert.equal((await evaluate('window.scorebugDesktop.getState()')).preferences.contentAlignment, 'top');
          assert.equal(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).contentAlignment, 'top');
        }
        await evaluate('window.scorebugDesktop.setPreferences({ anchor: "bottom-center", scale: 1 })');
        const bottomBounds = widget.getBounds();
        await waitFor('Bottom layout and resized viewport are restored', () => evaluate(`document.body.dataset.contentAlignment === "bottom" && innerWidth === ${bottomBounds.width} && innerHeight === ${bottomBounds.height}`), 3000);
        const bottomLayout = await readScorebugLayout();
        assert.ok(Math.abs(bottomLayout.origin.y + bottomBounds.y - scorebugHitBounds(bottomBounds).y) < 0.51, 'Returning to bottom changed its existing artwork placement');
        check('Top panels stay near the screen edge at every size; fresh/delayed/sample badges, reachable controls, native hit targets and free-placement alignment stay consistent');

        for (const scale of [1.8, 0.65]) {
          for (const [anchor, side] of [['top-left', 'away'], ['top-right', 'home']]) {
            await evaluate(`window.scorebugDesktop.setPreferences({ anchor: "${anchor}", scale: ${scale} })`);
            await pause(160); // Let the native move guard finish before opening a hover blade.
            const actual = widget.getBounds();
            await waitFor('Top-corner layout and resized viewport are ready', () => evaluate(`document.body.dataset.contentAlignment === "top" && innerWidth === ${actual.width} && innerHeight === ${actual.height}`), 3000);
            const layout = await readScorebugLayout({ stale: true });
            await evaluate(`window.scorebugDesktop.showDetails("${side}")`);
            await waitFor('Top-corner blade and its native region', async () => {
              const panel = getDetails();
              return panel && !panel.isDestroyed() && panel.isVisible() && await panel.webContents.executeJavaScript('document.body.dataset.phase === "open"');
            }, 4000);
            const panel = getDetails(), panelBounds = panel.getBounds();
            const presentation = await panel.webContents.executeJavaScript('window.scorebugDesktop.getDetailsPresentation()');
            assert.equal(presentation.direction, 'down');
            const regions = detailsWindowShape(presentation);
            assert.equal(regions.length, 2);
            assert.ok(panelBounds.y + regions[1].y > actual.y + layout.toolbar.bottom, 'Blade body covers the controls');
            assert.ok(regions[1].height >= DETAILS_SIZE.height - 24, 'Toolbar clearance reduced the stats body');
            for (const x of [layout.toolbar.x + 1, layout.toolbar.right - 1]) {
              for (const y of [layout.toolbar.y + 1, layout.toolbar.bottom - 1]) {
                const point = { x: actual.x + x - panelBounds.x, y: actual.y + y - panelBounds.y };
                assert.ok(!regions.some((region) => containsPoint(region, point)), 'Native blade region intercepts the controls');
              }
            }
            if (process.platform === 'win32' && scale === 0.65 && side === 'home') {
              const point = screen.dipToScreenPoint({ x: Math.round(actual.x + layout.settings.x + layout.settings.width / 2), y: Math.round(actual.y + layout.settings.y + layout.settings.height / 2) });
              assert.equal(await windowsRootAtPoint(point), nativeHandle(widget), 'Windows sends the Settings button hit to the overlapping blade');
            }
            await evaluate('window.scorebugDesktop.hideDetails()');
            await waitFor('Top-corner blade closes', () => !getDetails(), 3000);
          }
        }
        await evaluate('window.scorebugDesktop.setPreferences({ anchor: "bottom-center", scale: 1 })');
        check('Top-corner blades at 65% and 180% clear the status flag and controls without shrinking stats; Windows routes the small-layout Settings hit through the native region');

        if (process.platform === 'win32') {
          await evaluate('window.scorebugDesktop.setPreferences({ anchor: "bottom-center", scale: 1, snapEnabled: true })');
          await pause(180);
          for (const anchor of ['middle-left', 'middle-right', 'top-center']) {
            const before = widget.getBounds();
            const area = screen.getDisplayMatching(before).workArea;
            const release = anchor === 'top-center'
              ? { x: area.x + (area.width - before.width) * 0.28, y: area.y + 8 }
              : { x: anchor === 'middle-left' ? area.x + 8 : area.x + area.width - before.width - 8,
                y: area.y + (area.height - before.height) * 0.28 };
            await windowsMoveAndRelease(widget, release);
            await waitFor(`Native drag release at ${anchor}`, async () => (await evaluate('window.scorebugDesktop.getState()')).anchor === anchor, 3000);
            const positioned = await evaluate('window.scorebugDesktop.getState()');
            const expectedOrientation = anchor === 'top-center' ? 'horizontal' : 'vertical';
            assert.equal(positioned.preferences.orientation, expectedOrientation);
            assert.equal(widget.getBounds().height > widget.getBounds().width, expectedOrientation === 'vertical');
            await waitFor('Orientation reaches the actual widget renderer', () => evaluate(`document.body.dataset.orientation === '${expectedOrientation}'`), 3000);
            if (anchor === 'middle-left') fs.writeFileSync(path.join(evidenceDir, 'native-side-widget.png'), (await widget.webContents.capturePage()).toPNG());
          }
          check('Real Windows move-release messages snap off-center edge drags and switch side/top orientation');
        }

        await evaluate('window.scorebugDesktop.setPreferences({ locked: true })');
        await waitFor('Locked state in the renderer', () => evaluate(`document.body.dataset.locked === 'true' && document.documentElement.dataset.desktopLocked === 'true'`), 3000);
        assert.equal((await evaluate('window.scorebugDesktop.getState()')).locked, true);
        assert.deepEqual(await readDragRegions(), { team: 'no-drag', target: 'no-drag', toolbar: 'no-drag' });
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
        await waitFor('Native update settings', () => getSettings().webContents.executeJavaScript(`Boolean(
          !document.querySelector('#desktop-updates')?.hidden &&
          document.querySelector('#update-status')?.textContent.includes('running from source') &&
          document.querySelector('#update-version')?.textContent.includes('${require('./package.json').version}')
        )`), 3000);
        getSettings().close();
        check('Settings opens with the same native preference state and working update status');

        await evaluate('window.scorebugDesktop.setPreferences({ anchor: "middle-left" })');
        await pause(180);
        const beforeDetails = widget.getBounds();
        await evaluate('window.scorebugDesktop.setDefaultDetailsSide("away")');
        await evaluate('window.scorebugDesktop.showDetails()');
        await waitFor('Native game-details page', async () => {
          const panel = getDetails();
          return panel && !panel.isDestroyed() && panel.isVisible() && await panel.webContents.executeJavaScript(`Boolean(window.scorebugDesktop?.getState && document.body.childElementCount)`);
        }, 8000);
        const panel = getDetails();
        assert.equal(new URL(panel.webContents.getURL()).pathname, '/details.html');
        assert.equal(new URL(panel.webContents.getURL()).searchParams.get('side'), 'away');
        assert.equal(panel.isAlwaysOnTop(), true);
        assert.deepEqual(widget.getBounds(), beforeDetails, 'Opening details moved or resized the scorebug');
        const panelBounds = panel.getBounds();
        const panelArea = screen.getDisplayMatching(panelBounds).workArea;
        assert.ok(panelBounds.x >= beforeDetails.x + beforeDetails.width - 24, 'Left-side details should join the slanted colored edge inward');
        assert.equal(panelBounds.width, Math.min(DETAILS_SIZE.width, panelArea.width));
        assert.equal(panelBounds.height, Math.min(DETAILS_SIZE.height, panelArea.height));
        assert.ok(panelBounds.x >= panelArea.x && panelBounds.y >= panelArea.y);
        assert.ok(panelBounds.x + panelBounds.width <= panelArea.x + panelArea.width);
        assert.ok(panelBounds.y + panelBounds.height <= panelArea.y + panelArea.height);
        const detailState = await panel.webContents.executeJavaScript('window.scorebugDesktop.getState()');
        assert.equal(detailState.preferences.orientation, 'vertical');
        assert.equal(detailState.detailsVisible, true);
        assert.equal(detailState.detailsSide, 'away');
        const sourceGameId = detailState.detailsGameId;
        await assert.rejects(() => panel.webContents.executeJavaScript('window.scorebugDesktop.setDetailsGameId("401000001")'), /Request denied/);
        await assert.rejects(() => evaluate('window.scorebugDesktop.setDetailsGameId("fox-../123")'), /Invalid game ID/);
        await evaluate('window.scorebugDesktop.setDetailsGameId("fox-11284")');
        assert.equal((await panel.webContents.executeJavaScript('window.scorebugDesktop.getDetailsPresentation()')).gameId, 'fox-11284');
        assert.equal((await evaluate('window.scorebugDesktop.getState()')).preferences.gameId, null, 'Hover context must not turn Automatic into a fixed selection');
        assert.equal(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).gameId, null);
        await evaluate(`window.scorebugDesktop.setDetailsGameId(${JSON.stringify(sourceGameId)})`);
        const presentation = await panel.webContents.executeJavaScript('window.scorebugDesktop.getDetailsPresentation()');
        assert.equal(presentation.gameId, sourceGameId);
        assert.equal(presentation.direction, 'right');
        assert.equal(presentation.orientation, 'vertical');
        assert.ok(presentation.joinTop >= 0 && presentation.joinBottom > presentation.joinTop);
        assert.ok(presentation.joinBottom <= panelBounds.height);
        assert.deepEqual(detailsWindowShape(presentation), [], 'Ordinary side blades must use their full native region');
        if (process.platform === 'win32') {
          const point = screen.dipToScreenPoint({ x: panelBounds.x + 3, y: panelBounds.y + 3 });
          assert.equal(await windowsRootAtPoint(point), nativeHandle(panel), 'The full native region was not restored for a side blade');
        }
        const awayGradient = teamPanelBounds(beforeDetails, 'vertical', 'away');
        assert.equal(presentation.gradientX, awayGradient.x - panelBounds.x);
        assert.equal(presentation.gradientY, awayGradient.y - panelBounds.y);
        assert.equal(presentation.gradientWidth, awayGradient.width);
        assert.equal(presentation.gradientHeight, awayGradient.height);
        // executeJavaScript clones its result back to the main process; the
        // subscription returns a function, which must remain in the renderer.
        await panel.webContents.executeJavaScript('window.__observedDetailsSide = null; window.scorebugDesktop.onDetailsSideChanged((side) => { window.__observedDetailsSide = side; }); void 0;');
        await evaluate('window.scorebugDesktop.showDetails("home")');
        await waitFor('Switching team in the same details renderer', () => panel.webContents.executeJavaScript('window.__observedDetailsSide === "home"'), 3000);
        assert.equal(getDetails(), panel, 'Switching teams recreated the details window');
        assert.equal((await evaluate('window.scorebugDesktop.getState()')).detailsSide, 'home');
        assert.deepEqual(widget.getBounds(), beforeDetails, 'Switching teams moved the scorebug');
        await waitFor('Expanded blade reaches the renderer', () => panel.webContents.executeJavaScript('document.body.dataset.phase === "open"'), 3000);
        fs.writeFileSync(path.join(evidenceDir, 'native-details.png'), (await panel.webContents.capturePage()).toPNG());
        await evaluate('window.scorebugDesktop.showDetails("comparison")');
        await waitFor('Clock comparison reaches the same details renderer', () => panel.webContents.executeJavaScript('window.__observedDetailsSide === "comparison"'), 3000);
        const comparisonBounds = panel.getBounds();
        assert.equal(comparisonBounds.width, Math.min(COMPARISON_DETAILS_SIZE.width, panelArea.width));
        assert.equal(comparisonBounds.height, Math.min(COMPARISON_DETAILS_SIZE.height, panelArea.height));
        assert.equal((await panel.webContents.executeJavaScript('window.scorebugDesktop.getDetailsPresentation()')).side, 'comparison');
        assert.deepEqual(widget.getBounds(), beforeDetails, 'Comparing teams changed the compact scoreboard');
        await evaluate('window.scorebugDesktop.hideDetails()');
        assert.equal(getDetails(), panel, 'Dismissal destroyed the blade before it could retract');
        await waitFor('Native blade begins retracting', async () => (await panel.webContents.executeJavaScript('window.scorebugDesktop.getDetailsPresentation()'))?.phase === 'closing', 1000);
        await waitFor('Blade closing phase reaches the renderer', () => panel.webContents.executeJavaScript('document.body.dataset.phase === "closing"'), 1000);
        await evaluate('window.scorebugDesktop.showDetails("comparison")');
        assert.equal(getDetails(), panel, 'Quick reopening replaced the retracting window');
        await waitFor('Quick reopening reverses the blade animation', () => panel.webContents.executeJavaScript('document.body.dataset.phase === "open"'), 3000);
        await pause(100);
        assert.equal(getDetails(), panel, 'An old close timer destroyed the reopened blade');
        await evaluate('window.scorebugDesktop.hideDetails()');
        await waitFor('Destroyed details renderer', () => !getDetails(), 3000);
        assert.deepEqual(widget.getBounds(), beforeDetails, 'Closing details moved or resized the scorebug');
        await evaluate('window.scorebugDesktop.setPreferences({ anchor: "bottom-center" })');
        check('Joined blade extends inward, switches teams without reloading, retracts before dismissal, and safely reverses on quick reopening');
        const compactBounds = widget.getBounds();
        const compactPreferences = (await evaluate('window.scorebugDesktop.getState()')).preferences;
        await assert.rejects(() => evaluate('window.scorebugDesktop.setGameCenterFullscreen(true)'), /Request denied/);
        await assert.rejects(() => evaluate('window.scorebugDesktop.closeGameCenter()'), /Request denied/);
        await evaluate('window.__gameCenterState = null; window.scorebugDesktop.onGameCenterState(state => { window.__gameCenterState = state; }); void 0;');
        await evaluate('window.scorebugDesktop.openGameCenter()');
        await waitFor('Full-screen Game Center opens', async () => {
          const center = getGameCenter();
          return center && !center.isDestroyed() && center.isVisible() && center.isFullScreen() && await center.webContents.executeJavaScript('Boolean(window.scorebugDesktop?.setGameCenterFullscreen && document.body?.childElementCount)');
        }, 8000);
        const center = getGameCenter();
        const centerEvaluate = (code) => center.webContents.executeJavaScript(code, true);
        assert.equal(new URL(center.webContents.getURL()).pathname, '/game.html');
        assert.equal(await centerEvaluate('typeof window.require'), 'undefined');
        assert.equal(await centerEvaluate('typeof window.process'), 'undefined');
        await waitFor('Visible Game Center exit controls', () => centerEvaluate(`
          document.querySelector('#center-fullscreen')?.textContent === 'Exit full screen' &&
          Boolean(document.querySelector('#center-fullscreen')?.getBoundingClientRect().height) &&
          Boolean(document.querySelector('#center-close')?.getBoundingClientRect().height)
        `), 3000);
        assert.equal(center.isAlwaysOnTop(), false, 'The dashboard should behave as a normal app window');
        assert.equal(widget.isVisible(), false, 'The floating scorebug should not obscure the full-screen game');
        assert.deepEqual((await centerEvaluate('window.scorebugDesktop.getState()')).preferences, compactPreferences);
        await waitFor('Fullscreen state reaches the compact window', () => evaluate('window.__gameCenterState?.open === true && window.__gameCenterState?.fullscreen === true'), 3000);
        await evaluate('window.scorebugDesktop.openGameCenter()');
        assert.equal(getGameCenter(), center, 'Opening the game again should reuse its window');
        await assert.rejects(() => centerEvaluate('window.scorebugDesktop.setGameCenterFullscreen("yes")'), /Fullscreen must be true or false/);
        center.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        center.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await waitFor('Escape exits fullscreen and restores the floating scorebug', () => !center.isFullScreen() && widget.isVisible(), 3000);
        assert.deepEqual(widget.getBounds(), compactBounds, 'Exiting fullscreen moved the floating scorebug');
        await centerEvaluate('document.querySelector("#center-fullscreen").click(); void 0;');
        await waitFor('Visible fullscreen control can enter fullscreen again', () => center.isFullScreen() && !widget.isVisible(), 3000);
        center.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
        center.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
        await waitFor('F11 in Game Center exits fullscreen', () => !center.isFullScreen() && widget.isVisible(), 3000);
        await centerEvaluate('window.scorebugDesktop.setGameCenterFullscreen(true)');
        await waitFor('Game Center is fullscreen before closing', () => center.isFullScreen() && !widget.isVisible(), 3000);
        await centerEvaluate('document.querySelector("#center-close").click(); void 0;');
        await waitFor('Closing Game Center restores the floating scorebug', () => !getGameCenter() && widget.isVisible(), 3000);
        assert.deepEqual(widget.getBounds(), compactBounds);
        assert.deepEqual((await evaluate('window.scorebugDesktop.getState()')).preferences, compactPreferences);
        await waitFor('Close state reaches the compact window', () => evaluate('window.__gameCenterState?.open === false && window.__gameCenterState?.fullscreen === false'), 3000);
        check('Game Center reuses a secure fullscreen window, exits with Escape/F11, restricts its IPC controls and restores the compact scoreboard');
        summary.passed = true;
      })(),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Native integration checks exceeded 45 seconds')), 45000); })
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
