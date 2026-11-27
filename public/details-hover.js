/** Joined team blades. Windows uses the same renderer in a transparent surface. */
import { bladeOutline, BLADE_SIZE, COMPARISON_BLADE_SIZE, BLADE_OPEN_MS, BLADE_CLOSE_MS } from './details-blade.js';
import { isSupportedGameId } from './score-client.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
let nextPanel = 0;

function pathCorners(path) {
  if (!path) return null;
  const match = /^M([\d.-]+)\s+([\d.-]+)H([\d.-]+)L([\d.-]+)\s+([\d.-]+)H([\d.-]+)Z$/.exec(path.getAttribute('d') || '');
  const matrix = path.getScreenCTM();
  if (match && matrix) {
    const [,x1,y1,x2,x3,y3,x4] = match.map(Number);
    return [[x1,y1],[x2,y1],[x3,y3],[x4,y3]].map(([x,y]) => new DOMPoint(x,y).matrixTransform(matrix));
  }
  const rect = path.getBoundingClientRect();
  return [{x:rect.left,y:rect.top},{x:rect.right,y:rect.top},{x:rect.right,y:rect.bottom},{x:rect.left,y:rect.bottom}];
}

function teamAnchor(target, side) {
  const comparison = side === 'comparison';
  const team = target.querySelector(`[data-team-side="${side}"]`);
  const path = comparison ? target.querySelector('.bug-situation-panel') : team?.querySelector('.bug-team-panel');
  if (!path) return null;
  const svg = path.closest('svg'), orientation = svg?.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const points = pathCorners(path), strip = pathCorners(svg?.querySelector('.bug-situation-panel'));
  const matrix = svg?.getScreenCTM();
  const statusEnd = orientation === 'horizontal' && svg?.dataset.statusPosition === 'below' && matrix
    ? new DOMPoint(232, 162).matrixTransform(matrix) : null;
  // Reserve the full badge even while absent, so a delayed feed does not move
  // an open blade. Its narrow neck passes to the right before widening below.
  const belowStatus = statusEnd ? { clearX: statusEnd.x, homeRight: new DOMPoint(343, 136).matrixTransform(matrix).x, clearanceY: statusEnd.y + 6 } : null;
  const toolbar = target.closest('.widget-root')?.querySelector('.widget-toolbar')?.getBoundingClientRect();
  const controlsBottom = belowStatus && toolbar?.height ? toolbar.bottom : null;
  const solid = (value) => /^#[\da-f]{6}$/i.test(value || '') ? value : undefined;
  const result = {
    team, points, lowerEdge: strip ? [strip[3], strip[2]] : [points[3], points[2]],
    belowStatus, controlsBottom, orientation,
    gameId: isSupportedGameId(svg?.dataset.gameId) ? svg.dataset.gameId : null,
    teamFill: solid(team?.dataset.teamFill || path.getAttribute('fill')),
    teamBorder: solid(team?.dataset.teamBorder || path.getAttribute('stroke')),
    teamInk: solid(team?.dataset.teamInk)
  };
  if (comparison && matrix) {
    const span = orientation === 'vertical' ? [22, 135] : [228, 358];
    const y = orientation === 'vertical' ? 2 : 4;
    result.upEdge = span.map((x) => new DOMPoint(x, y).matrixTransform(matrix));
    result.downSpan = result.upEdge.map((point) => point.x);
    if (orientation === 'horizontal') {
      const away = pathCorners(svg.querySelector('[data-team-side="away"] .bug-team-panel'));
      const home = pathCorners(svg.querySelector('[data-team-side="home"] .bug-team-panel'));
      if (away && home) result.lateralPoints = [away[0], home[1], strip[2], strip[3]];
    }
  }
  return result;
}

