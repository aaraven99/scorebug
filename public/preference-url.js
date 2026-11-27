const PARAMS = Object.freeze({gameId:'game',date:'date',leagueId:'league',styleId:'style',racingRows:'rows'});
export const URL_PREFERENCE_FIELDS = Object.freeze(Object.keys(PARAMS));
const PENDING_KEY = 'scorebug.pending-url.v1:';
const MAX_AGE_MS = 3600000, FUTURE_TOLERANCE_MS = 60000;

/** Coalesce rapid selections below Safari's History API limit. A tab retains
 * ownership of its preference query until it navigates elsewhere: a reload may
 * already have requested an older URL while outgoing timers keep writing newer
 * ones. Recovery uses the latest confirmed shared settings, never a URL snapshot. */
export function createPreferenceURLSync({readPreferences,readSavedPreferences=()=>null,
  locationRef=()=>globalThis.location,historyRef=()=>globalThis.history,
  sessionRef=()=>globalThis.sessionStorage,navigationType=()=>globalThis.performance?.getEntriesByType?.('navigation')?.[0]?.type,
  now=Date.now,schedule=globalThis.setTimeout,cancel=globalThis.clearTimeout,interval=250}={}){
  let lastWrite=-Infinity,timer=null,paused=false,removeTeam=false,unconfirmedWrite=false;
  const included=new Set();
  const currentURL=()=>{try{return new URL(locationRef()?.href);}catch{return null;}};
  const storage=()=>{try{return sessionRef();}catch{return null;}};
  const key=url=>`${PENDING_KEY}${url.pathname}`;
  const clearRecord=url=>{try{storage()?.removeItem(key(url));}catch{}};
  const confirmed=()=>{try{return readSavedPreferences()||null;}catch{return null;}};
  const context=(url,clearTeam)=>{
    const value=new URL(url);for(const param of Object.values(PARAMS))value.searchParams.delete(param);
    if(clearTeam)value.searchParams.delete('team');return value.href;
  };
  const remember=(url,wanted)=>{
    if(!included.size&&!removeTeam)return;
    try{storage()?.setItem(key(url),JSON.stringify({version:2,context:context(url,removeTeam),wanted:wanted.href,
      fields:[...included],clearTeam:removeTeam,at:now()}));}catch{}
  };
  function desired(url,preferences){
    const target=new URL(url);
    for(const [field,param]of Object.entries(PARAMS))if(included.has(field)||url.searchParams.has(param)){
      included.add(field);
      if(preferences[field]==null)target.searchParams.delete(param);else target.searchParams.set(param,String(preferences[field]));
    }
    if(removeTeam)target.searchParams.delete('team');return target;
  }
  function sync(){
    if(paused)return;
    const url=currentURL();if(!url)return;
    // A successful shared write may precede its BroadcastChannel callback in
    // this tab. Prefer that latest record, unless this tab's own save failed.
    const memory=readPreferences(),latest=confirmed();
    if(unconfirmedWrite&&latest&&URL_PREFERENCE_FIELDS.every(field=>latest[field]===memory[field]))unconfirmedWrite=false;
    const saved=unconfirmedWrite?null:latest;
    const target=desired(url,saved||memory);
    if(saved)remember(url,target);else clearRecord(url);
    if(target.href===url.href){if(timer!==null){cancel(timer);timer=null;}return;}
    if(timer!==null)return;
    const wait=Math.max(0,interval-(now()-lastWrite));
    if(wait){timer=schedule(()=>{timer=null;sync();},wait);timer?.unref?.();return;}
    lastWrite=now();
    try{historyRef()?.replaceState(null,'',target);}catch{
      // Another caller or browser policy may still block history writes. Keep
      // confirmed ownership and retry at a bounded cadence.
      timer=schedule(()=>{timer=null;sync();},1000);timer?.unref?.();
    }
  }
  return{
    include(patch,{clearTeam=false}={}){for(const field of URL_PREFERENCE_FIELDS)if(Object.hasOwn(patch,field))included.add(field);removeTeam ||= clearTeam;},
    notePreferenceWrite(saved){
      unconfirmedWrite=!saved;
      if(!saved){const url=currentURL();if(url)clearRecord(url);}
    },
    sync,
    recoverReload(){
      const url=currentURL();if(!url)return false;
      try{
        const record=JSON.parse(storage()?.getItem(key(url))||'null'),stamp=now();
        if(navigationType()!=='reload'||!record||!Number.isFinite(record.at)||stamp-record.at>MAX_AGE_MS||record.at>stamp+FUTURE_TOLERANCE_MS)throw Error('Not an owned reload');
        const wanted=new URL(record.wanted);
        if(wanted.origin!==url.origin||wanted.pathname!==url.pathname)throw Error('Different document');
        let fields,clearTeam;
        if(record.version===2){
          if(!Array.isArray(record.fields)||record.fields.length>URL_PREFERENCE_FIELDS.length||new Set(record.fields).size!==record.fields.length
            ||record.fields.some(field=>!URL_PREFERENCE_FIELDS.includes(field))||typeof record.clearTeam!=='boolean')throw Error('Invalid ownership');
          fields=record.fields;clearTeam=record.clearTeam;
          if(record.context!==context(url,clearTeam)||record.context!==context(wanted,clearTeam)
            ||Object.entries(PARAMS).some(([field,param])=>(url.searchParams.has(param)||wanted.searchParams.has(param))&&!fields.includes(field)))throw Error('Different query context');
        }else if(record.version===undefined&&record.href===url.href){
          // Preserve a pending reload from the previous client version once.
          clearTeam=url.searchParams.has('team')&&!wanted.searchParams.has('team');
          if(context(url,clearTeam)!==context(wanted,clearTeam))throw Error('Different query context');
          fields=URL_PREFERENCE_FIELDS.filter(field=>wanted.searchParams.has(PARAMS[field])||url.searchParams.has(PARAMS[field]));
        }else throw Error('Unknown ownership record');
        const saved=confirmed();if(!saved)throw Error('No confirmed preferences');
        for(const field of fields)included.add(field);removeTeam=clearTeam;unconfirmedWrite=false;
        return saved;
      }catch{clearRecord(url);return false;}
    },
    pause(){paused=true;if(timer!==null){cancel(timer);timer=null;}},
    resume(){paused=false;sync();},
  };
}
