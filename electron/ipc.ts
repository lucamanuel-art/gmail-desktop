// Channel names shared between main, preload, and renderer.
export const IPC = {
  // Gmail view -> main
  UNREAD_UPDATE: 'unread:update', // send(count:number)
  NOTIFICATION_ACTIVATE: 'notification:activate', // send()
  ACCOUNT_IDENTITY: 'account:identity', // send({email,name,avatarUrl})
  // renderer (sidebar) -> main
  SWITCH_SURFACE: 'switch:surface', // send({index, surface:'mail'|'calendar'})
  REDETECT: 'accounts:redetect', // send()
  ADD_ACCOUNT: 'accounts:add', // send() — open Google's add-session flow in a visible view
  SET_COLOR: 'color:set', // send({email, color})
  REMOVE_ACCOUNT: 'accounts:remove', // send({email}) — hide account + skip on detect
  SETTINGS_TOGGLE: 'settings:toggle', // send({open:boolean})
  UPDATE_CHECK: 'update:check', // send() — check GitHub for a newer release
  UPDATE_DOWNLOAD: 'update:download', // send() — download + auto-install the update
  UPDATE_INSTALL: 'update:install', // send() — restart into an already-downloaded update
  SET_AUTO_START: 'prefs:auto-start', // send(boolean)
  // main -> renderer (sidebar)
  PROFILES_CHANGED: 'profiles:changed', // Profile[]
  UNREAD_CHANGED: 'unread:changed', // Record<index, number>
  UPDATE_STATUS: 'update:status', // { state, currentVersion, version?, percent?, message? }
  SETTINGS_FORCE_CLOSE: 'settings:force-close',
  PREFS_CHANGED: 'prefs:changed', // main -> renderer: full Prefs
} as const;