/** Use the same source edges and direction order as the native child window. */
export function placeDetailsBlade(anchor, side, viewport = { width: innerWidth, height: innerHeight }) {
  const comparison = side === 'comparison';
  const size = comparison ? COMPARISON_BLADE_SIZE : BLADE_SIZE;
  const [tl, tr, br, bl] = anchor.points, margin = 6, overlap = 1.5;
  const { width: vw, height: vh } = viewport;
  const area = { x: margin, y: margin, width: Math.max(1, vw - margin * 2), height: Math.max(1, vh - margin * 2) };
  const width = Math.min(size.width, area.width), height = Math.min(size.height, area.height);
  const [stripLeft, stripRight] = anchor.lowerEdge;
  const upEdge = anchor.upEdge || [tl, tr];
  const downEdge = [
    { x: Math.max(comparison ? anchor.downSpan?.[0] ?? bl.x : bl.x, stripLeft.x, anchor.belowStatus?.clearX ?? -Infinity), y: stripLeft.y },
    { x: Math.min(comparison ? anchor.downSpan?.[1] ?? br.x : br.x, stripRight.x, side !== 'away' ? anchor.belowStatus?.homeRight ?? Infinity : Infinity), y: stripRight.y }
  ];
  const neckHeight = anchor.belowStatus
    ? Math.max(anchor.belowStatus.clearanceY, Number.isFinite(anchor.controlsBottom) ? anchor.controlsBottom + 3 : -Infinity) - (stripLeft.y - overlap) : 0;
  const downHeight = Math.min(area.height, height + Math.max(0, Math.ceil(neckHeight + 1 - 24)));
  const sourceXs = anchor.points.map(({ x }) => x), sourceYs = anchor.points.map(({ y }) => y);
  const source = { x: Math.min(...sourceXs), y: Math.min(...sourceYs), width: Math.max(...sourceXs) - Math.min(...sourceXs), height: Math.max(...sourceYs) - Math.min(...sourceYs) };
  const lateral = anchor.lateralPoints || anchor.points;
  const desired = (direction) => {
    if (direction === 'left' || direction === 'right') {
      const edge = direction === 'left' ? [lateral[0], lateral[3]] : [lateral[1], lateral[2]];
      const points = edge.map(({ x, y }) => ({ x: x + (direction === 'left' ? overlap : -overlap), y }));
      const x = direction === 'left' ? Math.max(...points.map((point) => point.x)) - width : Math.min(...points.map((point) => point.x));
      const y = clamp(source.y + (source.height - height) / 2, area.y, area.y + area.height - height);
      return { direction, x, y, width, height, points };
    }
    const edge = direction === 'up' ? upEdge : downEdge;
    const points = edge.map(({ x, y }) => ({ x, y: y + (direction === 'up' ? overlap : -overlap) }));
    return {
      direction, x: clamp((edge[0].x + edge[1].x - width) / 2, area.x, area.x + area.width - width),
      y: points[0].y - (direction === 'up' ? height : 0), width, height: direction === 'down' ? downHeight : height, points
    };
  };
  const preferred = comparison
    ? (source.x - area.x > area.x + area.width - source.x - source.width ? 'left' : 'right')
    : side === 'away' ? 'left' : 'right';
  const verticalDirections = upEdge[0].y - area.y >= area.y + area.height - stripLeft.y ? ['up', 'down'] : ['down', 'up'];
  const directions = anchor.orientation === 'vertical'
    ? [preferred, preferred === 'left' ? 'right' : 'left', ...verticalDirections]
    : comparison ? [...verticalDirections, preferred, preferred === 'left' ? 'right' : 'left'] : [preferred, ...verticalDirections];
  const candidates = directions.map(desired);
  const fit = (candidate) => ({ ...candidate, x: clamp(candidate.x, area.x, area.x + area.width - candidate.width), y: clamp(candidate.y, area.y, area.y + area.height - candidate.height) });
  const fits = ({ x, y, width: w, height: h }) => x >= area.x && y >= area.y && x + w <= area.x + area.width && y + h <= area.y + area.height;
  const overlapArea = (candidate) => Math.max(0, Math.min(candidate.x + candidate.width, source.x + source.width) - Math.max(candidate.x, source.x)) * Math.max(0, Math.min(candidate.y + candidate.height, source.y + source.height) - Math.max(candidate.y, source.y));
  const minWidth = comparison ? 340 : 240, minBodyHeight = comparison ? 260 : 180;
  const constrained = candidates.map((candidate) => {
    const next = { ...candidate };
    if (next.direction === 'left') {
      const right = next.x + next.width;
      next.width = Math.max(1, Math.min(next.width, Math.floor(right - area.x))); next.x = right - next.width;
    } else if (next.direction === 'right') {
      next.width = Math.max(1, Math.min(next.width, Math.floor(area.x + area.width - next.x)));
    } else if (next.direction === 'up') {
      const bottom = next.y + next.height;
      next.height = Math.max(1, Math.min(next.height, Math.floor(bottom - area.y))); next.y = bottom - next.height;
    } else next.height = Math.max(1, Math.min(next.height, Math.floor(area.y + area.height - next.y)));
    next.readable = ['left', 'right'].includes(next.direction) ? next.width >= minWidth
      : next.height >= minBodyHeight + (next.direction === 'down' ? neckHeight : 0);
    return next;
  });
  const chosen = candidates.find(fits) || constrained.find((candidate) => candidate.readable && fits(candidate))
    || candidates.map(fit).reduce((best, candidate) => overlapArea(candidate) < overlapArea(best) ? candidate : best);
  const { x, y, width: actualWidth, height: actualHeight, direction, points } = fit(chosen);
  const presentation = {
    side, direction, orientation: anchor.orientation,
    gameId: isSupportedGameId(anchor.gameId) ? anchor.gameId : null,
    teamFill: anchor.teamFill, teamBorder: anchor.teamBorder, teamInk: anchor.teamInk,
    gradientX: source.x - x, gradientY: source.y - y, gradientWidth: source.width, gradientHeight: source.height
  };
  if (direction === 'left' || direction === 'right') {
    const [top, bottom] = points, edgeHeight = bottom.y - top.y;
    const topY = clamp(top.y, y, y + actualHeight), bottomY = clamp(bottom.y, y, y + actualHeight);
    const edgeX = (value) => edgeHeight ? top.x + (bottom.x - top.x) * (value - top.y) / edgeHeight : top.x;
    Object.assign(presentation, { joinTop: topY - y, joinBottom: bottomY - y, joinTopX: clamp(edgeX(topY) - x, 0, actualWidth), joinBottomX: clamp(edgeX(bottomY) - x, 0, actualWidth) });
  } else {
    Object.assign(presentation, { joinLeft: clamp(points[0].x - x, 0, actualWidth), joinRight: clamp(points[1].x - x, 0, actualWidth), joinY: clamp(points[0].y - y, 0, actualHeight) });
    if (direction === 'down' && anchor.belowStatus) presentation.neckHeight = neckHeight;
  }
  return { x, y, width: actualWidth, height: actualHeight, presentation };
}

