import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc';
import type { Surface } from '../renderer/lib/surfaces';

interface Profile {
  key: string;
  kind: 'authuser' | 'delegated';
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  order?: number;
  label?: string;
}

contextBridge.exposeInMainWorld('desktop', {
  onProfilesChanged: (cb: (profiles: Profile[]) => void): void => {
    ipcRenderer.on(IPC.PROFILES_CHANGED, (_e, profiles) => cb(profiles));
  },
  onUnreadChanged: (cb: (counts: Record<string, number>) => void): void => {
    ipcRenderer.on(IPC.UNREAD_CHANGED, (_e, counts) => cb(counts));
  },
  switchSurface: (key: string, surface: Surface): void =>
    ipcRenderer.send(IPC.SWITCH_SURFACE, { key, surface }),
  redetect: (): void => ipcRenderer.send(IPC.REDETECT),
  addAccount: (): void => ipcRenderer.send(IPC.ADD_ACCOUNT),
  addDelegated: (): void => ipcRenderer.send(IPC.ADD_DELEGATED),
  addDelegatedSuggestion: (arg: { email: string; mailUrl: string }): void =>
    ipcRenderer.send(IPC.ADD_DELEGATED_SUGGESTION, arg),
  onDelegatedSuggestions: (cb: (arg: { suggestions: { email: string; mailUrl: string }[] }) => void): void => {
    ipcRenderer.on(IPC.DELEGATED_SUGGESTIONS, (_e, arg) => cb(arg));
  },
  setColor: (email: string, color: string): void =>
    ipcRenderer.send(IPC.SET_COLOR, { email, color }),
  removeAccount: (email: string): void => ipcRenderer.send(IPC.REMOVE_ACCOUNT, { email }),
  checkForUpdate: (): void => ipcRenderer.send(IPC.UPDATE_CHECK),
  downloadUpdate: (): void => ipcRenderer.send(IPC.UPDATE_DOWNLOAD),
  installUpdate: (): void => ipcRenderer.send(IPC.UPDATE_INSTALL),
  onUpdateStatus: (cb: (status: unknown) => void): void => {
    ipcRenderer.on(IPC.UPDATE_STATUS, (_e, status) => cb(status));
  },
  toggleSettings: (open: boolean): void => ipcRenderer.send(IPC.SETTINGS_TOGGLE, { open }),
  setMenuOverlay: (open: boolean): void => ipcRenderer.send(IPC.OVERLAY_TOGGLE, { open }),
  onSettingsForceClose: (cb: () => void): void => {
    ipcRenderer.on(IPC.SETTINGS_FORCE_CLOSE, () => cb());
  },
  onSettingsForceOpen: (cb: () => void): void => {
    ipcRenderer.on(IPC.SETTINGS_FORCE_OPEN, () => cb());
  },
  setAutoStart: (v: boolean): void => ipcRenderer.send(IPC.SET_AUTO_START, v),
  onPrefsChanged: (cb: (prefs: unknown) => void): void => {
    ipcRenderer.on(IPC.PREFS_CHANGED, (_e, p) => cb(p));
  },
  setAccountPref: (arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean }): void =>
    ipcRenderer.send(IPC.SET_ACCOUNT_PREF, arg),
  setAccountOrder: (emails: string[]): void =>
    ipcRenderer.send(IPC.SET_ACCOUNT_ORDER, { emails }),
  setNotifications: (arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }): void =>
    ipcRenderer.send(IPC.SET_NOTIFICATIONS, arg),
  setTheme: (theme: 'system' | 'light' | 'dark'): void => ipcRenderer.send(IPC.SET_THEME, theme),
  setNotificationOpen: (v: 'app' | 'window'): void => ipcRenderer.send(IPC.SET_NOTIFICATION_OPEN, v),
  setReneMode: (v: boolean): void => ipcRenderer.send(IPC.SET_RENE_MODE, v),
  getChangelog: (): Promise<unknown> => ipcRenderer.invoke(IPC.CHANGELOG_GET),
});
