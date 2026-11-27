import { sportFor, formatPeriod, formatSituation, getLeague } from './sports.js';

const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const num = (value) => Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null;
const safeColor = (value,fallback='#27313b') => /^#?[\da-f]{6}$/i.test(String(value || '')) ? `#${String(value).replace('#','')}` : fallback;
const rectPath = (x,y,w,h,r=0) => r ? `M${x+r} ${y}H${x+w-r}Q${x+w} ${y} ${x+w} ${y+r}V${y+h-r}Q${x+w} ${y+h} ${x+w-r} ${y+h}H${x+r}Q${x} ${y+h} ${x} ${y+h-r}V${y+r}Q${x} ${y} ${x+r} ${y}Z` : `M${x} ${y}H${x+w}V${y+h}H${x}Z`;
function label(value,x,y,size=20,{anchor='start',fill='#f8fafc',weight=700,width,className='',italic=false}={}) {
  const content=String(value ?? '—');
  // Font-independent conservative sizing: preserve natural widths until a
  // long team name, cricket total, or race interval actually needs fitting.
  const estimated=content.length*size*(weight>=800?.63:.6);
  const fit=width&&estimated>width?` textLength="${width}" lengthAdjust="spacingAndGlyphs"`:'';
  return `<text class="variant-text ${className}" x="${x}" y="${y}" text-anchor="${anchor}" style="font-size:${size}px;font-weight:${weight};font-style:${italic?'italic':'normal'};fill:${fill}"${fit}>${esc(content)}</text>`;
}
function target(side,x,y,w,h,name='') {
  const title=side==='comparison'?'Compare statistics and game situation':`${name || 'Team'} statistics`;
  return `<g class="bug-details-target${side==='comparison'?' bug-details-target--comparison':' bug-details-target--team'}" data-details-side="${side}" role="button" tabindex="0" aria-label="${esc(title)}" aria-haspopup="dialog" aria-expanded="false"><title>${esc(title)}</title><path class="bug-hover-region" d="${rectPath(x,y,w,h)}"/></g>`;
}
function statusLabel(game) {
  if(!game)return 'SELECT A GAME';
  if(game.phase==='final'||game.state==='post'){
    const sport=sportFor(game),shootout=game.situation?.shootout;
    if(sport==='soccer'&&shootout&&(shootout.away!=null||shootout.home!=null))return `FINAL · PENS ${shootout.away??'—'}–${shootout.home??'—'}`;
    const regulation=getLeague(game.leagueId)?.regulationPeriods||(sport==='hockey'?3:4);
    return ['football','basketball','hockey'].includes(sport)&&Number(game.period)>regulation?'FINAL / OT':'FINAL';
  }
  if(game.phase==='halftime')return 'HALFTIME';
  if(['delayed','postponed','suspended','canceled','cancelled'].includes(game.phase))return game.phase.toUpperCase();
  if(game.state==='pre'||game.phase==='scheduled') {
    const date=game.startTime?new Date(game.startTime):new Date(NaN);
    return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-US',{weekday:'short',hour:'numeric',minute:'2-digit'}).format(date).toUpperCase():'SCHEDULED';
  }
  return '';
}
function scoreValue(team,sport) {
  if(sport==='cricket'&&typeof team.scoreDisplay==='string')return team.scoreDisplay.slice(0,14);
  if(team.score===null||team.score===undefined||team.score==='')return '—';
  if(sport==='tennis'&&typeof team.score==='string'&&/^(?:AD|[\d/-]{1,10})$/.test(team.score))return team.score;
  const value=Number(team.score);return Number.isFinite(value)&&value>=0&&value<10000?String(value):'—';
}
function view(game) {
  const sport=sportFor(game),s=game?.situation||{},banner=statusLabel(game);
  let clock=typeof game?.clock==='string'&&game.clock.trim()?game.clock.trim():'—';
  clock=clock.replace(/\s+/g,'');
  if(!/^\d{1,3}(?::[0-5]\d)?(?:\.\d)?(?:['′])?(?:\+\d{1,2}(?:['′])?)?$/.test(clock))clock='—';
  if(['baseball','tennis','volleyball','cricket','golf'].includes(sport))clock='';
  let detail=formatSituation(game||{});
  if(sport==='football')detail=game?.downDistance||s.downDistance||'DOWN —';
  if(sport==='basketball')detail=s.shotClock!=null?`${s.shotClock} SHOT`:s.bonus?'BONUS':'';
  if(sport==='baseball'){clock=s.balls!=null&&s.strikes!=null?`${s.balls}–${s.strikes}`:'—';detail=s.outs!=null?`${s.outs} OUT${s.outs===1?'':'S'}`:'';}
  if(['tennis','volleyball'].includes(sport)){const a=s.awayPoints??game?.away?.points,h=s.homePoints??game?.home?.points;if(a!=null||h!=null)detail=`${a??'—'} – ${h??'—'}`;else if(s.pointScore)detail=s.pointScore;}
  if(sport==='soccer'&&s.shootout&&(s.shootout.away!=null||s.shootout.home!=null))detail=`PENS ${s.shootout.away??'—'}–${s.shootout.home??'—'}`;
  if(sport==='hockey'&&s.powerPlayTeamId)detail=`POWER PLAY${s.powerPlayTime?' '+s.powerPlayTime:''}`;
  const field=sport==='football'?(game?.fieldPosition||s.fieldPosition||''):'';
  return {sport,s,banner,period:formatPeriod(game||{}).toUpperCase(),clock,detail:String(detail).toUpperCase(),field};
}
function paletteFor(style,team,side,helpers) {
  const base=helpers.teamPalette(team,side),v=style.variant;
  if(['white','pl-white','mls','sportsnet'].includes(v))return {...base,fill:'#f2f4f5',border:'#b9c4cc',ink:'#101820',accent:base.fill};
  if(['pl-purple','rugby'].includes(v))return {...base,fill:side==='away'?base.fill:'#eeeef6',border:'#2f073e',ink:side==='away'?base.ink:'#15101d',accent:base.fill};
  if(v==='ucl')return {...base,fill:'#0719a8',border:'#253be0',ink:'#ffffff',accent:base.fill};
  if(v==='world-cup')return {...base,fill:'#841435',border:'#5c0d28',ink:'#ffffff',accent:base.fill};
  if(v==='vnl')return {...base,fill:'#223b98',border:'#182869',ink:'#ffffff',accent:base.fill};
  if(['venom','neon','college-dark','cbb-center','gridiron','compact-pill','apple'].includes(v))return {...base,fill:'#14181e',border:base.fill,ink:'#ffffff',accent:base.fill};
  if(v==='nba-pods'&&side==='home')return {...base,fill:'#f2e7db',border:'#cbb6a5',ink:base.fill,accent:base.fill};
  return {...base,accent:base.fill};
}
function panelShape(x,y,w,h,shape='rect',side='away') {
  if(shape==='slant')return `M${x+12} ${y}H${x+w}L${x+w-12} ${y+h}H${x}Z`;
  if(shape==='shield')return side==='away'?`M${x} ${y}H${x+w-13}L${x+w} ${y+h}H${x+22}Z`:`M${x+13} ${y}H${x+w}L${x+w-22} ${y+h}H${x}Z`;
  if(shape==='curved')return side==='away'?`M${x} ${y}H${x+w}V${y+h-15}Q${x+w/2} ${y+h-19} ${x} ${y+h}Z`:`M${x} ${y}H${x+w}V${y+h}Q${x+w/2} ${y+h-19} ${x} ${y+h-15}Z`;
  if(shape==='triangle')return side==='away'?`M${x+22} ${y}H${x+w-16}Q${x+w} ${y} ${x+w} ${y+14}V${y+h}H${x}L${x+8} ${y+16}Q${x+11} ${y} ${x+22} ${y}Z`:`M${x} ${y}H${x+w-22}Q${x+w-11} ${y} ${x+w-8} ${y+16}L${x+w} ${y+h}H${x}Z`;
  if(shape==='bevel')return `M${x+9} ${y}H${x+w-9}L${x+w} ${y+9}V${y+h-9}L${x+w-9} ${y+h}H${x+9}L${x} ${y+h-9}V${y+9}Z`;
  return rectPath(x,y,w,h,shape==='round'?12:shape==='pill'?Math.min(h/2,26):0);
}
function marker(game,team,x,y,size,helpers) {
  const sport=sportFor(game),s=game?.situation||{};
  const id=['tennis','volleyball'].includes(sport)?s.servingTeamId:game?.possessionTeamId;
  if(game?.state!=='in'||game?.phase&&game.phase!=='live'||!id||String(id)!==String(team.id))return '';
  if(sport==='football')return helpers.possession(x,y,size/36);
  const name=['tennis','volleyball'].includes(sport)?'Serving':sport==='baseball'?'Batting':'Has possession';
  let inner='';const r=size/2;
  if(sport==='basketball')inner=`<circle r="${r}" fill="#e99035"/><path d="M-${r} 0H${r}M0-${r}V${r}M-${r*.7}-${r*.7}Q${r*.6} 0-${r*.7} ${r*.7}M${r*.7}-${r*.7}Q-${r*.6} 0 ${r*.7} ${r*.7}" fill="none" stroke="#3d2616" stroke-width="1"/>`;
  else if(sport==='baseball')inner=`<circle r="${r}" fill="#fffaf0" stroke="#5b5d62" stroke-width=".8"/><path d="M-${r*.68}-${r*.68}Q${r*.25} 0-${r*.68} ${r*.68}M${r*.68}-${r*.68}Q-${r*.25} 0 ${r*.68} ${r*.68}" fill="none" stroke="#c72d3e" stroke-width="1.4" stroke-dasharray="1.4 .8"/>`;
  else if(sport==='volleyball')inner=`<circle r="${r}" fill="#f3d640" stroke="#2b3c5b" stroke-width=".9"/><path d="M0-${r}Q${r} 0 0 ${r}M-${r} 0Q0 ${r*.5} ${r*.5}-${r*.85}" fill="none" stroke="#2863b2" stroke-width="${r*.48}"/>`;
  else if(sport==='rugby')inner=`<ellipse rx="${r}" ry="${r*.62}" fill="#fff9ed" stroke="#303743"/><path d="M-${r*.55}-${r*.5}Q-${r*.2} 0-${r*.55} ${r*.5}M${r*.55}-${r*.5}Q${r*.2} 0 ${r*.55} ${r*.5}" fill="none" stroke="#475aac" stroke-width="1.5"/>`;
  else if(sport==='hockey')inner=`<ellipse rx="${r}" ry="${r*.6}" fill="#17212b" stroke="#fff" stroke-width="1.5"/>`;
  else if(sport==='tennis')inner=`<circle r="${r}" fill="#d4e856" stroke="#314222"/><path d="M-${r*.7}-${r*.7}Q${r*.8} 0-${r*.7} ${r*.7}" fill="none" stroke="#fff"/>`;
  else inner=`<circle r="${r}" fill="#fffdf5" stroke="#1b2531"/><path d="M0-${r*.6}L${r*.55}-${r*.18}L${r*.34} ${r*.5}H-${r*.34}L-${r*.55}-${r*.18}Z" fill="#23313a"/>`;
  return `<g class="bug-possession bug-possession--${sport}" transform="translate(${x} ${y})" role="img" aria-label="${name}">${inner}</g>`;
}
function timeoutRail(team,x,y,w,options,game,paint,{vertical=false}={}) {
  if(options.showTimeouts===false)return '';
  const sport=sportFor(game);if(!['football','basketball','volleyball'].includes(sport))return '';
  const remaining=num(team.timeouts);if(remaining===null)return '';
  const max=num(team.maxTimeouts)??(sport==='football'?3:sport==='volleyball'?2:Math.max(remaining,1));
  if(remaining<0||remaining>max||max>8)return '';
  const length=Math.max(3,(w-(max-1)*3)/max);
  return `<g class="variant-timeouts" role="img" aria-label="${remaining} timeouts remaining">${Array.from({length:max},(_,i)=>`<rect x="${vertical?x:x+i*(length+3)}" y="${vertical?y+i*(length+3):y}" width="${vertical?3:length}" height="${vertical?length:3}" fill="${paint.ink}" opacity="${i<remaining?1:.2}"/>`).join('')}</g>`;
}
function teamGroup(team,side,box,ctx,{scoreSize=43,name=true,logoWidth=56,logoOnly=false,scoreCard=false,reverse=false,shape='rect',strip=false}={}) {
  const {x,y,w,h}=box,{style,helpers,options,game}=ctx,paint=paletteFor(style,team,side,helpers);
  const path=panelShape(x,y,w,h,shape,side),centerY=y+h*.48;
  const scoreX=reverse?x+42:x+w-40,logoX=reverse?x+w-47:x+47;
  const number=scoreValue(team,sportFor(game));
  const large=number.length>3?scoreSize*.7:number.length===3?scoreSize*.83:scoreSize;
  const textX=reverse?x+w-48:x+47;
  const logo=helpers.logoImage(team,logoX,centerY,logoWidth,Math.min(56,h-24));
  let contents=`<path class="bug-team-panel" d="${path}" fill="${paint.fill}" stroke="${paint.border}" stroke-width="2"/>`;
  if(paint.accent!==paint.fill)contents+=`<path d="M${x+2} ${y+2}H${x+w-2}" stroke="${paint.accent}" stroke-width="4"/>`;
  if(scoreCard)contents+=`<path d="${rectPath(reverse?x+3:x+w-76,y+3,73,h-6,2)}" fill="#eff2f3"/>`;
  if(strip)contents+=`<path d="M${x+1} ${y+h-10}H${x+w-1}" stroke="${paint.accent}" stroke-width="7"/>`;
  contents+=logo||label(team.abbreviation||'—',logoX,centerY+8,Math.min(23,logoWidth/2),{anchor:'middle',fill:paint.ink,width:logoWidth});
  const abbreviationY=y+h-(shape==='curved'?22:8);
  if(name&&!logoOnly&&logo)contents+=label(team.abbreviation||'',textX,abbreviationY,11,{anchor:'middle',fill:paint.ink,width:logoWidth});
  contents+=label(number,scoreX,centerY+large*.35,large,{anchor:'middle',weight:900,fill:scoreCard?'#101820':paint.ink,width:74,className:'variant-score'});
  const possessionX=reverse?x+91:x+w-91;
  contents+=marker(game,team,possessionX,centerY,Math.min(16,h*.2),helpers);
  contents+=timeoutRail(team,x+w/2-27,y+h-(shape==='curved'?19:7),54,options,game,paint);
  const bonus=game?.situation?.[`${side}Bonus`]===true||game?.situation?.bonusTeamId===team.id;
  if(sportFor(game)==='basketball'&&bonus)contents+=label('BONUS',x+w/2,y+h-16,8,{anchor:'middle',fill:paint.ink,width:48});
  if(options.interactive!==false)contents+=target(side,Math.max(x+2,logoX-logoWidth/2-7),y+4,Math.min(logoWidth+14,w/2),h-8,team.name||team.abbreviation);
  return `<g class="bug-team bug-team--${side}" data-team-side="${side}" data-team-id="${esc(team.id||'')}" data-team-fill="${paint.fill}" data-team-border="${paint.border}" data-team-ink="${paint.ink}">${contents}</g>`;
}
function infoPanel(box,ctx,{fill='#111820',ink='#f7f8f9',radius=0,mode='row',className=''}={}) {
  const {x,y,w,h}=box,{v,options}=ctx;
  let contents=`<path class="bug-situation-panel ${className}" d="${rectPath(x,y,w,h,radius)}" fill="${fill}" stroke="${fill}" stroke-width="1"/>`;
  if(v.banner)contents+=label(v.banner,x+w/2,y+h/2+7,mode==='column'?16:21,{anchor:'middle',fill:ink,width:w-12});
  else if(mode==='column') {
    const short=h<72;
    contents+=label(v.period,x+w/2,y+(short?12:18),short?10:12,{anchor:'middle',fill:ink,width:w-12});
    contents+=label(v.clock||v.detail||'—',x+w/2,y+h*(short?.62:.58),Math.min(short?23:28,w*.24,short?h*.38:28),{anchor:'middle',fill:ink,weight:900,width:w-10,className:'variant-clock'});
    if(v.clock&&v.detail)contents+=label(v.detail,x+w/2,y+h-(short?7:9),short?10:12,{anchor:'middle',fill:ink,width:w-10});
  } else {
    const third=w/3;
    contents+=label(v.period,x+12,y+h/2+6,Math.min(18,h*.55),{fill:ink,width:third-16});
    contents+=label(v.clock||v.detail||'—',x+w/2,y+h/2+8,Math.min(27,h*.72),{anchor:'middle',fill:ink,weight:900,width:third-10,className:'variant-clock'});
    const trailing=v.clock?v.detail:v.field;
    contents+=label(trailing||v.field||'',x+w-12,y+h/2+6,Math.min(17,h*.52),{anchor:'end',fill:ink,width:third-16});
  }
  if(options.interactive!==false)contents+=target('comparison',mode==='column'?x:x+w*.34,y,mode==='column'?w:w*.32,h);
  return contents;
}
function supplemental(game,ctx,x,y,width) {
  const {v}=ctx,s=game?.situation||{};
  if(v.sport==='baseball')return diamond(s,x+width/2,y,11);
  if(v.sport==='football'&&v.field)return label(`BALL ${v.field}`,x+width/2,y+5,11,{anchor:'middle',width});
  if(v.sport==='basketball') {
    const parts=['away','home'].map(side=>{const t=game?.[side]||{};return t.fouls!=null?`${t.abbreviation||side.toUpperCase()} ${t.fouls} FOULS`:'';}).filter(Boolean);
    return label(parts.join('   ·   '),x+width/2,y+5,11,{anchor:'middle',width});
  }
  if(v.sport==='hockey') {
    const shots=['away','home'].map(side=>game?.[side]?.shotsOnGoal??game?.[side]?.shots);
    if(shots.some(value=>value!=null))return label(`SHOTS  ${shots[0]??'—'}  —  ${shots[1]??'—'}`,x+width/2,y+5,12,{anchor:'middle',width});
  }
  return '';
}
function diamond(s,x,y,size=10) {
  const raw=s.bases||{},baseValues=Array.isArray(raw)?raw:[s.onFirst??raw.first,s.onSecond??raw.second,s.onThird??raw.third];
  const known=baseValues.some(value=>value!==undefined&&value!==null);
  const positions=[[size,0],[0,-size],[-size,0]];
  return `<g class="variant-diamond" role="img" aria-label="${known?baseValues.map((value,index)=>`${['First','Second','Third'][index]} base ${value==null?'unknown':value?'occupied':'empty'}`).join(', '):'Base occupancy unavailable'}">${positions.map(([dx,dy],i)=>`<path d="M${x+dx} ${y+dy-size*.62}L${x+dx+size*.62} ${y+dy}L${x+dx} ${y+dy+size*.62}L${x+dx-size*.62} ${y+dy}Z" fill="${baseValues[i]?'#f2cf38':'#283640'}" stroke="${known?'#87929b':'#68747e'}" stroke-width="1.2"${baseValues[i]==null?' stroke-dasharray="2 1"':''}/>`).join('')}</g>`;
}
function pods(ctx) {
  const {style,v,teams,options}=ctx,varn=style.variant;
  const gap=['eyebar','white','rugby'].includes(varn)?152:['circle','triangle','college','large','nba-pods'].includes(varn)?112:124;
  const middle=(600-gap)/2,w=middle-6;
  const shape=({circle:'round',triangle:'triangle',visor:'bevel',shield:'shield',curved:'curved','team-box':'round',gridiron:'slant',school:'bevel','compact-pill':'round','nba-pods':'bevel','nba-prime':'bevel','college-dark':'rect',large:'round'})[varn]||'rect';
  const y=12,h=78;
  let html='';
  if(['team-box','visor','triangle','shield','curved','nba-pods','large'].includes(varn))html+=`<path d="${panelShape(2,y-3,596,h+6,shape)}" fill="#a9b4be" stroke="#dce4e9"/>`;
  html+=teamGroup(teams.away,'away',{x:5,y,w,h},ctx,{shape,scoreSize:['large','nba-prime','college-dark','nba-pods','gridiron','cbb-center'].includes(varn)?51:43,name:!['visor','gridiron','curved'].includes(varn),logoWidth:['visor','gridiron','nba-prime'].includes(varn)?72:56,strip:['gridiron','college-dark','school'].includes(varn)});
  html+=teamGroup(teams.home,'home',{x:middle+gap+1,y,w,h},ctx,{shape,scoreSize:['large','nba-prime','college-dark','nba-pods','gridiron','cbb-center'].includes(varn)?51:43,name:!['visor','gridiron','curved'].includes(varn),logoWidth:['visor','gridiron','nba-prime'].includes(varn)?72:56,reverse:true,strip:['gridiron','college-dark','school'].includes(varn)});
  if(varn==='circle') {
    html+=`<circle cx="300" cy="51" r="51" fill="#26323d" stroke="#c3cbd0" stroke-width="3"/>`;
    html+=infoPanel({x:middle+4,y:20,w:gap-8,h:64},ctx,{fill:'#26323d',mode:'column'});
  } else {
    const centralFill=varn==='pl-white'?'#f3f5f6':varn==='pl-purple'?'#3a0648':varn==='vnl'?'#143084':varn==='rugby'?'#0a087d':'#101820';
    const light=varn==='pl-white';
    html+=infoPanel({x:middle+3,y:varn==='nba-prime'?1:y,w:gap-6,h:varn==='nba-prime'?89:h},['eyebar','compact-pill','college-dark','cbb-center'].includes(varn)?{...ctx,v:{...v,detail:''}}:ctx,{fill:centralFill,ink:light?'#101820':'#ffffff',mode:'column',radius:['compact-pill','triangle'].includes(varn)?18:0});
  }
  if(['eyebar','compact-pill','college-dark','cbb-center'].includes(varn)&&!v.banner&&v.detail) {
    const width=Math.min(230,220);html+=`<path d="${rectPath(300-width/2,0,width,22,5)}" fill="${varn==='eyebar'?'#153444':'#441320'}"/>`+label(v.detail,300,16,13,{anchor:'middle',width:width-16});
  }
  if(!ctx.skipSupplemental)html+=supplemental(ctx.game,ctx,10,110,580);
  return html;
}
function banner(ctx) {
  const {style,teams}=ctx,v=style.variant;
  const metal=['silver','blue-metal','purple-metal','light-metal','bladed-metal','cbs-bevel','playoff'].includes(v);
  const light=['light-metal','mls','sportsnet'].includes(v);
  const body=light?'#e3e9ed':metal?({silver:'#5c626b','blue-metal':'#14394d','purple-metal':'#302a43','bladed-metal':'#344854','cbs-bevel':'#40505a',playoff:'#343d44'}[v]||'#26313b'):'#121820';
  const y=['ticker','two-tier','sportsnet'].includes(v)?26:35,h=58;
  let html=`<path d="${rectPath(2,y-4,596,h+8,metal?9:0)}" fill="${body}" stroke="${metal?'#aebdc8':'#26323b'}" stroke-width="2"/>`;
  if(metal)html+=`<path d="M12 ${y-1}H588" stroke="#eff5f8" stroke-opacity=".8" stroke-width="2"/><path d="M12 ${y+h+1}H588" stroke="#050b11" stroke-opacity=".7" stroke-width="2"/>`;
  const shape=['bladed-metal','arrow','venom','neon','large-logo','world-cup','playoff'].includes(v)?'slant':'rect';
  const infoX=['world-cup','mls','ucl'].includes(v)?4:398;
  const teamOffset=infoX===4?140:4;
  const teamWidth=infoX===4?225:196;
  html+=teamGroup(teams.away,'away',{x:teamOffset,y,w:teamWidth-3,h},ctx,{shape,scoreSize:33,logoWidth:38,name:true,scoreCard:['cbs-flat','tournament','baseball-slim'].includes(v)});
  html+=teamGroup(teams.home,'home',{x:teamOffset+teamWidth,y,w:teamWidth-3,h},ctx,{shape,scoreSize:33,logoWidth:38,name:true,scoreCard:['cbs-flat','tournament','baseball-slim'].includes(v)});
  html+=infoPanel({x:infoX,y,w:infoX===4?132:198,h},ctx,{fill:body,ink:light?'#111c27':'#ffffff',mode:'column',radius:metal?7:0});
  if(v==='neon')html+=`<path d="M7 ${y+h+2}H390" stroke="#4ce1cf" stroke-width="2.5"/>`;
  if(v==='venom'||v==='arrow')html+=`<path d="M5 ${y+h+2}H390" stroke="#d2db42" stroke-width="3"/>`;
  if(v==='ticker'||v==='two-tier')html+=`<path d="${rectPath(2,y+h+4,596,25)}" fill="#161b23"/>`+label(ctx.v.detail||ctx.v.field||formatPeriod(ctx.game),300,y+h+22,12,{anchor:'middle',width:570});
  else html+=supplemental(ctx.game,ctx,6,y+h+19,588);
  return html;
}
function corner(ctx) {
  const {style,teams,v}=ctx,varn=style.variant;
  const light=varn==='laliga',classic=varn==='classic',clockLeft=['classic','hockey','hockey-diamond','laliga'].includes(varn);
  const top=10,row=46,width=382,teamX=clockLeft?210:7,clockX=clockLeft?7:390;
  const whiteScores=['tnt','hockey-tnt','baseball','laliga'].includes(varn);
  let html=`<path d="${rectPath(2,top-2,596,row*2+16,classic?8:0)}" fill="${light?'#e8ecef':'#121b24'}" stroke="${classic?'#a9b2a7':varn==='metal'?'#a6b9c9':'#4c5864'}" stroke-width="2"/>`;
  ['away','home'].forEach((side,index)=> {
    const t=teams[side],y=top+index*(row+3),paint=paletteFor(style,t,side,ctx.helpers),p=classic?{...paint,fill:'#15382b',ink:'#f3f5df'}:paint;
    const name=t.abbreviation||t.shortName||t.name||'—',x=teamX;
    html+=`<g class="bug-team bug-team--${side}" data-team-side="${side}" data-team-id="${esc(t.id||'')}" data-team-fill="${p.fill}" data-team-border="${p.border}" data-team-ink="${p.ink}"><path class="bug-team-panel" d="${panelShape(x,y,width,row,varn==='metal'?'round':classic?'slant':'rect',side)}" fill="${p.fill}" stroke="${p.border}"/>`;
    if(whiteScores)html+=`<path d="${rectPath(x+310,y+1,70,row-2)}" fill="#eff1f0"/>`;
    html+=ctx.helpers.logoImage(t,x+34,y+row/2,42,32)||label(name,x+34,y+row*.7,15,{anchor:'middle',fill:p.ink,width:48});
    html+=label(['tnt','hockey-tnt','laliga'].includes(varn)?name:t.name||name,x+72,y+30,['tnt','hockey-tnt','laliga'].includes(varn)?27:21,{fill:p.ink,width:195});
    html+=label(scoreValue(t,v.sport),x+343,y+34,34,{anchor:'middle',fill:whiteScores?'#15212a':p.ink,weight:900,width:62,className:'variant-score'});
    html+=marker(ctx.game,t,x+284,y+24,13,ctx.helpers);
    if(ctx.options.interactive!==false)html+=target(side,x+2,y,264,row,t.name||name);
    html+='</g>';
  });
  const fill=light?'#eff3f6':classic?'#1c332c':varn==='hockey-diamond'?'#203654':'#121b24';
  html+=infoPanel({x:clockX,y:top,w:202,h:row*2+3},ctx,{fill,ink:light?'#111820':'#ffffff',mode:'column'});
  if(varn==='laliga')html+=`<path d="${rectPath(clockX,top,202,8)}" fill="#e34e42"/>`;
  html+=supplemental(ctx.game,ctx,5,126,590);
  return html;
}
function columns(ctx) {
  const {teams,style}=ctx,y=3,h=87;
  let html='';
  ['away','home'].forEach((side,index)=> {
    const t=teams[side],x=6+index*296,p=paletteFor(style,t,side,ctx.helpers),name=t.abbreviation||'—';
    html+=`<g class="bug-team bug-team--${side}" data-team-side="${side}" data-team-id="${esc(t.id||'')}" data-team-fill="${p.fill}" data-team-border="${p.border}" data-team-ink="${p.ink}"><path class="bug-team-panel" d="${panelShape(x,y,288,h,style.variant==='chsn'?'rect':'bevel',side)}" fill="${p.fill}" stroke="${p.border}"/>`;
    html+=ctx.helpers.logoImage(t,x+53,41,68,51)||label(name,x+53,48,27,{anchor:'middle',fill:p.ink,width:75});
    html+=label(name,x+140,37,25,{anchor:'middle',fill:p.ink,width:90});
    html+=label(scoreValue(t,ctx.v.sport),x+226,65,55,{anchor:'middle',fill:p.ink,weight:900,width:90,className:'variant-score'});
    html+=marker(ctx.game,t,x+145,62,17,ctx.helpers);
    html+=timeoutRail(t,x+26,80,68,ctx.options,ctx.game,p);
    if(ctx.options.interactive!==false)html+=target(side,x+6,y+3,96,h-6,t.name);
    html+='</g>';
  });
  return html+infoPanel({x:6,y:95,w:584,h:37},ctx,{fill:style.variant==='chsn'?'#101114':'#17242e'});
}
function minimalist(ctx) {
  const {teams,style}=ctx;let html='';
  ['away','home'].forEach((side,index)=> {
    const t=teams[side],x=index?356:8,paint=paletteFor(style,t,side,ctx.helpers),scoreX=index?393:207,logoX=index?535:66;
    const d=rectPath(x,18,236,80);
    html+=`<g class="bug-team bug-team--${side}" data-team-side="${side}" data-team-id="${esc(t.id||'')}" data-team-fill="${paint.fill}" data-team-border="${paint.border}" data-team-ink="${paint.ink}"><path class="bug-team-panel" d="${d}" fill="transparent" stroke="none"/>`;
    if(style.variant==='names')html+=`<path d="${rectPath(logoX-54,25,108,57)}" fill="${paint.fill}"/>`+label(t.abbreviation||'—',logoX,65,39,{anchor:'middle',fill:paint.ink,width:101});
    else html+=ctx.helpers.logoImage(t,logoX,55,100,67)||label(t.abbreviation||'—',logoX,68,38,{anchor:'middle',width:100});
    html+=label(scoreValue(t,ctx.v.sport),scoreX,78,67,{anchor:'middle',weight:900,width:90,className:'variant-score variant-open-score'});
    html+=marker(ctx.game,t,index?454:146,57,16,ctx.helpers);
    html+=timeoutRail(t,logoX-34,96,68,ctx.options,ctx.game,{ink:'#ffffff'});
    if(ctx.options.interactive!==false)html+=target(side,logoX-53,21,106,82,t.name);
    html+='</g>';
  });
  html+=infoPanel({x:252,y:30,w:96,h:64},ctx,{fill:'#15212bdd',mode:'column'});
  html+=supplemental(ctx.game,ctx,6,122,588);
  return html;
}
function diamondBox(ctx) {
  if(ctx.v.sport!=='baseball')return pods({...ctx,style:{...ctx.style,variant:ctx.style.variant==='apple'?'compact-pill':'team-box'}});
  const {style,teams}=ctx,apple=style.variant==='apple',classic=style.variant==='diamond-box';
  const gap=classic?104:132,middle=(600-gap)/2,w=middle-9,y=classic?9:18,h=classic?99:84;
  const inherited={...ctx,style:{...style,variant:apple?'apple':'team-box'}};
  let html=apple?'':`<path d="${rectPath(3,y-3,594,h+6,classic?1:10)}" fill="#a9b7c2" stroke="#e0e5e8"/>`;
  html+=teamGroup(teams.away,'away',{x:6,y,w,h},inherited,{shape:classic?'slant':apple?'rect':'round',scoreSize:classic?58:48,logoWidth:58,name:true});
  html+=teamGroup(teams.home,'home',{x:middle+gap+3,y,w,h},inherited,{shape:classic?'slant':apple?'rect':'round',scoreSize:classic?58:48,logoWidth:58,name:true,reverse:true});
  html+=infoPanel({x:middle+1,y,w:gap-2,h},ctx,{fill:apple?'#14181e':'#15222d',mode:'column'});
  html+=`<path d="${rectPath(254,103,92,34,3)}" fill="${apple?'#14181e':'#172934'}" stroke="${apple?'#14181e':'#c2ccd1'}"/>`+diamond(ctx.v.s,300,122,12);
  const batter=ctx.v.s.batter,pitcher=ctx.v.s.pitcher;
  if(batter)html+=label(`BAT ${batter}`,12,128,10,{width:220});
  if(pitcher)html+=label(`P ${pitcher}`,588,128,10,{anchor:'end',width:220});
  return html;
}
function sets(ctx) {
  const {style,teams}=ctx,sport=ctx.v.sport;
  const colors={green:['#244d36','#613879','#f2f0df'],purple:['#6d229b','#efece5','#efece5'],cyan:['#071e43','#49c7f0','#e1edf4'],yellow:['#09235b','#e3c628','#f0f3f4']}[style.variant]||['#142b4a','#345c85','#f2f4f6'];
  let html='';
  const playedSets=(team)=>Array.isArray(team.setScores)?team.setScores:Array.isArray(team.linescores)?team.linescores.map(item=>typeof item==='object'?item.value:item):[];
  const hasSets=['tennis','volleyball'].includes(sport)&&['away','home'].some(side=>playedSets(teams[side]).length);
  ['away','home'].forEach((side,index)=> {
    const team=teams[side],y=7+index*46,paint=ctx.helpers.teamPalette(team,side),p={fill:colors[0],border:colors[1],ink:'#ffffff'};
    html+=`<g class="bug-team bug-team--${side}" data-team-side="${side}" data-team-id="${esc(team.id||'')}" data-team-fill="${p.fill}" data-team-border="${p.border}" data-team-ink="${p.ink}"><path class="bug-team-panel" d="${rectPath(5,y,590,43,style.variant==='cyan'?3:0)}" fill="${p.fill}" stroke="${p.border}"/>`;
    html+=ctx.helpers.logoImage(team,27,y+22,28,28)||`<rect x="14" y="${y+10}" width="24" height="24" fill="${paint.fill}"/>`;
    html+=label(team.shortName||team.name||team.abbreviation||'—',50,y+29,22,{width:hasSets?253:360});
    html+=marker(ctx.game,team,318,y+22,13,ctx.helpers);
    if(hasSets) {
      const values=playedSets(team).slice(0,5);
      values.forEach((value,i)=> {html+=`<rect x="${338+i*37}" y="${y+1}" width="35" height="41" fill="${colors[1]}"/>`+label(value??'—',355+i*37,y+29,23,{anchor:'middle',fill:style.variant==='green'?'#ffffff':'#102038',width:31});});
    }
    const combined=typeof ctx.v.s.pointScore==='string'?ctx.v.s.pointScore.split(/[-–—]/):[];
    const current=ctx.game?.state==='in'&&['tennis','volleyball'].includes(sport)?ctx.v.s[`${side}Points`]??team.points??team.pointScore??team.currentPoints??team.displayPoint??combined[index]:undefined;
    html+=`<rect x="537" y="${y+1}" width="56" height="41" fill="${colors[2]}"/>`+label(current??scoreValue(team,sport),565,y+31,28,{anchor:'middle',fill:'#132331',weight:800,width:48,className:'variant-score'});
    if(ctx.options.interactive!==false)html+=target(side,8,y+1,309,41,team.name);
    html+='</g>';
  });
  html+=infoPanel({x:5,y:103,w:590,h:31},ctx,{fill:colors[0]});
  return html;
}
function cricket(ctx) {
  if(ctx.v.sport!=='cricket')return banner({...ctx,style:{...ctx.style,variant:ctx.style.variant==='purple'?'neon':ctx.style.variant==='yellow'?'light-metal':'blue-metal'}});
  const {teams}=ctx,colors={blue:['#124b78','#b7e6ee'],yellow:['#19548b','#ffe04c'],maroon:['#601433','#f0d53c'],purple:['#21152b','#d768bc']}[ctx.style.variant];
  let html=teamGroup(teams.away,'away',{x:3,y:20,w:227,h:76},ctx,{scoreSize:37,logoWidth:47})+teamGroup(teams.home,'home',{x:370,y:20,w:227,h:76},ctx,{scoreSize:37,logoWidth:47,reverse:true});
  html+=infoPanel({x:235,y:20,w:130,h:76},ctx,{fill:colors[0],ink:colors[1],mode:'column'});
  const s=ctx.v.s;html+=label([s.batter,s.bowler,s.requiredRate!=null?`REQ ${s.requiredRate}`:null].filter(Boolean).join(' · '),300,122,14,{anchor:'middle',width:570});
  return html;
}
function bladesAdapted(ctx) {
  const {teams,helpers,options,v}=ctx;
  const paths={away:'M30 4H303L285 88H12Z',home:'M308 4H595L577 88H290Z'};
  let html='';
  ['away','home'].forEach(side=> {
    const team=teams[side],away=side==='away',paint=helpers.teamPalette(team,side),logoX=away?110:488,scoreX=away?241:349;
    html+=`<g class="bug-team bug-team--${side}" data-team-side="${side}" data-team-id="${esc(team.id||'')}" data-team-fill="${paint.fill}" data-team-border="${paint.border}" data-team-ink="${paint.ink}"><path class="bug-team-panel" d="${paths[side]}" fill="${paint.fill}" stroke="${paint.border}"/>`;
    html+=helpers.logoImage(team,logoX,46,106,62)||label(team.abbreviation||'—',logoX,59,36,{anchor:'middle',fill:paint.ink,width:102});
    const score=scoreValue(team,v.sport);
    html+=label(score,scoreX,70,score.length>2?44:65,{anchor:'middle',weight:900,fill:paint.ink,width:90,italic:true,className:'variant-score'});
    html+=marker(ctx.game,team,away?185:413,46,22,helpers);
    html+=timeoutRail(team,away?21:579,15,57,options,ctx.game,paint,{vertical:true});
    if(options.interactive!==false)html+=target(side,away?32:435,5,138,81,team.name);
    html+='</g>';
  });
  const path='M10.928571 93H575.928571L566.714286 136H1.714286Z';
  html+=`<path class="bug-situation-panel" d="${path}" fill="#101b16"/>`;
  if(v.banner)html+=label(v.banner,293,123,25,{anchor:'middle',width:510});
  else {
    html+=label(v.period,33,123,23,{width:150});
    html+=label(v.clock||v.detail||'—',292,124,28,{anchor:'middle',weight:900,width:170,className:'variant-clock'});
    html+=label(v.clock?v.detail:'',551,123,19,{anchor:'end',width:165});
  }
  if(options.interactive!==false)html+=target('comparison',228,94,130,41);
  return html;
}
function verticalSets(ctx) {
  const {style,teams,v}=ctx;
  const colors={green:['#244d36','#613879','#f2f0df'],purple:['#6d229b','#efece5','#efece5'],cyan:['#071e43','#49c7f0','#e1edf4'],yellow:['#09235b','#e3c628','#f0f3f4']}[style.variant]||['#142b4a','#345c85','#f2f4f6'];
  let html=`<path d="${rectPath(3,3,154,25,3)}" fill="${colors[0]}"/>`+label(v.period,80,20,11,{anchor:'middle',width:140});
  ['away','home'].forEach((side,index)=> {
    const t=teams[side],y=33+index*90,lines=(Array.isArray(t.setScores)?t.setScores:Array.isArray(t.linescores)?t.linescores.map(l=>typeof l==='object'?l.value:l):[]).slice(0,5);
    const split=typeof v.s.pointScore==='string'?v.s.pointScore.split(/[-–—]/):[];
    const current=ctx.game?.state==='in'?(v.s[`${side}Points`]??t.points??t.pointScore??split[index]):undefined;
    html+=`<g class="bug-team bug-team--${side}" data-team-side="${side}" data-team-id="${esc(t.id||'')}" data-team-fill="${colors[0]}" data-team-border="${colors[1]}" data-team-ink="#ffffff"><path class="bug-team-panel" d="${rectPath(3,y,154,85,2)}" fill="${colors[0]}" stroke="${colors[1]}"/>`;
    html+=label(t.shortName||t.name||t.abbreviation||'—',12,y+19,13,{width:136});
    if(['tennis','volleyball'].includes(v.sport)&&lines.length)lines.forEach((value,i)=>{html+=`<rect x="${11+i*19}" y="${y+32}" width="18" height="23" fill="${colors[1]}"/>`+label(value??'—',20+i*19,y+49,13,{anchor:'middle',fill:style.variant==='green'?'#fff':'#132331',width:16});});
    html+=marker(ctx.game,t,19,y+70,11,ctx.helpers);
    html+=label(['tennis','volleyball'].includes(v.sport)?`${scoreValue(t,v.sport)} SET${scoreValue(t,v.sport)==='1'?'':'S'}`:'SCORE',60,y+76,10,{anchor:'middle',width:62});
    html+=`<rect x="112" y="${y+30}" width="39" height="48" fill="${colors[2]}"/>`+label(current??scoreValue(t,v.sport),132,y+63,26,{anchor:'middle',fill:'#132331',weight:800,width:34,className:'variant-score'});
    if(ctx.options.interactive!==false)html+=target(side,7,y+3,145,23,t.name);
    html+='</g>';
  });
  return html+infoPanel({x:3,y:216,w:154,h:70},ctx,{fill:colors[0],mode:'column'});
}
function vertical(ctx) {
  if(ctx.style.family==='sets')return verticalSets(ctx);
  const {style,teams,helpers,v}=ctx;
  const shape=style.family==='blades'?'slant':['pods','diamond'].includes(style.family)?(['circle','triangle','curved'].includes(style.variant)?'round':style.variant==='shield'?'shield':'bevel'):style.family==='minimal'?'rect':'rect';
  const compact=['corner','banner','sets'].includes(style.family);
  const teamTop=compact?34:4,rowH=compact?80:96,step=rowH+5;
  let html='';
  if(compact)html+=`<path d="${rectPath(4,3,152,27,4)}" fill="#17222d"/>`+label(v.banner||v.period,80,22,12,{anchor:'middle',width:138});
  ['away','home'].forEach((side,index)=> {
    const team=teams[side],y=teamTop+index*step,paint=paletteFor(style,team,side,helpers),isBlades=style.family==='blades';
    const x=isBlades?9:4,w=isBlades?150:152;
    const path=isBlades?`M17 ${y-2}H159L151 ${y+94}H9Z`:panelShape(x,y,w,rowH,shape,side);
    const open=style.family==='minimal';
    html+=`<g class="bug-team bug-team--${side}" data-team-side="${side}" data-team-id="${esc(team.id||'')}" data-team-fill="${paint.fill}" data-team-border="${paint.border}" data-team-ink="${paint.ink}"><path class="bug-team-panel" d="${path}" fill="${open?'#18212bd9':paint.fill}" stroke="${paint.border}"/>`;
    const number=scoreValue(team,v.sport);
    if(compact) {
      const logo=helpers.logoImage(team,40,y+29,58,36);
      html+=logo||label(team.abbreviation||'—',40,y+35,19,{anchor:'middle',fill:paint.ink,width:58});
      if(logo)html+=label(team.abbreviation||'',40,y+64,11,{anchor:'middle',fill:paint.ink,width:60});
      html+=label(number,121,y+51,number.length>3?24:32,{anchor:'middle',fill:paint.ink,weight:900,width:56,className:'variant-score'});
      html+=marker(ctx.game,team,80,y+36,11,helpers);
      html+=timeoutRail(team,side==='away'?12:84,y+73,64,ctx.options,ctx.game,paint);
      if(ctx.options.interactive!==false)html+=target(side,9,y+4,61,64,team.name);
    } else {
      const cx=isBlades?85:80,logoY=y+20,logo=helpers.logoImage(team,cx,logoY,78,30);
      html+=logo||label(team.abbreviation||'—',cx,logoY+7,23,{anchor:'middle',fill:paint.ink,width:114});
      const fontSize=number.length>3?28:40;
      html+=label(number,80,y+rowH-8,fontSize,{anchor:'middle',fill:paint.ink,weight:900,width:110,className:'variant-score'});
      html+=marker(ctx.game,team,80,y+45,13,helpers);
      html+=timeoutRail(team,side==='away'?12:146,y+12,Math.min(52,rowH-20),ctx.options,ctx.game,paint,{vertical:true});
      if(ctx.options.interactive!==false)html+=target(side,25,y+3,110,35,team.name);
    }
    html+='</g>';
  });
  const bottomY=teamTop+step+rowH+5,infoH=286-bottomY;
  html+=infoPanel({x:4,y:bottomY,w:152,h:infoH},ctx,{fill:'#101820',mode:'column',radius:shape==='round'?7:0});
  if(v.sport==='baseball'&&!v.banner) {
    // A compact base diamond replaces a redundant period label. Keep count
    // and inning explicit in the clock/description, never simulate a pitch.
    const bottom=bottomY+Math.min(20,infoH*.25);
    html+=diamond(v.s,132,bottom,6);
  }
  return html;
}
function timing(ctx) {
  const {game,style,options}=ctx,vertical=options.orientation==='vertical',golf=ctx.v.sport==='golf';
  const entries=Array.isArray(game?.entries)?game.entries:[];
  const variant=style.family==='timing'?style.variant:'rounded';
  const white=variant==='white-red',classic=variant==='classic',green=variant==='golf-mini';
  const base=white?'#ebedef':classic?'#343529':green?'#233f37':'#15181f',ink=white?'#17212a':'#f6f8fa';
  const accent=classic?'#e3dd81':variant==='golf-pylon'?'#d9f653':green?'#ccded2':variant==='stage'?'#55c7e2':'#e32936';
  const width=vertical?160:600,height=vertical?290:138;
  const headerH=vertical?46:35,footerH=vertical?24:20;
  const count=vertical?9:6,rowH=(height-headerH-footerH-6)/(vertical?Math.max(3,Math.min(count,entries.length)):3);
  const columns=vertical?1:2,columnWidth=(width-8)/columns;
  const headerText=game?.sessionName||game?.name||'Choose a session';
  const status=ctx.v.banner||formatSituation(game||{})|| (game?.state==='in'?'LIVE':formatPeriod(game||{}));
  const flag=String(game?.flag||'').toLowerCase(),flagColor=/^red(?:[-_ ]flag)?$/.test(flag)?'#dc3036':/yellow|safety|vsc/.test(flag)?'#f1ce39':/^green(?:[-_ ]flag)?$/.test(flag)?'#36b873':/che(?:ck|qu)ered/.test(flag)?'#f5f5f5':base;
  let html=`<path class="bug-situation-panel" d="${rectPath(3,2,width-6,headerH-2,['rounded','modern','panels','golf-pylon'].includes(variant)?8:0)}" fill="${base}" stroke="${accent}" stroke-width="1.5"/>`;
  html+=label(headerText,vertical?11:12,vertical?19:24,vertical?12:17,{fill:ink,width:vertical?138:300,weight:800});
  html+=label(status,vertical?11:width-12,vertical?37:24,vertical?10:12,{fill:ink,anchor:vertical?'start':'end',width:vertical?138:255});
  if(flag&&flagColor!==base)html+=`<rect x="${width-9}" y="6" width="4" height="${headerH-12}" fill="${flagColor}" aria-label="${esc(flag)}"/>`;
  const shown=entries.slice(0,count);
  if(!shown.length)html+=label(game?.state==='pre'?'Classification available when reported':'Classification unavailable',width/2,headerH+(height-headerH-footerH)/2,vertical?11:17,{anchor:'middle',fill:ink,width:width-22});
  shown.forEach((entry,index)=> {
    const col=vertical?0:Math.floor(index/3),row=vertical?index:index%3;
    const x=4+col*columnWidth,y=headerH+3+row*rowH,w=columnWidth-4;
    const color=safeColor(entry.team?.color||entry.color,'#697685');
    const position=entry.position??entry.rank??'—';
    const name=vertical?(entry.abbreviation||entry.athlete?.abbreviation||entry.shortName||String(entry.name||entry.athlete?.name||'—').split(' ').at(-1)):(entry.name||entry.athlete?.name||entry.abbreviation||entry.athlete?.abbreviation||'—');
    const value=golf?(entry.scoreDisplay??entry.score??entry.toPar??'—'):(entry.gap??entry.time??entry.status??'—');
    const rowShape=variant==='slanted'?'slant':['rounded','modern'].includes(variant)?'round':'rect';
    html+=`<g class="variant-classification-row" data-entry-id="${esc(entry.id||'')}"><path d="${panelShape(x,y,w,rowH-2,rowShape)}" fill="${base}"/>`;
    html+=`<path d="${rectPath(x+2,y+2,vertical?18:23,rowH-6,1)}" fill="${classic?accent:white?'#d32a3a':['slim','modern','full-name','stage','golf-mini'].includes(variant)?'#252e36':color}"/>`;
    if(['modern','slim','full-name','stage','golf-pylon'].includes(variant))html+=`<rect x="${x+24}" y="${y+3}" width="2" height="${rowH-8}" fill="${color}"/>`;
    html+=label(position,x+(vertical?11:14),y+rowH*.67,vertical?10:12,{anchor:'middle',fill:classic?'#24271a':'#ffffff',weight:800,width:vertical?16:20});
    html+=label(name,x+(vertical?26:34),y+rowH*.67,vertical?Math.min(15,rowH*.4):13,{fill:ink,width:vertical?67:162,weight:700});
    html+=label(value,x+w-5,y+rowH*.67,vertical?Math.min(11,rowH*.34):12,{anchor:'end',fill:ink,width:vertical?48:78});
    html+='</g>';
  });
  const footerText=entries.length>shown.length?`${entries.length} ${golf?'players':'drivers'} · hover for full ${golf?'standings':'timing'}`:golf?'Player statistics in Game Center':game?.dataQuality?.message||'Session details in Game Center';
  html+=`<path d="${rectPath(3,height-footerH,width-6,footerH-2,3)}" fill="${base}"/>`+label(footerText,width/2,height-8,vertical?8.5:10,{anchor:'middle',fill:ink,width:width-18});
  if(options.interactive!==false)html+=target('comparison',3,2,width-6,headerH-2);
  return html;
}

