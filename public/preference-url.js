const PARAMS = Object.freeze({gameId:'game',date:'date',leagueId:'league',styleId:'style',racingRows:'rows'});
const PENDING_KEY = 'scorebug.pending-url.v1:';

/** Coalesce rapid selections below Safari's History API limit. Saved preferences
 * remain authoritative when this same tab reloads a URL awaiting its last write. */
export function createPreferenceURLSync({readPreferences,locationRef=()=>globalThis.location,historyRef=()=>globalThis.history,
  sessionRef=()=>globalThis.sessionStorage,navigationType=()=>globalThis.performance?.getEntriesByType?.('navigation')?.[0]?.type,
  now=Date.now,schedule=globalThis.setTimeout,cancel=globalThis.clearTimeout,interval=250}={}){
  let lastWrite=-Infinity,timer=null,paused=false,removeTeam=false;
  const included=new Set();
  const currentURL=()=>{try{return new URL(locationRef()?.href);}catch{return null;}};
  const storage=()=>{try{return sessionRef();}catch{return null;}};
  const key=url=>`${PENDING_KEY}${url.pathname}`;
  const clearRecord=url=>{try{storage()?.removeItem(key(url));}catch{}};
  const remember=(url,wanted)=>{try{storage()?.setItem(key(url),JSON.stringify({href:url.href,wanted:wanted.href,at:now()}));}catch{}};
  function desired(url){
    const target=new URL(url),preferences=readPreferences();
    for(const [field,param]of Object.entries(PARAMS))if(included.has(field)||url.searchParams.has(param)){
      if(preferences[field]==null)target.searchParams.delete(param);else target.searchParams.set(param,String(preferences[field]));
    }
    if(removeTeam)target.searchParams.delete('team');return target;
  }
  function sync(){
    if(paused)return;
    const url=currentURL();if(!url)return;
    const target=desired(url);
    if(target.href===url.href){if(timer!==null){cancel(timer);timer=null;}clearRecord(url);return;}
    remember(url,target);
    if(timer!==null)return;
    const wait=Math.max(0,interval-(now()-lastWrite));
    if(wait){timer=schedule(()=>{timer=null;sync();},wait);timer?.unref?.();return;}
    lastWrite=now();
    try{historyRef()?.replaceState(null,'',target);clearRecord(url);}catch{
      // Another caller or browser policy may still block history writes. Keep
      // the reload marker and retry at a bounded cadence.
      timer=schedule(()=>{timer=null;sync();},1000);timer?.unref?.();
    }
  }
  return{
    include(patch,{clearTeam=false}={}){for(const field of Object.keys(PARAMS))if(Object.hasOwn(patch,field))included.add(field);removeTeam ||= clearTeam;},
    sync,
    recoverReload(){
      const url=currentURL();if(!url)return false;
      try{
        const record=JSON.parse(storage()?.getItem(key(url))||'null');
        if(navigationType()!=='reload'||record?.href!==url.href||!Number.isFinite(record.at)||now()-record.at>3600000||record.at>now()+60000){clearRecord(url);return false;}
        const wanted=new URL(record.wanted);if(wanted.origin!==url.origin||wanted.pathname!==url.pathname){clearRecord(url);return false;}
        for(const [field,param]of Object.entries(PARAMS))if(wanted.searchParams.has(param)||url.searchParams.has(param))included.add(field);
        removeTeam=url.searchParams.has('team')&&!wanted.searchParams.has('team');return true;
      }catch{clearRecord(url);return false;}
    },
    pause(){paused=true;if(timer!==null){cancel(timer);timer=null;}},
    resume(){paused=false;sync();},
  };
}
