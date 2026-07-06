import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc';

interface Profile {
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}
type Surface = 'mail' | 'calendar';

contextBridge.exposeInMainWorld('desktop', {
  onProfilesChanged: (cb: (profiles: Profile[]) => void): void => {
    ipcRenderer.on(IPC.PROFILES_CHANGED, (_e, profiles) => cb(profiles));
  },
  onUnreadChanged: (cb: (counts: Record<number, number>) => void): void => {
    ipcRenderer.on(IPC.UNREAD_CHANGED, (_e, counts) => cb(counts));
  },
  switchSurface: (index: number, surface: Surface): void =>
    ipcRenderer.send(IPC.SWITCH_SURFACE, { index, surface }),
  redetect: (): void => ipcRenderer.send(IPC.REDETECT),
  setColor: (email: string, color: string): void =>
    ipcRenderer.send(IPC.SET_COLOR, { email, color }),
  toggleSettings: (open: boolean): void => ipcRenderer.send(IPC.SETTINGS_TOGGLE, { open }),
  onSettingsForceClose: (cb: () => void): void => {
    ipcRenderer.on(IPC.SETTINGS_FORCE_CLOSE, () => cb());
  },
});
