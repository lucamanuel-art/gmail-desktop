import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc';

interface Account {
  id: string;
  label: string;
  color: string;
}

contextBridge.exposeInMainWorld('desktop', {
  listAccounts: (): Promise<Account[]> => ipcRenderer.invoke(IPC.ACCOUNTS_LIST),
  addAccount: (input: { label: string; color: string }): Promise<Account> =>
    ipcRenderer.invoke(IPC.ACCOUNTS_ADD, input),
  removeAccount: (id: string): Promise<void> => ipcRenderer.invoke(IPC.ACCOUNTS_REMOVE, id),
  switchAccount: (id: string): void => ipcRenderer.send(IPC.ACCOUNTS_SWITCH, id),
  onAccountsChanged: (cb: (accounts: Account[]) => void): void => {
    ipcRenderer.on(IPC.ACCOUNTS_CHANGED, (_e, accounts) => cb(accounts));
  },
  onUnreadChanged: (cb: (counts: Record<string, number>) => void): void => {
    ipcRenderer.on(IPC.UNREAD_CHANGED, (_e, counts) => cb(counts));
  },
});