export function renderStyledScorebug(game,options,style,helpers) {
  const verticalLayout=options.orientation==='vertical',width=verticalLayout?160:600,height=verticalLayout?290:138,statusHeight=verticalLayout?19:24;
  const id=String(options.idPrefix||`style-${style.id}`).replace(/[^a-zA-Z0-9_-]/g,'')||'style';
  const badge=options.stale?'FEED DELAYED':options.demo?'DESIGN PREVIEW':'',below=options.statusPosition==='below';
  const contextTeam=(team)=>({...team,leagueId:team?.leagueId||game?.leagueId||'nfl',sport:team?.sport||sportFor(game)});
  const ctx={game,options,style,helpers,v:view(game),teams:{away:contextTeam(game?.away||{}),home:contextTeam(game?.home||{})}};
  const leaderboard=game?.kind==='race'||game?.kind==='leaderboard'||['racing','golf'].includes(ctx.v.sport);
  let body;
  if(leaderboard)body=timing(ctx);
  else if(verticalLayout)body=vertical(ctx);
  else body=({blades:bladesAdapted,pods,banner,corner,columns,minimal:minimalist,diamond:diamondBox,sets,cricket,timing:corner}[style.family]||pods)(ctx);
  const gameDescription=leaderboard?`${game?.sessionName||game?.name||'Session'}. ${ctx.v.banner||ctx.v.period}. ${game?.entries?.length||0} classification entries.`:`${ctx.teams.away.name||ctx.teams.away.abbreviation||'Away'} ${scoreValue(ctx.teams.away,ctx.v.sport)}, ${ctx.teams.home.name||ctx.teams.home.abbreviation||'Home'} ${scoreValue(ctx.teams.home,ctx.v.sport)}. ${ctx.v.banner||`${ctx.v.period}, ${ctx.v.clock}, ${ctx.v.detail}`}.`;
  const badgeY=below?height+statusHeight:0;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="scorebug scorebug--variant scorebug--family-${style.family}${verticalLayout?' scorebug--vertical':''}${options.stale?' scorebug--stale':''}" data-style-id="${style.id}" data-style-variant="${style.variant}" data-sport="${ctx.v.sport}" data-league-id="${esc(game?.leagueId||'nfl')}" data-game-id="${esc(game?.id||'')}" data-orientation="${verticalLayout?'vertical':'horizontal'}"${below?' data-status-position="below"':''} viewBox="0 ${badge&&!below?-statusHeight:0} ${width} ${height+(badge?statusHeight:0)}" role="group" aria-labelledby="${id}-title ${id}-description"><title id="${id}-title">${esc(gameDescription)}</title><desc id="${id}-description">${esc(style.name)} inspired by ${esc(style.network)} ${esc(style.era)}. Information is adapted to ${ctx.v.sport}. ${leaderboard?'Hover the session header for the full timing table.':'Hover a team logo for its statistics, or the center game information to compare both sides.'}${options.stale?' Updates delayed; these are the last received values.':''}${options.demo?' Design preview only; these are sample values.':''}</desc>${badge?`<g class="bug-status-flag"${below?` transform="translate(0 ${badgeY})"`:''}><path d="${rectPath(verticalLayout?4:8,-statusHeight+2,verticalLayout?152:220,statusHeight-4,3)}" fill="${options.stale?'#b95518':'#283739'}"/>${label(badge,verticalLayout?80:18,-7,verticalLayout?9:11,{anchor:verticalLayout?'middle':'start',width:verticalLayout?138:203})}</g>`:''}${body}</svg>`;
}
