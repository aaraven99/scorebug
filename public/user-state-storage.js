const DISPOSABLE_CACHE_KEYS = ['scorebug.favorite-directories.v1','scorebug.scoreboards.v1'];

/** User choices take priority over re-fetchable data when a browser is full. */
export function saveUserState(storage,key,value){
  if(typeof storage?.setItem!=='function')return false;
  try{if(storage.getItem?.(key)!==value)storage.setItem(key,value);return true;}
  catch(error){
    if(!['QuotaExceededError','NS_ERROR_DOM_QUOTA_REACHED'].includes(error?.name))return false;
    try{for(const cacheKey of DISPOSABLE_CACHE_KEYS)storage.removeItem?.(cacheKey);storage.setItem(key,value);return true;}
    catch{return false;}
  }
}
