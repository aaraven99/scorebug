/** Shared browser/native blade outline. All coordinates are local CSS pixels. */
export const BLADE_OPEN_MS = 240;
export const BLADE_CLOSE_MS = 220;
export const BLADE_SIZE = Object.freeze({ width: 320, height: 344 });
export const COMPARISON_BLADE_SIZE = Object.freeze({ width: 408, height: 450 });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const round = (value) => Math.round(value * 100) / 100;

/** Keep the source panel's object-bounding-box gradient in blade coordinates. */
export function bladeGradientSpace(width, height, presentation = {}) {
  const valid = ['gradientX', 'gradientY', 'gradientWidth', 'gradientHeight']
    .every((key) => Number.isFinite(presentation[key])) && presentation.gradientWidth > 0 && presentation.gradientHeight > 0;
  const x = valid ? presentation.gradientX : 0;
  const y = valid ? presentation.gradientY : 0;
  const w = valid ? presentation.gradientWidth : Math.max(1, finite(width, BLADE_SIZE.width));
  const h = valid ? presentation.gradientHeight : Math.max(1, finite(height, BLADE_SIZE.height));
  // Scaling a normalized gradient preserves SVG's nonuniform bounding-box
  // transform. Moving its endpoints alone changes the gradient's angle.
  return { x, y, width: w, height: h, transform: `translate(${x} ${y}) scale(${w} ${h})` };
}

export function bladeOutline(width, height, presentation = {}) {
  const w = Math.max(64, finite(width, BLADE_SIZE.width)), h = Math.max(64, finite(height, BLADE_SIZE.height));
  const direction = ['left', 'right', 'up', 'down'].includes(presentation.direction) ? presentation.direction : 'right';
  const s = Math.min(14, w * .065, h * .08), edge = .8;
  let points, inset, connector = null;
  if (direction === 'left' || direction === 'right') {
    const jt = clamp(finite(presentation.joinTop, 1), edge, h - 9);
    const jb = clamp(finite(presentation.joinBottom, Math.min(h - 1, jt + 72)), jt + 8, h - edge);
    const x1 = clamp(finite(presentation.joinTopX, direction === 'left' ? w - 1 : 15), edge, w - edge);
    const x2 = clamp(finite(presentation.joinBottomX, direction === 'left' ? w - 15 : 1), edge, w - edge);
    if (direction === 'right') {
      const shoulder = Math.min(w * .28, Math.max(32, Math.max(x1, x2) + 12));
      points = [[x1,jt],[shoulder,jt],[shoulder+s/2,edge],[w-edge,edge],[w-s-edge,h-edge],[shoulder-s/2,h-edge],[shoulder,jb],[x2,jb]];
      inset = { top:10, right:s+12, bottom:9, left:shoulder+12 };
    } else {
      const shoulder = Math.max(w * .72, Math.min(w-32, Math.min(x1,x2)-12));
      points = [[x1,jt],[shoulder,jt],[shoulder+s/2,edge],[s+edge,edge],[edge,h-edge],[shoulder-s/2,h-edge],[shoulder,jb],[x2,jb]];
      inset = { top:10, right:w-shoulder+12, bottom:9, left:s+12 };
    }
  } else {
    const jl = clamp(finite(presentation.joinLeft, w*.2), edge, w-9);
    const jr = clamp(finite(presentation.joinRight, w*.8), jl+8, w-edge);
    const jy = clamp(finite(presentation.joinY, direction === 'up' ? h-1 : 1), edge, h-edge);
    if (direction === 'up') {
      const shoulder = Math.max(h*.68, Math.min(h-24,jy-12));
      points = [[s+edge,edge],[w-edge,edge],[w-s,shoulder],[Math.min(w-s,jr+4),shoulder],[jr,jy],[jl,jy],[Math.min(w-s,jl+4),shoulder],[edge,shoulder]];
      inset = { top:10, right:s+10, bottom:h-shoulder+9, left:s+12 };
    } else {
      const shoulder = Math.min(h-24,Math.max(24,jy+12,jy+finite(presentation.neckHeight,0)));
      points = [[jl,jy],[jr,jy],[Math.max(s,jr-4),shoulder],[w-edge,shoulder],[w-s,h-edge],[edge,h-edge],[s,shoulder],[Math.max(s,jl-4),shoulder]];
      inset = { top:shoulder+9, right:s+10, bottom:9, left:s+12 };
      // The neck and body share one solid fill.
      connector = { start: jy, end: shoulder };
    }
  }
  const pairs = points.map(([x,y])=>[round(x),round(y)]);
  // Outline the complete expanding shape, including its narrow join.
  return {
    direction, width:w, height:h, inset, connector,
    path:`M${pairs.map(([x,y])=>`${x} ${y}`).join('L')}Z`,
    borderPath:`M${pairs.map(([x,y])=>`${x} ${y}`).join('L')}Z`,
    clip:`polygon(${pairs.map(([x,y])=>`${x}px ${y}px`).join(',')})`,
  };
}
