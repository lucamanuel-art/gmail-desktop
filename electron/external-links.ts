import { shell, type WebContents } from 'electron';
import { isInAppUrl, isGoogleUrl } from './google-urls';

// Routes links that don't belong to the in-app Gmail/Calendar/auth surfaces to
// the user's default browser instead of opening them inside the mail view.
//
// - window.open / target=_blank (how Gmail opens links clicked in an email,
//   via its www.google.com/url redirect wrapper) -> denied in-app, opened
//   externally, unless the target is one of our own in-app hosts.
// - top-frame navigation to a non-Google host -> cancelled and opened
//   externally. Google-to-Google navigation is left alone so login and
//   internal redirects keep working.
export function attachExternalLinkHandling(
  webContents: WebContents,
  opts?: { getOpenMode?: () => 'app' | 'window'; openInApp?: (url: string) => void },
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isInAppUrl(url)) {
      // In-app (Gmail/Calendar/auth) popups — e.g. a clicked notification's
      // thread. 'app' mode opens it in place and brings the window forward;
      // 'window' mode keeps the separate window (the previous behaviour).
      if (opts?.getOpenMode?.() === 'app' && opts.openInApp) {
        opts.openInApp(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (!isGoogleUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}
