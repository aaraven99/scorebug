/** A requested wake lock is session-only and never inferred from saved settings. */
export function createStandbyWakeLock({ navigatorRef = globalThis.navigator, documentRef = globalThis.document, onChange = () => {} } = {}) {
  const supported = typeof navigatorRef?.wakeLock?.request === 'function';
  let desired = false, sentinel = null, pending = null, epoch = 0, disposed = false, pageActive = true;
  let status = supported ? 'off' : 'unsupported';
  const visible = () => pageActive && documentRef?.visibilityState !== 'hidden';
  const snapshot = () => ({ supported, desired, active: Boolean(sentinel && !sentinel.released), status });
  const emit = next => { status = next; onChange(snapshot()); };
  const release = lock => { try { Promise.resolve(lock?.release()).catch(() => {}); } catch { /* OS already released it. */ } };
  function request() {
    if (disposed || !supported || !desired) return Promise.resolve(snapshot());
    if (!visible()) { emit('paused'); return Promise.resolve(snapshot()); }
    if (sentinel && !sentinel.released) { emit('active'); return Promise.resolve(snapshot()); }
    if (pending) return pending;
    const generation = epoch;
    emit('requesting');
    // Call synchronously from the button gesture before awaiting anything.
    let requested;
    try { requested = navigatorRef.wakeLock.request('screen'); } catch (error) { requested = Promise.reject(error); }
    const operation = Promise.resolve(requested).then(lock => {
      if (disposed || generation !== epoch || !desired || !visible()) { release(lock); return snapshot(); }
      sentinel = lock;
      lock.addEventListener?.('release', () => {
        if (sentinel !== lock) return;
        sentinel = null;
        if (!disposed) emit(desired ? visible() ? 'released' : 'paused' : 'off');
      }, { once: true });
      if (lock.released) { sentinel = null; emit('released'); } else emit('active');
      return snapshot();
    }).catch(() => {
      if (!disposed && generation === epoch) emit(visible() ? 'error' : 'paused');
      return snapshot();
    }).finally(() => { if (pending === operation) pending = null; });
    pending = operation;
    return operation;
  }
  const cancel = () => { epoch++; pending = null; const old = sentinel; sentinel = null; release(old); };
  return {
    state: snapshot,
    enable() { if (disposed) return Promise.resolve(snapshot()); desired = supported; return request(); },
    disable() { desired = false; cancel(); emit(supported ? 'off' : 'unsupported'); },
    pause() { pageActive = false; cancel(); if (!disposed) emit(desired ? 'paused' : supported ? 'off' : 'unsupported'); },
    resume() { pageActive = true; return request(); },
    destroy() { disposed = true; desired = false; cancel(); },
  };
}
