// Channel names shared between main, preload, and renderer.
export const IPC = {
  // Gmail view -> main
  UNREAD_UPDATE: 'unread:update', // send(count:number)
  NOTIFICATION_ACTIVATE: 'notification:activate', // send(threadId?: string) — clicked notification's thread when resolvable
  ACCOUNT_IDENTITY: 'account:identity', // send({email,name,avatarUrl})
  // renderer (sidebar) -> main
  SWITCH_SURFACE: 'switch:surface', // send({key, surface:'mail'|'calendar'}) — key = accountKey
  REDETECT: 'accounts:redetect', // send()
  ADD_ACCOUNT: 'accounts:add', // send() — open Google's add-session flow in a visible view
  ADD_DELEGATED: 'delegated:add', // send() — start click-through capture of a delegated mailbox
  ADD_DELEGATED_SUGGESTION: 'delegated:add-suggestion', // send({email, mailUrl}) — accept an auto-detected suggestion
  SET_COLOR: 'color:set', // send({email, color})
  REMOVE_ACCOUNT: 'accounts:remove', // send({email}) — hide account + skip on detect
  SETTINGS_TOGGLE: 'settings:toggle', // send({open:boolean})
  UPDATE_CHECK: 'update:check', // send() — check GitHub for a newer release
  UPDATE_DOWNLOAD: 'update:download', // send() — download + auto-install the update
  UPDATE_INSTALL: 'update:install', // send() — restart into an already-downloaded update
  SET_AUTO_START: 'prefs:auto-start', // send(boolean)
  SET_ACCOUNT_PREF: 'prefs:account', // send({email, label?, notify?})
  SET_ACCOUNT_ORDER: 'prefs:order', // send({emails: string[]})
  SET_NOTIFICATIONS: 'prefs:notifications', // send({dnd, quietHours})
  SET_SNOOZE: 'prefs:snooze', // send(minutes: number | null) — >0 timed snooze, null = mute indefinitely, 0 = clear
  SET_THEME: 'prefs:theme', // send('system'|'light'|'dark')
  SET_NOTIFICATION_OPEN: 'prefs:notification-open', // send('app'|'window')
  SET_RENE_MODE: 'prefs:rene-mode', // send(boolean) — settings-page easter egg toggle
  CHANGELOG_GET: 'changelog:get', // invoke() -> ChangelogVersion[] — parsed CHANGELOG.md
  // main -> renderer (sidebar)
  PROFILES_CHANGED: 'profiles:changed', // Profile[]
  UNREAD_CHANGED: 'unread:changed', // Record<accountKey, number>
  DELEGATED_SUGGESTIONS: 'delegated:suggestions', // { suggestions: {email, mailUrl}[] } — best-effort auto-detected delegates to offer
  UPDATE_STATUS: 'update:status', // { state, currentVersion, version?, percent?, message? }
  SETTINGS_FORCE_CLOSE: 'settings:force-close',
  SETTINGS_FORCE_OPEN: 'settings:force-open', // main -> renderer: open the settings panel (e.g. tray "Check for updates")
  PREFS_CHANGED: 'prefs:changed', // main -> renderer: full Prefs
  NOTIFY_ALLOWED: 'notify:allowed', // main -> mail view: send(boolean)
} as const;

export type { ChangelogVersion, ChangelogEntry } from './changelog';
