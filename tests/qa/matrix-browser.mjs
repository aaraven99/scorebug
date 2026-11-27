import { renderScorebug } from '/scorebug.js';
import { getScorebugStyle } from '/scorebug-styles.js';
import { teamLogoPresentation } from '/team-assets.js';

const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
const intersection = (a,b) => ({ width: Math.min(a.right,b.right)-Math.max(a.x,b.x), height: Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y) });
const finiteRect = r => ['x','y','width','height','right','bottom'].every(k => Number.isFinite(r[k]));
const visibleNode = node => node && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden';
const visibleText = svg => [...svg.querySelectorAll('text')].filter(node => !node.closest('defs') && node.textContent.trim() && visibleNode(node));
const measureCanvas=document.createElement('canvas'),measureContext=measureCanvas.getContext('2d');
function glyphRect(node){
  const css=getComputedStyle(node),content=node.textContent;
  measureContext.font=`${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  measureContext.letterSpacing=css.letterSpacing==='normal'?'0px':css.letterSpacing;
  const measured=measureContext.measureText(content),advance=node.getComputedTextLength(),fit=measured.width?advance/measured.width:1;
  const anchor=node.getAttribute('text-anchor')||css.textAnchor,x=Number(node.getAttribute('x'))-(anchor==='middle'?advance/2:anchor==='end'?advance:0),y=Number(node.getAttribute('y')),m=node.getScreenCTM();
  const points=[new DOMPoint(x-measured.actualBoundingBoxLeft*fit,y-measured.actualBoundingBoxAscent),new DOMPoint(x+measured.actualBoundingBoxRight*fit,y-measured.actualBoundingBoxAscent),new DOMPoint(x-measured.actualBoundingBoxLeft*fit,y+measured.actualBoundingBoxDescent),new DOMPoint(x+measured.actualBoundingBoxRight*fit,y+measured.actualBoundingBoxDescent)].map(point=>point.matrixTransform(m));
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
  return{x:left,y:top,right,bottom,width:right-left,height:bottom-top};
}
function logoInkRect(image,team) {
  const {size,bounds}=teamLogoPresentation(team),m=image.getScreenCTM();
  const x=Number(image.getAttribute('x')),y=Number(image.getAttribute('y')),w=Number(image.getAttribute('width')),h=Number(image.getAttribute('height'));
  const a=new DOMPoint(x+w*bounds[0]/size[0],y+h*bounds[1]/size[1]).matrixTransform(m);
  const b=new DOMPoint(x+w*bounds[2]/size[0],y+h*bounds[3]/size[1]).matrixTransform(m);
  return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),right:Math.max(a.x,b.x),bottom:Math.max(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)};
}
function rgba(value){
  const numbers=String(value).match(/[\d.]+/g)?.map(Number);if(!numbers||numbers.length<3)return null;
  return{r:numbers[0],g:numbers[1],b:numbers[2],a:numbers[3]??1};
}
function contrast(a,b){const luminance=color=>[color.r,color.g,color.b].map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((value,channel,index)=>value+channel*[.2126,.7152,.0722][index],0);const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function contrastFindings(svg){
  const nodes=[...svg.querySelectorAll('*')],shapes=nodes.flatMap((node,index)=>{
    if(!node.matches('path,rect,polygon,circle,ellipse')||node.closest('defs')||typeof node.isPointInFill!=='function')return[];
    const css=getComputedStyle(node),fill=rgba(css.fill),opacity=Number(css.fillOpacity)*Number(css.opacity);
    if(!fill||fill.a*opacity<.95)return[];return[{node,index,fill,matrix:node.getScreenCTM().inverse()}];
  }),findings=[];
  for(const text of svg.querySelectorAll('.variant-score,.variant-classification-row text,.bug-abbreviation,.bug-vertical-abbreviation,.bug-team .variant-text')){
    if(!text.textContent.trim()||text.matches('.bug-score,.bug-vertical-score')||text.closest('.bug-timeouts,.variant-timeouts'))continue;
    const css=getComputedStyle(text),ink=rgba(css.fill),stroke=rgba(css.stroke);
    if(!ink||ink.a<.95||stroke?.a>=.75&&parseFloat(css.strokeWidth)>=1.2)continue;
    const bounds=glyphRect(text),center=new DOMPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2),index=nodes.indexOf(text);
    const back=[...shapes].reverse().find(shape=>shape.index<index&&shape.node.isPointInFill(center.matrixTransform(shape.matrix)));
    if(back)findings.push({content:text.textContent,ratio:contrast(ink,back.fill),ink:css.fill,background:getComputedStyle(back.node).fill,backdrop:{className:back.node.getAttribute('class'),path:back.node.getAttribute('d'),x:back.node.getAttribute('x'),y:back.node.getAttribute('y')},glyph:bounds});
  }
  return findings;
}

function inspect(svg, item, width) {
  let assertions=0;const failures=[];
  const check=(condition,code,detail='')=>{assertions++;if(!condition)failures.push({code,detail});};
  const {game,styleId,orientation}=item,style=getScorebugStyle(styleId);
  const box=rect(svg),scale=width/Number(svg.dataset.artworkWidth),tolerance=2.5*scale;
  check(finiteRect(box)&&box.width>0&&box.height>0,'finite-svg',box);
  check(Math.abs(box.width-width)<.2,'requested-width',{actual:box.width,expected:width});
  for(const [key,expected] of Object.entries({gameId:game.id,leagueId:game.leagueId,styleId,sport:game.sport,orientation}))check(svg.dataset[key]===expected,`metadata-${key}`,{actual:svg.dataset[key],expected});
  check(!/\b(?:NaN|Infinity|undefined)\b/.test(svg.outerHTML),'invalid-rendered-value');
  const ids=[...svg.querySelectorAll('[id]')].map(node=>node.id),idSet=new Set(ids);
  check(ids.length===idSet.size,'duplicate-svg-id');
  for(const node of svg.querySelectorAll('*'))for(const attribute of node.attributes){
    const refs=[...attribute.value.matchAll(/url\(#([^\)]+)\)/g)].map(match=>match[1]);
    if(['href','xlink:href'].includes(attribute.name)&&attribute.value.startsWith('#'))refs.push(attribute.value.slice(1));
    if(attribute.name==='aria-labelledby')refs.push(...attribute.value.split(/\s+/));
    for(const reference of refs)check(idSet.has(reference),'missing-svg-reference',reference);
  }
  for(const reference of (svg.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean))check(idSet.has(reference),'missing-accessible-label',reference);
  const texts=visibleText(svg);
  for(const node of texts){
    const bounds=rect(node),content=node.textContent.trim();
    check(finiteRect(bounds)&&bounds.width>0&&bounds.height>0,'finite-text',{content,bounds});
    check(bounds.x>=box.x-tolerance&&bounds.right<=box.right+tolerance&&bounds.y>=box.y-tolerance&&bounds.bottom<=box.bottom+tolerance,'text-outside-svg',{content,bounds,svg:box});
  }
  // Paint colors are width-invariant in these SVG styles. Check them once per
  // combination/pass at full width; all three widths still get geometry checks.
  if(width===(orientation==='vertical'?160:600))for(const item of contrastFindings(svg))check(item.ratio>=3,'critical-text-contrast',item);
  const targets=[...svg.querySelectorAll('.bug-details-target')];
  const targetSides=targets.map(node=>node.dataset.detailsSide).sort();
  const expectedSides=['race','leaderboard'].includes(game.kind)?['comparison']:['away','comparison','home'];
  check(JSON.stringify(targetSides)===JSON.stringify(expectedSides),'details-targets',{actual:targetSides,expected:expectedSides});
  for(const target of targets)check(target.getAttribute('role')==='button'&&target.getAttribute('tabindex')==='0'&&Boolean(target.getAttribute('aria-label')),'keyboard-details-target');
  const text=texts.map(node=>node.textContent).join(' ').replace(/\s+/g,' ').toUpperCase();
  if(['race','leaderboard'].includes(game.kind)){
    const rows=[...svg.querySelectorAll('.variant-classification-row')],expectedRows=Math.min(game.entries.length,game.kind==='race'?item.racingRows:(orientation==='vertical'?9:6));
    check(rows.length===expectedRows,'classification-count',{actual:rows.length,expected:expectedRows});
    check(svg.querySelectorAll('.bug-team').length===0,'classification-no-fake-teams');
    check(text.includes(game.sessionName.toUpperCase()),'classification-session',text);
    for(const [index,row] of rows.entries()){
      check(row.dataset.entryId===game.entries[index].id,'classification-order',{actual:row.dataset.entryId,expected:game.entries[index].id});
      const columns=[...row.querySelectorAll('text')];
      check(columns[0]?.textContent===String(index+1),'classification-position');
      if(columns.length>=3){const overlap=intersection(glyphRect(columns[1]),glyphRect(columns[2]));check(overlap.width<=.8*scale||overlap.height<=.8*scale,'classification-name-gap-overlap',{texts:columns.map(node=>node.textContent),overlap});}
      const rowPanel=row.querySelector('path'),value=columns.at(-1);
      if(rowPanel&&value){const bounds=glyphRect(value),inset=.2*scale,toPanel=rowPanel.getScreenCTM().inverse(),points=[[bounds.right-inset,bounds.y+inset],[bounds.right-inset,bounds.y+bounds.height/2],[bounds.right-inset,bounds.bottom-inset]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(toPanel));check(points.every(point=>rowPanel.isPointInFill(point)),'classification-value-outside-panel',{value:value.textContent,bounds,points:points.map(point=>({x:point.x,y:point.y}))});}
    }
  } else {
    const groups=[...svg.querySelectorAll('.bug-team[data-team-side]')];
    check(groups.length===2,'team-count',groups.length);
    for(const group of groups){
      const side=group.dataset.teamSide,team=game[side],score=group.querySelector('.bug-score,.variant-score,.bug-vertical-score');
      const pointScore=style.family==='sets'&&['tennis','volleyball'].includes(game.sport);
      const expected=pointScore?game.situation[side==='away'?'awayPoints':'homePoints']:team.score;
      check(score?.textContent===String(expected),'correct-score',{side,actual:score?.textContent,expected});
      if(score){
        const logo=group.querySelector('.bug-team-logo'),fallback=group.querySelector('[data-scorebug-image-fallback]');
        if(visibleNode(logo)){const overlap=intersection(logoInkRect(logo,team),glyphRect(score));check(overlap.width<=1.1*scale||overlap.height<=1.1*scale,'logo-score-overlap',{side,overlap});}
        if(fallback){const overlap=intersection(rect(fallback),glyphRect(score));check(overlap.width<=1.1*scale||overlap.height<=1.1*scale,'fallback-score-overlap',{side,overlap});}
        const possession=group.querySelector('.bug-possession');
        if(possession){const overlap=intersection(rect(possession),glyphRect(score));check(overlap.width<=1.1*scale||overlap.height<=1.1*scale,'possession-score-overlap',{side,overlap});}
      }
      const logo=group.querySelector('.bug-team-logo');
      if(visibleNode(logo))for(const label of [...group.querySelectorAll('text')].filter(node=>!node.matches('.bug-team-logo-fallback-label')&&node.textContent.trim()===String(team.abbreviation))){const overlap=intersection(logoInkRect(logo,team),glyphRect(label));check(overlap.width<=1.1*scale||overlap.height<=1.1*scale,'logo-caption-overlap',{side,caption:label.textContent,overlap});}
      if(logo?.dataset.imageState==='error')check(!visibleNode(logo)&&Boolean(group.querySelector('.bug-team-logo-fallback-label')?.textContent.trim()),'failed-logo-has-readable-fallback',{side});
      const panel=group.querySelector('.bug-team-panel');
      const panelStyle=panel&&getComputedStyle(panel),visiblePanel=panelStyle&&panelStyle.fill!=='none'&&(rgba(panelStyle.fill)?.a??1)*Number(panelStyle.fillOpacity)*Number(panelStyle.opacity)>.05;
      if(visiblePanel&&typeof panel.isPointInFill==='function')for(const timeout of group.querySelectorAll('.variant-timeouts rect')){
        const x=Number(timeout.getAttribute('x')),y=Number(timeout.getAttribute('y')),w=Number(timeout.getAttribute('width')),h=Number(timeout.getAttribute('height')),toPanel=panel.getScreenCTM().inverse().multiply(timeout.getScreenCTM());
        const corners=[[x+.05,y+.05],[x+w-.05,y+.05],[x+w-.05,y+h-.05],[x+.05,y+h-.05]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(toPanel));
        check(corners.every(point=>panel.isPointInFill(point)),'timeout-outside-team-panel',{side,x,y,width:w,height:h});
      }
    }
    if(['football','basketball','hockey','soccer','rugby'].includes(game.sport))check(text.includes(game.clock.toUpperCase()),'correct-clock',{text,clock:game.clock});
    if(game.sport==='football')check(text.includes('3RD & 7'),'football-down',text);
    if(game.sport==='basketball')check(text.includes('18 SHOT'),'basketball-shot-clock',text);
    if(game.sport==='baseball'){
      check(text.includes('2–1'),'baseball-count',text);check(text.includes('1 OUT'),'baseball-outs',text);
      check(Boolean(svg.querySelector('.variant-diamond')),'baseball-bases');
    }
    if(game.sport==='hockey')check(text.includes('POWER PLAY'),'hockey-power-play',text);
    if(['tennis','volleyball'].includes(game.sport))check(text.includes(String(game.situation.awayPoints))&&text.includes(String(game.situation.homePoints)),'set-points',text);
    if(game.sport!=='football')check(!/\b(?:3RD & 7|DOWN|TOUCHDOWN)\b/.test(text),'no-football-semantics',text);
  }
  return {width,assertions,failures,textNodes:texts.length,domNodes:svg.querySelectorAll('*').length};
}

export async function runBatch(cases) {
  const root=document.getElementById('qa-root');root.replaceChildren();
  const start=performance.now();
  const holders=[];
  for(const item of cases){
    const profiles=item.orientation==='vertical'?[160,144,112]:[600,420,300];
    for(const [profile,width]of profiles.entries()){
      const host=document.createElement('div');host.className='qa-case';host.style.width=`${width}px`;host.dataset.case=item.id;host.dataset.profile=profile;
      host.innerHTML=renderScorebug(item.game,{idPrefix:`qa-${item.id}-${profile}`,styleId:item.styleId,orientation:item.orientation,interactive:true,racingRows:item.racingRows});
      root.append(host);holders.push({item,width,host});
    }
  }
  await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(resolve));
  const results=new Map(cases.map(item=>[item.id,{id:item.id,pass:item.pass,leagueId:item.game.leagueId,styleId:item.styleId,orientation:item.orientation,profiles:[]} ]));
  for(const {item,width,host}of holders){
    const svgs=host.querySelectorAll('svg.scorebug');
    results.get(item.id).profiles.push(svgs.length===1?inspect(svgs[0],item,width):{width,assertions:1,failures:[{code:'svg-count',detail:svgs.length}],textNodes:0,domNodes:0});
  }
  return {results:[...results.values()],elapsedMs:performance.now()-start,domNodes:root.querySelectorAll('*').length,heapBytes:performance.memory?.usedJSHeapSize??null};
}

export async function contactSheet(items,{vertical=false,title='Scorebug QA'}={}) {
  const root=document.getElementById('qa-root');root.replaceChildren();root.className=vertical?'qa-sheet qa-sheet-vertical':'qa-sheet';
  const heading=document.createElement('h1');heading.textContent=title;root.append(heading);
  for(const item of items){const article=document.createElement('article'),label=document.createElement('p'),host=document.createElement('div');label.textContent=`${item.game.leagueId.toUpperCase()} · ${getScorebugStyle(item.styleId).name}`;host.style.width=vertical?'144px':'480px';host.innerHTML=renderScorebug(item.game,{styleId:item.styleId,orientation:vertical?'vertical':'horizontal',idPrefix:`sheet-${items.indexOf(item)}`,racingRows:6,interactive:false});article.append(label,host);root.append(article);}
  await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const decoded=new Map(await Promise.all([...new Set([...root.querySelectorAll('image')].map(image=>image.getAttribute('href')))].map(src=>new Promise(resolve=>{
    const image=new Image(),timer=setTimeout(()=>resolve([src,{loaded:false,reason:'Image did not finish within 5 seconds'}]),5000);
    image.onload=()=>{clearTimeout(timer);resolve([src,{loaded:image.naturalWidth>0&&image.naturalHeight>0,width:image.naturalWidth,height:image.naturalHeight}]);};
    image.onerror=()=>{clearTimeout(timer);resolve([src,{loaded:false,reason:'Image load failed'}]);};image.src=src;
  }))));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const images=[...root.querySelectorAll('image[data-scorebug-image]')],assets=images.map(image=>{
    const fallback=image.nextElementSibling?.matches('[data-scorebug-image-fallback]')?image.nextElementSibling:null,label=fallback?.querySelector('.bug-team-logo-fallback-label');
    const src=image.getAttribute('href');return{src,...decoded.get(src),state:image.dataset.imageState,hidden:!visibleNode(image),fallbackLabel:label?.textContent??null,fallbackVisible:Boolean(label&&visibleNode(label)&&rect(label).width>0)};
  });
  return {width:root.scrollWidth,height:root.scrollHeight,assets};
}

window.ScorebugQA={runBatch,contactSheet};
