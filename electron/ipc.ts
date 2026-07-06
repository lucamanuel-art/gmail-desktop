// Channel names shared between main, preload, and renderer.
export const IPC = {
  // renderer (sidebar) -> main
  ACCOUNTS_LIST: 'accounts:list', // invoke, returns Account[]
  ACCOUNTS_ADD: 'accounts:add', // invoke({label,color}), returns Account
  ACCOUNTS_REMOVE: 'accounts:remove', // invoke(id)
  ACCOUNTS_SWITCH: 'accounts:switch', // send(id)
  // preload (Gmail view) -> main
  UNREAD_UPDATE: 'unread:update', // send(count:number)
  NOTIFICATION_ACTIVATE: 'notification:activate', // send()
  // main -> renderer (sidebar)
  ACCOUNTS_CHANGED: 'accounts:changed', // Account[]
  UNREAD_CHANGED: 'unread:changed', // Record<accountId, number>
  // Gmail view -> main
  ACCOUNT_IDENTITY: 'account:identity', // send({email,name,avatarUrl})
  EDITABLE_FOCUS: 'editable:focus', // send(boolean)
  // renderer (sidebar) -> main
  ACCOUNTS_UPDATE: 'accounts:update', // invoke(id, patch: {label?,color?,email?,name?,avatarUrl?})
  SETTINGS_TOGGLE: 'settings:toggle', // send({open:boolean})
  SETTINGS_GET: 'settings:get', // invoke -> Settings
  SETTINGS_SET: 'settings:set', // invoke(patch) -> Settings
} as const;
