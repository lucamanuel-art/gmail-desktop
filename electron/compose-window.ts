import { BrowserWindow } from 'electron';

const SESSION_PARTITION = 'persist:google';

// Opens Gmail's standalone compose window for account `index`. Keystroke
// injection into the main Gmail view does not work, so compose is triggered by
// loading Gmail's compose URL in a small popup on the shared Google session.
export function openCompose(index: number): void {
  const win = new BrowserWindow({
    width: 720,
    height: 640,
    title: 'New message',
    backgroundColor: '#ffffff',
    webPreferences: { partition: SESSION_PARTITION, contextIsolation: true },
  });
  void win.loadURL(`https://mail.google.com/mail/u/${index}/?view=cm&fs=1&tf=1`);
}
