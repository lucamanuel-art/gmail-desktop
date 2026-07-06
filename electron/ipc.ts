// Channel names shared between main, preload, and renderer.
export const IPC = {
  // Gmail view -> main
  UNREAD_UPDATE: 'unread:update', // send(count:number)
  NOTIFICATION_ACTIVATE: 'notification:activate', // send()
  ACCOUNT_IDENTITY: 'account:identity', // send({email,name,avatarUrl})
  // renderer (sidebar) -> main
  SWITCH_SURFACE: 'switch:surface', // send({index, surface:'mail'|'calendar'})
  REDETECT: 'accounts:redetect', // send()
  SET_COLOR: 'color:set', // send({email, color})
  SETTINGS_TOGGLE: 'settings:toggle', // send({open:boolean})
  // main -> renderer (sidebar)
  PROFILES_CHANGED: 'profiles:changed', // Profile[]
  UNREAD_CHANGED: 'unread:changed', // Record<index, number>
  SETTINGS_FORCE_CLOSE: 'settings:force-close',
} as const;
