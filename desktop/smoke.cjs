'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { scorebugHitBounds, teamPanelBounds, teamAtPoint, detailsWindowShape, DETAILS_SIZE, COMPARISON_DETAILS_SIZE, containsPoint } = require('./geometry.cjs');
const execFileAsync = promisify(execFile);
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(label, probe, timeout = 10000, stableFor = 0) {
  const end = Date.now() + timeout;
  let lastError;
  let stableSince = null;
  while (Date.now() < end) {
    try {
      if (await probe()) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= stableFor) return;
      } else stableSince = null;
    } catch (error) { lastError = error; stableSince = null; }
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
    // A cold hosted runner can spend about ten seconds compiling Add-Type.
    // The native HWND assertions below still verify the resulting styles.
    timeout: 30000
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
    timeout: 30000
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
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { windowsHide: true, timeout: 30000 });
  return stdout.trim();
}

async function runNativeSmoke({ widget, screen, origin, getSettings, getDetails, getGameCenter, preferencesPath, packaged = false, feedFetch, appRoot }) {
  const evidenceDir = process.env.SCOREBUG_SMOKE_EVIDENCE || path.join(__dirname, 'release', 'smoke');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const summary = { passed: false, platform: process.platform, arch: process.arch, packaged, softwareRendering: process.env.SCOREBUG_SMOKE_SOFTWARE_RENDERING === '1', version: require('./package.json').version, electron: process.versions.electron, feedRequired: false, checks: [] };
  let deadline, restoreStandbyNetwork;
  const check = (name) => { summary.checks.push(name); console.log(`[native smoke] PASS: ${name}`); };
  const evaluate = (code) => widget.webContents.executeJavaScript(code, true);
  const readScorebugLayout = async (options = {}) => {
    const nativeBounds = widget.getBounds();
    const nativePreferences = await evaluate('window.scorebugDesktop.getPreferences()');
    // A native resize can update innerWidth before the renderer's resize
    // handler replaces its explicit fitted board width. Wait for both, then
    // measure the fixture synchronously. The empty-feed board has a separate
    // CSS max-width, so inspect the stored fit rather than its temporary box.
    await waitFor('Native viewport and fitted scorebug are ready for geometry measurement', async () => {
      const layout = await evaluate(`(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          width: innerWidth, height: innerHeight,
          orientation: document.body.dataset.orientation,
          alignment: document.body.dataset.contentAlignment,
          fittedWidth: parseFloat(document.querySelector('.widget-board')?.style.width)
        };
      })()`);
      assert.equal(layout.width, nativeBounds.width, 'Renderer width has not reached the native window');
      assert.equal(layout.height, nativeBounds.height, 'Renderer height has not reached the native window');
      assert.equal(layout.orientation, nativePreferences.orientation, 'Renderer orientation has not reached the native preference');
      assert.equal(layout.alignment, nativePreferences.contentAlignment, 'Renderer alignment has not reached the native preference');
      assert.ok(Math.abs(layout.fittedWidth - (nativeBounds.width - 16)) < 0.51,
        `Fitted board width ${layout.fittedWidth} has not reached native content width ${nativeBounds.width - 16}`);
      return true;
    }, 5000);
    return evaluate(`(async () => {
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
  };
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
        summary.network = { passed: false };
        await require('./network-smoke.cjs').runNetworkSmoke({ fetchImpl: feedFetch, appRoot, report: summary.network });
        check('Production desktop transport survives real socket failures, held response EOF, aborts, body limits and recovery in three repetitions');
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
        const favorite = { leagueId:'nba',teamId:'nba:4',name:'Chicago Bulls',abbreviation:'CHI' };
        const favoriteStyleIds = ['nfl-blades','f1-rounded-tower'];
        await evaluate('window.__observedFavoriteStyles=null; window.scorebugDesktop.onPreferencesChanged(value => { window.__observedFavoriteStyles=value.favoriteStyleIds; }); void 0;');
        await evaluate(`window.scorebugDesktop.setPreferences(${JSON.stringify({leagueId:'nba',styleId:'nfl-blades',gameId:'nba:401000002',favorites:[favorite],favoriteStyleIds:[...favoriteStyleIds,'nfl-blades','unknown-style']})})`);
        const multiPreferences = JSON.parse(fs.readFileSync(preferencesPath,'utf8'));
        assert.equal(multiPreferences.leagueId,'nba');
        assert.equal(multiPreferences.gameId,'nba:401000002');
        assert.deepEqual(multiPreferences.favorites,[favorite]);
        assert.deepEqual(multiPreferences.favoriteStyleIds,favoriteStyleIds);
        assert.deepEqual((await evaluate('window.scorebugDesktop.getPreferences()')).favoriteStyleIds,favoriteStyleIds);
        await waitFor('Favorite styles reach native preference subscribers',async()=>JSON.stringify(await evaluate('window.__observedFavoriteStyles'))===JSON.stringify(favoriteStyleIds),3000);
        await assert.rejects(() => evaluate('window.scorebugDesktop.setPreferences({favoriteStyleIds:"nfl-blades"})'),/must be a list/);
        await assert.rejects(() => evaluate('window.scorebugDesktop.setPreferences({ favorites:[{leagueId:"nba",teamId:"nfl:3"}] })'), /different league/);
        await evaluate('window.scorebugDesktop.setPreferences({ leagueId:"nfl",styleId:"nfl-blades",gameId:null,favorites:[],favoriteStyleIds:[] })');
        check('League, style, favorite styles and league-scoped teams persist through native IPC; invalid favorite input is rejected');
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
        if (process.platform === 'darwin') {
          assert.equal(widget.isVisibleOnAllWorkspaces(), true);
          const helper = packaged ? path.join(process.resourcesPath,'mac-mouse-release') : path.join(__dirname,'native','bin','mac-mouse-release');
          const probe = await execFileAsync(helper,['--probe'],{timeout:3000});
          assert.match(probe.stdout.trim(),/^[01]$/);
          for (const anchor of ['middle-left','middle-right','top-center']) {
            await evaluate('window.scorebugDesktop.setPreferences({anchor:null,snapEnabled:true})');
            await pause(180);
            const previous = widget.getBounds(), area = screen.getDisplayMatching(previous).workArea;
            const release = anchor === 'top-center' ? {x:area.x+(area.width-previous.width)*.35,y:area.y+8}
              : {x:anchor==='middle-left'?area.x+8:area.x+area.width-previous.width-8,y:area.y+(area.height-previous.height)*.35};
            // This is an AppKit-window/real helper integration check. Synthetic
            // input injection is deliberately not used or granted permission.
            widget.emit('will-move',{preventDefault(){}},{...previous,...release});
            widget.setBounds({...previous,...release});
            await waitFor(`Mac release observer snaps ${anchor}`,async()=> (await evaluate('window.scorebugDesktop.getState()')).anchor===anchor,4000);
            assert.equal((await evaluate('window.scorebugDesktop.getState()')).preferences.orientation,anchor==='top-center'?'horizontal':'vertical');
          }
          check('Mac all-spaces floating window and real CoreGraphics release helper support side/top snap integration');
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
        await assert.rejects(() => panel.webContents.executeJavaScript('window.scorebugDesktop.setDetailsContext({gameId:"nba:123",leagueId:"nba"})'), /Request denied/);
        await assert.rejects(() => panel.webContents.executeJavaScript('window.scorebugDesktop.setDetailsRegions([])'), /Request denied/);
        await assert.rejects(() => evaluate('window.scorebugDesktop.setDetailsContext({gameId:"nba:123",leagueId:"nfl"})'), /different league/);
        await evaluate('window.scorebugDesktop.setDetailsContext({gameId:"nba:123",leagueId:"nba"})');
        const basketballContext = await panel.webContents.executeJavaScript('window.scorebugDesktop.getDetailsPresentation()');
        assert.equal(basketballContext.gameId,'nba:123');
        assert.equal(basketballContext.leagueId,'nba');
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

        // Exercise the real renderer → preload → main → child-window contract
        // with deterministic sports data. The production server is unchanged;
        // this temporary fetch adapter exists only inside the smoke renderer.
        await evaluate(`(async () => {
          const { referenceForLeague } = await import('/sport-fixtures.js');
          window.__smokeOriginalFetch = window.fetch;
          window.fetch = async (...args) => {
            const url = new URL(typeof args[0] === 'string' || args[0] instanceof URL ? args[0] : args[0].url, document.baseURI);
            const leagueId = url.searchParams.get('league') || 'nfl';
            if (url.origin === location.origin && url.pathname === '/api/scoreboard' && ['nba','f1'].includes(leagueId)) {
              const game = { ...referenceForLeague(leagueId), id: leagueId + ':401000002' };
              if (leagueId === 'f1') game.entries = Array.from({length:22},(_,index)=>({
                ...game.entries[index % game.entries.length], id:'f1:smoke-'+index, position:index+1,
                athlete:{id:'f1:smoke-'+index,name:'Fixture Driver '+(index+1),abbreviation:'D'+(index+1)}
              }));
              return new Response(JSON.stringify({leagueId,games:[game],fetchedAt:new Date().toISOString(),feedStatus:'live',sourceId:'native-smoke'}),{status:200,headers:{'content-type':'application/json'}});
            }
            if (url.origin === location.origin && url.pathname === '/api/game' && ['nba','f1'].includes(leagueId)) {
              return new Response(JSON.stringify({error:'Native geometry fixture has no play-by-play.'}),{status:503,headers:{'content-type':'application/json'}});
            }
            return window.__smokeOriginalFetch(...args);
          };
        })()`);
        try {
          for (const fixture of [
            {leagueId:'nba',styleId:'nba-nbc-pods',anchor:'middle-left',scale:.65,side:'away'},
            {leagueId:'f1',styleId:'nfl-blades',anchor:'top-right',scale:1.8,racingRows:22,side:'comparison'},
            {leagueId:'f1',styleId:'f1-rounded-tower',anchor:'middle-right',scale:1.8,racingRows:22,side:'comparison'}
          ]) {
            const {side,...patch} = fixture;
            await evaluate(`window.scorebugDesktop.setPreferences(${JSON.stringify({...patch,gameId:null})})`);
            await waitFor('Sport-specific widget and source context', () => evaluate(`(async () => {
              const svg=document.querySelector('.widget-board .scorebug');
              const state=await window.scorebugDesktop.getState();
              return svg?.dataset.leagueId === '${fixture.leagueId}' && svg.dataset.styleId === '${fixture.styleId}'
                && state.detailsGameId === '${fixture.leagueId}:401000002' && state.detailsLeagueId === '${fixture.leagueId}';
            })()`),4000);
            await pause(180);
            if (fixture.leagueId === 'f1') {
              const grid = await evaluate(`(() => {
                const rows=[...document.querySelectorAll('.widget-board .variant-classification-row')];
                const svg=document.querySelector('.widget-board .scorebug'), rect=svg.getBoundingClientRect();
                return {rows:rows.length,selected:svg.dataset.racingRows,top:rect.top,bottom:rect.bottom,viewport:innerHeight,
                  finalBottom:rows.at(-1)?.getBoundingClientRect().bottom};
              })()`);
              assert.equal(grid.rows,22);assert.equal(grid.selected,'22');
              assert.ok(grid.top>=-1 && grid.bottom<=grid.viewport+1 && grid.finalBottom<=grid.viewport+1,'Full F1 field is clipped by the native window');
              assert.equal(JSON.parse(fs.readFileSync(preferencesPath,'utf8')).racingRows,22);
            }
            const source = await evaluate(`(() => {
              const element=document.querySelector(${JSON.stringify(side==='comparison'?'.widget-board .bug-situation-panel':`.widget-board [data-team-side="${side}"] .bug-team-panel`)});
              const rect=element.getBoundingClientRect();
              return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
            })()`);
            await evaluate(`window.scorebugDesktop.showDetails('${side}')`);
            await waitFor('Alternate-style native child',async()=>{
              const panel=getDetails();
              return panel && !panel.isDestroyed() && panel.isVisible() && await panel.webContents.executeJavaScript('document.body.dataset.phase === "open"');
            },4000);
            const panel=getDetails(), panelBounds=panel.getBounds(), widgetBounds=widget.getBounds();
            const actual=await panel.webContents.executeJavaScript('window.scorebugDesktop.getDetailsPresentation()');
            assert.equal(actual.gameId,`${fixture.leagueId}:401000002`);
            assert.equal(actual.leagueId,fixture.leagueId);
            assert.equal(actual.side,side);
            assert.equal(actual.gradientWidth,source.width);
            assert.equal(actual.gradientHeight,source.height);
            assert.equal(actual.gradientX,widgetBounds.x+source.x-panelBounds.x);
            assert.equal(actual.gradientY,widgetBounds.y+source.y-panelBounds.y);
            const area=screen.getDisplayMatching(panelBounds).workArea;
            assert.ok(panelBounds.x>=area.x && panelBounds.y>=area.y && panelBounds.x+panelBounds.width<=area.x+area.width && panelBounds.y+panelBounds.height<=area.y+area.height);
            fs.writeFileSync(path.join(evidenceDir,`native-${fixture.leagueId}-${fixture.anchor}-widget.png`),(await widget.webContents.capturePage()).toPNG());
            await evaluate('window.scorebugDesktop.hideDetails()');
            await waitFor('Alternate-style native child closes',()=>!getDetails(),3000);
          }
          check('Actual NBA and Formula 1 renderers preserve native hover geometry; the full 22-driver field fits top and side windows at 180%, including cross-sport Blades');
        } finally {
          await evaluate('window.fetch=window.__smokeOriginalFetch; delete window.__smokeOriginalFetch; void 0;');
          await evaluate('window.scorebugDesktop.setPreferences({leagueId:"nfl",styleId:"nfl-blades",gameId:null,anchor:"bottom-center",scale:1,racingRows:6})');
        }
        const compactBounds = widget.getBounds();
        const compactPreferences = (await evaluate('window.scorebugDesktop.getState()')).preferences;
        const waitForCompactRestore = async (label, ready) => {
          let observed;
          try {
            // On macOS, closed/visible can precede the Dock restoring its work
            // area. Require the original bounds and preferences to stay exact
            // beyond the 350 ms native move debounce, not just match once.
            await waitFor(label, async () => {
              if (!await ready()) return false;
              const bounds = widget.getBounds();
              const preferences = (await evaluate('window.scorebugDesktop.getState()')).preferences;
              observed = { bounds, workArea: screen.getDisplayMatching(bounds).workArea, preferences };
              assert.deepEqual(bounds, compactBounds, 'Exiting fullscreen moved the floating scorebug');
              assert.deepEqual(preferences, compactPreferences, 'Exiting fullscreen changed compact preferences');
              return true;
            }, 10000, 500);
          } catch (error) {
            error.message += `; fullscreen restore: ${JSON.stringify({ expectedBounds: compactBounds, expectedPreferences: compactPreferences, observed })}`;
            throw error;
          }
        };
        await assert.rejects(() => evaluate('window.scorebugDesktop.setGameCenterFullscreen(true)'), /Request denied/);
        await assert.rejects(() => evaluate('window.scorebugDesktop.closeGameCenter()'), /Request denied/);
        await evaluate('window.__gameCenterState = null; window.scorebugDesktop.onGameCenterState(state => { window.__gameCenterState = state; }); void 0;');
        await evaluate('window.scorebugDesktop.openGameCenter()');
        await waitFor('Full-screen Game Center opens', async () => {
          const center = getGameCenter();
          return center && !center.isDestroyed() && center.isVisible() && center.isFullScreen() && await center.webContents.executeJavaScript('(async () => Boolean(window.scorebugDesktop?.setGameCenterFullscreen && document.body?.childElementCount && (await window.scorebugDesktop.getGameCenterState()).fullscreen))()');
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
        center.focus();
        center.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        center.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await waitForCompactRestore('Escape exits fullscreen and restores the floating scorebug', async () => !center.isFullScreen() && widget.isVisible() && !(await centerEvaluate('window.scorebugDesktop.getGameCenterState()')).fullscreen);
        assert.deepEqual(widget.getBounds(), compactBounds, 'Exiting fullscreen moved the floating scorebug');
        await centerEvaluate('document.querySelector("#center-fullscreen").click(); void 0;');
        await waitFor('Visible fullscreen control can enter fullscreen again', async () => center.isFullScreen() && !widget.isVisible() && (await centerEvaluate('window.scorebugDesktop.getGameCenterState()')).fullscreen, 6000);
        center.focus();
        center.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
        center.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
        await waitForCompactRestore('F11 in Game Center exits fullscreen', async () => !center.isFullScreen() && widget.isVisible() && !(await centerEvaluate('window.scorebugDesktop.getGameCenterState()')).fullscreen);
        await centerEvaluate('window.scorebugDesktop.setGameCenterFullscreen(true)');
        await waitFor('Game Center is fullscreen before closing', async () => center.isFullScreen() && !widget.isVisible() && (await centerEvaluate('window.scorebugDesktop.getGameCenterState()')).fullscreen, 6000);
        await centerEvaluate('document.querySelector("#center-close").click(); void 0;');
        await waitForCompactRestore('Closing Game Center restores the floating scorebug', () => !getGameCenter() && widget.isVisible());
        assert.deepEqual(widget.getBounds(), compactBounds);
        assert.deepEqual((await evaluate('window.scorebugDesktop.getState()')).preferences, compactPreferences);
        await waitFor('Close state reaches the compact window', () => evaluate('window.__gameCenterState?.open === false && window.__gameCenterState?.fullscreen === false'), 3000);
        check('Game Center reuses a secure fullscreen window, exits with Escape/F11, restricts its IPC controls and restores the compact scoreboard');

        // This group intentionally exercises the last-confirmed cached score.
        // Keep real NBA responses from replacing its explicitly labelled fixture
        // as Settings and Game Center navigate through fresh renderer documents.
        const smokeRequests = widget.webContents.session.webRequest;
        smokeRequests.onBeforeRequest({ urls: [`${origin}/api/scoreboard*`] }, (_request, done) => done({ cancel: true }));
        restoreStandbyNetwork = () => { smokeRequests.onBeforeRequest(null); restoreStandbyNetwork = null; };
        await evaluate('window.scorebugDesktop.openSettings()');
        await waitFor('Settings Standby entry', () => getSettings()?.webContents.executeJavaScript('Boolean(document.querySelector("#standby-button"))'), 8000);
        const standbyWindow = getSettings();
        const standbyEvaluate = code => standbyWindow.webContents.executeJavaScript(code, true);
        await standbyEvaluate(`(async () => {
          const [{ referenceForLeague }, { writeCachedScoreboard }, { normalizeStandbyState, saveStandbyState }] = await Promise.all([
            import('/sport-fixtures.js'), import('/score-client.js'), import('/standby-model.js')
          ]);
          const game = { ...referenceForLeague('nba'), id: 'nba:native-smoke', detailsGameId: null };
          const slot = { leagueId: 'nba', gameId: game.id, styleId: 'nfl-blades', date: '20261125', racingRows: 22 };
          if (!writeCachedScoreboard(slot.date, { leagueId: 'nba', fetchedAt: new Date().toISOString(), games: [game], source: 'Native test fixture' }, { leagueId: 'nba' })) throw new Error('Native test cache could not be prepared');
          saveStandbyState(localStorage, normalizeStandbyState({ slots: [slot] }));
          document.querySelector('#standby-button').click();
        })()`);
        await waitFor('Standby loads inside Settings with working trusted IPC', async () => {
          if (new URL(standbyWindow.webContents.getURL()).pathname !== '/standby.html') return false;
          return standbyEvaluate('(async () => Boolean(document.querySelector(".slot-details:not([hidden])") && (await window.scorebugDesktop.getPreferences()).leagueId))()');
        }, 8000);
        assert.equal(await standbyEvaluate('document.querySelector(".slot-phase").textContent'), 'DELAYED', 'The cached native test score must be labelled delayed');
        let standbySaved = await standbyEvaluate('localStorage.getItem("scorebug.standby.v1")');
        assert.deepEqual((await standbyEvaluate('window.scorebugDesktop.getState()')).preferences, compactPreferences, 'Opening Standby changed the native selection');
        await standbyEvaluate('document.querySelector(".slot-details").click(); void 0;');
        await waitFor('Standby stats reach the real fullscreen Game Center', async () => {
          const next = getGameCenter();
          return next && next !== standbyWindow && next.isFullScreen() && next.webContents.executeJavaScript('document.querySelector("#center-league-select")?.value === "nba" && document.querySelector("#center-style-select")?.value === "nfl-blades"');
        }, 8000, 400);
        const standbyCenter = getGameCenter();
        const context = new URL(standbyCenter.webContents.getURL());
        for (const [key, value] of Object.entries({ league: 'nba', game: 'nba:native-smoke', style: 'nfl-blades', date: '20261125', rows: '22' })) assert.equal(context.searchParams.get(key), value, `Standby lost ${key}`);
        const selectedNative = await standbyCenter.webContents.executeJavaScript('window.scorebugDesktop.getPreferences()');
        for (const [key, value] of Object.entries({ leagueId: 'nba', gameId: 'nba:native-smoke', styleId: 'nfl-blades', styleAuto: false, date: '20261125', racingRows: 22, team: null })) assert.equal(selectedNative[key], value, `Native selection did not receive ${key}`);
        for (const key of ['anchor', 'scale', 'snapEnabled', 'locked', 'favorites', 'favoriteStyleIds']) assert.deepEqual(selectedNative[key], compactPreferences[key], `Opening game stats changed ${key}`);
        assert.equal(new URL(standbyWindow.webContents.getURL()).pathname, '/standby.html', 'Stats replaced the saved Standby board');
        assert.equal(await standbyEvaluate('localStorage.getItem("scorebug.standby.v1")'), standbySaved);
        const selectedCenterEvaluate = code => standbyCenter.webContents.executeJavaScript(code, true);
        await selectedCenterEvaluate('document.querySelector("#center-standby").click(); void 0;');
        await waitFor('Game Center can show its Standby board', () => selectedCenterEvaluate('Boolean(document.querySelector(".slot-details:not([hidden])"))'), 8000);
        await selectedCenterEvaluate(`document.querySelector('.slot-configure').click();
          document.querySelector('#slot-style').value = 'nfl-cbs-eyebar';
          document.querySelector('#slot-style').dispatchEvent(new Event('change', { bubbles: true }));
          document.querySelector('#slot-done').click(); void 0;`);
        assert.equal((await selectedCenterEvaluate('window.scorebugDesktop.getPreferences()')).styleId, 'nfl-blades', 'Changing a Standby card changed the main selection before opening its stats');
        standbySaved = await selectedCenterEvaluate('localStorage.getItem("scorebug.standby.v1")');
        await selectedCenterEvaluate('document.querySelector(".slot-details").click(); void 0;');
        await waitFor('Same-window Standby stats synchronize the native selection', async () => {
          if (new URL(standbyCenter.webContents.getURL()).pathname !== '/game.html') return false;
          return selectedCenterEvaluate('(async () => document.querySelector("#center-style-select")?.value === "nfl-cbs-eyebar" && (await window.scorebugDesktop.getPreferences()).styleId === "nfl-cbs-eyebar")()');
        }, 8000, 400);
        assert.equal(getGameCenter(), standbyCenter, 'Returning from Standby opened a duplicate dashboard');
        await standbyCenter.webContents.executeJavaScript('document.querySelector("#center-close").click(); void 0;', true);
        await waitFor('Closing Standby stats restores the floating window', () => !getGameCenter() && widget.isVisible(), 8000);
        await standbyEvaluate('document.querySelector(".standby-brand").click(); void 0;');
        await waitFor('Standby returns to Settings', () => standbyEvaluate('Boolean(document.querySelector("#game-select") && document.querySelector("#standby-button"))'), 8000);
        await standbyEvaluate('document.querySelector("#standby-button").click(); void 0;');
        await waitFor('The saved Standby board reopens', () => standbyEvaluate('Boolean(document.querySelector("#standby-grid"))'), 8000);
        await evaluate('window.scorebugDesktop.openSettings()');
        await waitFor('The native Settings action returns from Standby to Settings', () => standbyEvaluate('Boolean(document.querySelector("#game-select") && document.querySelector("#standby-button"))'), 8000);
        assert.equal(getSettings(), standbyWindow, 'The Settings action should reuse its existing window');
        assert.equal(await standbyEvaluate('localStorage.getItem("scorebug.standby.v1")'), standbySaved, 'Returning to Settings changed the saved board');
        await evaluate(`window.scorebugDesktop.setPreferences(${JSON.stringify(compactPreferences)})`);
        standbyWindow.close();
        restoreStandbyNetwork();
        check('Standby preserves its independent board, opens the selected game in the real dashboard and returns safely to Settings');
        summary.passed = true;
      })(),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Native integration checks exceeded 150 seconds')), 150000); })
    ]);
  } catch (error) {
    summary.error = error.stack || String(error);
    throw error;
  } finally {
    clearTimeout(deadline);
    restoreStandbyNetwork?.();
    fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`[native smoke] ${summary.passed ? 'SUCCESS' : 'FAILED'}: ${summary.checks.length} integration groups checked. ESPN availability does not gate this test.`);
  }
}

module.exports = { runNativeSmoke };
