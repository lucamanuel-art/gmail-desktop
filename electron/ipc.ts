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
} as const;
