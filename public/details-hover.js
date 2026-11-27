/** Joined team blades. Windows uses the same renderer in a transparent surface. */
import { bladeOutline, BLADE_SIZE, BLADE_OPEN_MS, BLADE_CLOSE_MS } from './details-blade.js';

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
  const team = target.querySelector(`[data-team-side="${side}"]`);
  const path = team?.querySelector('.bug-team-panel');
  if (!path) return null;
  const svg = path.closest('svg'), orientation = svg?.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const points = pathCorners(path), strip = pathCorners(svg?.querySelector('.bug-situation-panel'));
  const fill = /^url\(#([\w-]+)\)$/.exec(path.getAttribute('fill') || '');
  const color = fill && svg.querySelector(`[id="${fill[1]}"] stop[offset=".58"]`)?.getAttribute('stop-color');
  return { team, points, lowerEdge:strip ? [strip[3],strip[2]] : [points[3],points[2]], orientation, teamColor: /^#[\da-f]{6}$/i.test(color || '') ? color : undefined };
}

function placement(anchor, side) {
  const [tl,tr,br,bl] = anchor.points, margin = 6;
  const vw = innerWidth, vh = innerHeight;
  const [stripLeft,stripRight] = anchor.lowerEdge;
  const available = { left:tl.x-margin+1, right:vw-margin-br.x+1, up:tl.y-margin+1, down:vh-margin-stripLeft.y+1 };
  const preferred = side === 'away' ? 'left' : 'right';
  const lateral = anchor.orientation === 'vertical' ? [preferred, preferred === 'left' ? 'right' : 'left'] : [preferred];
  let direction = lateral.find(value => available[value] >= 236);
  if (!direction) direction = available.up >= 174 ? 'up' : available.down >= 174 ? 'down' : null;
  if (!direction) direction = lateral.find(value => available[value] >= 190);
  if (!direction) direction = available.up > available.down ? 'up' : 'down';
  let width = Math.min(BLADE_SIZE.width,vw-margin*2), height = Math.min(BLADE_SIZE.height,vh-margin*2), x,y,joins;
  if (direction === 'left' || direction === 'right') {
    width = Math.max(128,Math.min(width,available[direction]));
    y = clamp((tl.y+bl.y-height)/2,margin,Math.max(margin,vh-height-margin));
    if (direction === 'left') { x=tl.x-width+1; joins={joinTop:tl.y-y,joinBottom:bl.y-y,joinTopX:tl.x-x,joinBottomX:bl.x-x}; }
    else { x=br.x-1; joins={joinTop:tr.y-y,joinBottom:br.y-y,joinTopX:tr.x-x,joinBottomX:br.x-x}; }
  } else {
    height = Math.max(64,Math.min(height,available[direction]));
    // A downward expansion starts beneath the full information strip, so its
    // connecting neck cannot cover the clock or down-and-distance text.
    const a = direction === 'up' ? tl : {x:Math.max(bl.x,stripLeft.x),y:stripLeft.y};
    const b = direction === 'up' ? tr : {x:Math.min(br.x,stripRight.x),y:stripRight.y};
    x = clamp((a.x+b.x-width)/2,margin,Math.max(margin,vw-width-margin));
    y = direction === 'up' ? a.y-height+1 : a.y-1;
    joins = {joinLeft:a.x-x,joinRight:b.x-x,joinY:a.y-y};
  }
  return {x,y,width,height,presentation:{side,direction,orientation:anchor.orientation,teamColor:anchor.teamColor,...joins}};
}

export function attachDetailsHover(target, { native = false, enabled = () => true, defaultSide = () => 'home' } = {}) {
  let panel = null, frame = null, side = null, pendingSide = null, queuedSide = null, phase = 'closed';
  let opening, closing, retiring, entering, positioning, loaded = false, focusStay = false, dismissedSide = null;
  const origin = new URL(document.baseURI).origin;
  const panelId = `scorebug-team-blade-${++nextPanel}`;
  const teamElement = (value) => target.querySelector(`[data-team-side="${value}"]`);
  function syncAccessibility() {
    for (const team of target.querySelectorAll('[data-team-side]')) {
      team.setAttribute('aria-expanded',String(Boolean(panel && team.dataset.teamSide === side && phase !== 'closing')));
      team.setAttribute('aria-controls',panelId);
    }
  }
  function position() {
    positioning = null;
    if (!panel) return;
    if (!enabled()) { close(); return; }
    const anchor = teamAnchor(target,side);
    if (!anchor) { close(); return; }
    const {x,y,width,height,presentation} = placement(anchor,side);
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
        frame.title=`${side==='away'?'Away':'Home'} team stats`;
        position();requestAnimationFrame(reveal);
      }else remove({restoreFocus});
    },BLADE_CLOSE_MS+30);
  }
  function open(value=defaultSide(),{focus=false}={}) {
    clearTimeout(opening);clearTimeout(closing);pendingSide=null;
    if(!enabled())return;
    value=value==='away'?'away':'home';
    if(native){window.scorebugDesktop?.showDetails?.(value);return;}
    dismissedSide=null;focusStay=focusStay||focus;
    if(panel && side!==value){close({switchTo:value});return;}
    if(panel){queuedSide=null;if(phase==='closing')reveal();else position();return;}
    side=value;phase='closed';loaded=false;
    panel=document.createElement('div');panel.className='details-popover';panel.id=panelId;
    frame=document.createElement('iframe');frame.title=`${side==='away'?'Away':'Home'} team stats`;
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
    const team=event.target.closest?.('[data-team-side]');
    if(team){event.preventDefault();open(team.dataset.teamSide,{focus:true});}
  });
  if(!native){
    target.addEventListener('pointermove',event=>{
      if(event.pointerType==='touch')return;
      const team=event.target.closest?.('[data-team-side]');
      if(team&&target.contains(team))schedule(team.dataset.teamSide);else delayedClose();
    });
    target.addEventListener('pointerleave',()=>{dismissedSide=null;delayedClose();});
    target.addEventListener('focusin',event=>{const team=event.target.closest?.('[data-team-side]');if(team){focusStay=true;schedule(team.dataset.teamSide);}});
    target.addEventListener('focusout',event=>{if(!target.contains(event.relatedTarget)&&event.relatedTarget!==frame){focusStay=false;delayedClose();}});
    target.addEventListener('click',event=>{const team=event.target.closest?.('[data-team-side]');if(team)open(team.dataset.teamSide,{focus:event.detail===0||event.pointerType==='touch'});});
    window.addEventListener('resize',schedulePosition);
    window.addEventListener('scroll',schedulePosition,{passive:true});
    window.addEventListener('message',event=>{if(event.origin===origin&&event.source===frame?.contentWindow&&event.data?.type==='scorebug:close-details')close({restoreFocus:true});});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close({restoreFocus:true});});
    document.addEventListener('pointerdown',event=>{if(panel&&!target.contains(event.target)&&!panel.contains(event.target)){focusStay=false;close();}});
    window.addEventListener('pagehide',()=>close({immediate:true}));
    new ResizeObserver(schedulePosition).observe(target);
    // Live score renders replace SVG nodes. Reattach semantics and the seam,
    // without changing the current animation phase or reloading team data.
    new MutationObserver(()=>{syncAccessibility();schedulePosition();}).observe(target,{childList:true,subtree:true});
    syncAccessibility();
  }
  return {open,close};
}
