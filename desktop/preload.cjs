'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scorebugDesktop', {
  isDesktop: true,
  getPreferences: () => ipcRenderer.invoke('scorebug:preferences:get'),
  setPreferences: (patch) => ipcRenderer.invoke('scorebug:preferences:set', patch),
  getState: () => ipcRenderer.invoke('scorebug:state'),
  openSettings: () => ipcRenderer.invoke('scorebug:settings'),
  showDetails: (side) => ipcRenderer.invoke('scorebug:details:show', side),
  setDefaultDetailsSide: (side) => ipcRenderer.invoke('scorebug:details:default-side', side),
  hideDetails: () => ipcRenderer.invoke('scorebug:details:hide'),
  closeWidget: () => ipcRenderer.invoke('scorebug:quit'),
  onDetailsVisibilityChanged: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, visible) => callback(visible);
    ipcRenderer.on('scorebug:details:visibility', listener);
    return () => ipcRenderer.removeListener('scorebug:details:visibility', listener);
  },
  onDetailsSideChanged: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, side) => callback(side);
    ipcRenderer.on('scorebug:details:side', listener);
    return () => ipcRenderer.removeListener('scorebug:details:side', listener);
  },
  onPreferencesChanged: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, preferences) => callback(preferences);
    ipcRenderer.on('scorebug:preferences:changed', listener);
    return () => ipcRenderer.removeListener('scorebug:preferences:changed', listener);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.desktop = 'true';
  // Only the compact widget is draggable. Settings remain a normal app window.
  if (location.pathname === '/widget.html') {
    const style = document.createElement('style');
    style.textContent = `
      html, body { background: transparent !important; }
      body { -webkit-app-region: drag; app-region: drag; user-select: none; }
      button, a, input, select, textarea, [role="button"], [data-no-drag] {
        -webkit-app-region: no-drag; app-region: no-drag;
      }
      html[data-desktop-locked="true"] body { -webkit-app-region: no-drag; app-region: no-drag; }
    `;
    document.head.append(style);
  }
  if (location.pathname === '/details.html') {
    const style = document.createElement('style');
    style.textContent = 'html, body { background: transparent !important; -webkit-app-region: no-drag; app-region: no-drag; }';
    document.head.append(style);
  }
  const applyPreferences = (preferences) => {
    document.documentElement.dataset.desktopLocked = String(Boolean(preferences.locked));
  };
  ipcRenderer.invoke('scorebug:preferences:get').then(applyPreferences).catch(() => {});
  ipcRenderer.on('scorebug:preferences:changed', (_event, preferences) => applyPreferences(preferences));
});