export function attachDetailsHover(target, { native = false, enabled = () => true, defaultSide = () => 'home' } = {}) {
  let panel = null, frame = null, side = null, pendingSide = null, queuedSide = null, phase = 'closed';
  let opening, closing, retiring, entering, positioning, loaded = false, focusStay = false, dismissedSide = null;
  let nativeOpen = false, nativeSide = null;
  const origin = new URL(document.baseURI).origin;
  const panelId = `scorebug-team-blade-${++nextPanel}`;
  const teamElement = (value) => target.querySelector(`[data-details-side="${value}"]`);
  function syncAccessibility() {
    for (const team of target.querySelectorAll('[data-details-side]')) {
      const expanded = native ? nativeOpen && team.dataset.detailsSide === nativeSide : panel && team.dataset.detailsSide === side && phase !== 'closing';
      team.setAttribute('aria-expanded',String(Boolean(expanded)));
      team.setAttribute('aria-haspopup','dialog');
      if (!native) team.setAttribute('aria-controls',panelId);
    }
  }
  function position() {
    positioning = null;
    if (!panel) return;
    if (!enabled()) { close(); return; }
    const anchor = teamAnchor(target,side);
    if (!anchor) { close(); return; }
    const {x,y,width,height,presentation} = placeDetailsBlade(anchor,side);
    panel.dataset.direction = presentation.direction;
    panel.dataset.phase = phase;
    panel.style.cssText = `position:fixed;z-index:1000;width:${width}px;height:${height}px;left:${x}px;top:${y}px;clip-path:${bladeOutline(width,height,presentation).clip};`;
    frame.contentWindow?.postMessage({type:'scorebug:details-presentation',presentation:{...presentation,phase}},origin);
    syncAccessibility();
  }
  function schedulePosition() { if (!positioning) positioning=requestAnimationFrame(position); }
  function setPhase(value) { phase=value; position(); }
  function reveal() {
    clearTimeout(retiring); clearTimeout(entering); queuedSide=null;
    if (!panel || !loaded) return;
    setPhase('opening');
    entering=setTimeout(()=>{if(panel && phase==='opening')setPhase('open');},BLADE_OPEN_MS);
  }
  function remove({restoreFocus=false}={}) {
    const previous=side;
    clearTimeout(entering);clearTimeout(retiring);
    panel?.remove();panel=null;frame=null;side=null;phase='closed';loaded=false;queuedSide=null;
    syncAccessibility();
    if(restoreFocus && previous)teamElement(previous)?.focus({preventScroll:true});
  }
  function close({immediate=false,restoreFocus=false,switchTo=null}={}) {
    clearTimeout(opening);clearTimeout(closing);pendingSide=null;
    if(native){window.scorebugDesktop?.hideDetails?.();return;}
    if(!panel)return;
    queuedSide=switchTo;
    if(restoreFocus){dismissedSide=side;focusStay=false;}
    if(immediate){remove({restoreFocus});return;}
    if(phase==='closing')return;
    clearTimeout(entering);setPhase('closing');
    const retiringPanel=panel;
    retiring=setTimeout(()=>{
      if(panel!==retiringPanel || phase!=='closing')return;
      const next=queuedSide;
      if(next && enabled()){
        phase='closed';side=next;queuedSide=null;
        frame.title=side==='comparison'?'Game comparison':`${side==='away'?'Away':'Home'} team stats`;
        position();requestAnimationFrame(reveal);
      }else remove({restoreFocus});
    },BLADE_CLOSE_MS+30);
  }
  function open(value=defaultSide(),{focus=false}={}) {
    clearTimeout(opening);clearTimeout(closing);pendingSide=null;
    if(!enabled())return;
    value=['away','home','comparison'].includes(value)?value:'home';
    if(native){window.scorebugDesktop?.showDetails?.(value);return;}
    dismissedSide=null;focusStay=focusStay||focus;
    if(panel && side!==value){close({switchTo:value});return;}
    if(panel){queuedSide=null;if(phase==='closing')reveal();else position();return;}
    side=value;phase='closed';loaded=false;
    panel=document.createElement('div');panel.className='details-popover';panel.id=panelId;
    frame=document.createElement('iframe');frame.title=side==='comparison'?'Game comparison':`${side==='away'?'Away':'Home'} team stats`;
    const url=new URL('/details.html',document.baseURI);url.searchParams.set('embedded','1');url.searchParams.set('side',side);
    frame.src=url.href;frame.style.cssText='width:100%;height:100%;display:block;border:0;background:transparent;color-scheme:dark;';
    const created=panel;
    frame.addEventListener('load',()=>{if(panel!==created)return;loaded=true;position();if(phase!=='closing')requestAnimationFrame(reveal);});
    panel.append(frame);document.body.append(panel);position();
    panel.addEventListener('pointerenter',()=>{clearTimeout(opening);clearTimeout(closing);if(phase==='closing'&&!queuedSide)reveal();});
    panel.addEventListener('pointerleave',delayedClose);
  }
  function delayedClose() {
    clearTimeout(opening);clearTimeout(closing);pendingSide=null;
    if(focusStay)return;
    closing=setTimeout(()=>close(),320);
  }
  function schedule(value) {
    clearTimeout(closing);
    if(value===dismissedSide)return;
    if(value===side){clearTimeout(opening);pendingSide=null;queuedSide=null;if(phase==='closing')reveal();return;}
    if(value===pendingSide)return;
    clearTimeout(opening);pendingSide=value;
    opening=setTimeout(()=>open(value),panel?160:360);
  }
  target.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const team=event.target.closest?.('[data-details-side]');
    if(team){event.preventDefault();open(team.dataset.detailsSide,{focus:true});}
  });
  if(!native){
    target.addEventListener('pointermove',event=>{
      if(event.pointerType==='touch')return;
      const team=event.target.closest?.('[data-details-side]');
      if(team&&target.contains(team))schedule(team.dataset.detailsSide);else delayedClose();
    });
    target.addEventListener('pointerleave',()=>{dismissedSide=null;delayedClose();});
    target.addEventListener('focusin',event=>{const team=event.target.closest?.('[data-details-side]');if(team){focusStay=true;schedule(team.dataset.detailsSide);}});
    target.addEventListener('focusout',event=>{if(!target.contains(event.relatedTarget)&&event.relatedTarget!==frame){focusStay=false;delayedClose();}});
    target.addEventListener('click',event=>{const team=event.target.closest?.('[data-details-side]');if(team)open(team.dataset.detailsSide,{focus:event.detail===0||event.pointerType==='touch'});});
    window.addEventListener('resize',schedulePosition);
    window.addEventListener('scroll',schedulePosition,{passive:true});
    window.addEventListener('message',event=>{if(event.origin===origin&&event.source===frame?.contentWindow&&event.data?.type==='scorebug:close-details')close({restoreFocus:true});});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close({restoreFocus:true});});
    document.addEventListener('pointerdown',event=>{if(panel&&!target.contains(event.target)&&!panel.contains(event.target)){focusStay=false;close();}});
    window.addEventListener('pagehide',()=>close({immediate:true}));
    new ResizeObserver(schedulePosition).observe(target);
    // Live score renders replace SVG nodes. Reattach semantics and the seam,
    // without changing the current animation phase or reloading team data.
  } else {
    const applyNativePresentation = (presentation) => {
      nativeSide = presentation?.side ?? null;
      nativeOpen = Boolean(presentation && presentation.phase !== 'closed' && presentation.phase !== 'closing');
      syncAccessibility();
    };
    window.scorebugDesktop?.getDetailsPresentation?.().then(applyNativePresentation).catch(()=>{});
    window.scorebugDesktop?.onDetailsPresentationChanged?.(applyNativePresentation);
    window.scorebugDesktop?.onDetailsVisibilityChanged?.((visible)=>{if(!visible){nativeOpen=false;syncAccessibility();}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&nativeOpen){event.preventDefault();close();}});
  }
  new MutationObserver(()=>{syncAccessibility();if(!native)schedulePosition();}).observe(target,{childList:true,subtree:true});
  syncAccessibility();
  return {open,close};
}
