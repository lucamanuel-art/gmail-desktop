// Pure derivation of the little "check for updates" popup shown after a
// tray-initiated update check. Returns null for intermediate states so the
// caller waits for a terminal result before popping anything.

export interface UpdateStatusLike {
  state: string;
  version?: string;
  currentVersion?: string;
  percent?: number;
  message?: string;
}

export interface UpdatePopup {
  message: string;
  detail?: string;
  buttons: string[];
  // Index of the button that should start a download (absent = no download action).
  downloadButtonIndex?: number;
}

export function updateCheckPopup(status: UpdateStatusLike): UpdatePopup | null {
  switch (status.state) {
    case 'dev':
      return {
        message: 'Update checks only work in the installed app.',
        buttons: ['OK'],
      };
    case 'available':
      return {
        message: `A new version${status.version ? ` (v${status.version})` : ''} is available.`,
        detail: status.currentVersion ? `You have v${status.currentVersion} installed.` : undefined,
        buttons: ['Download', 'Later'],
        downloadButtonIndex: 0,
      };
    case 'not-available':
      return {
        message: `You already have the latest version${status.currentVersion ? ` (v${status.currentVersion})` : ''}.`,
        buttons: ['OK'],
      };
    case 'error':
      return {
        message: "Couldn't check for updates.",
        detail: status.message ? String(status.message) : undefined,
        buttons: ['OK'],
      };
    default:
      // idle / checking / downloading / downloaded — nothing to announce yet.
      return null;
  }
}
