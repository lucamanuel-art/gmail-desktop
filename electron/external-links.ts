import { shell, type WebContents } from 'electron';
import { isInAppUrl, isGoogleUrl, isPopoutUrl } from './google-urls';

// Routes links that don't belong to the in-app Gmail/Calendar/auth surfaces to
// the user's default browser instead of opening them inside the mail view.
//
// - window.open / target=_blank (how Gmail opens links clicked in an email,
//   via its www.google.com/url redirect wrapper) -> denied in-app, opened
//   externally, unless the target is one of our own in-app hosts.
// - top-frame navigation to a non-Google host -> cancelled and opened
//   externally. Google-to-Google navigation is left alone so login and
//   internal redirects keep working.
export type WindowOpenAction = 'open-external' | 'suppress' | 'open-in-app' | 'allow';

// Pure decision for a window.open from inside a view.
// - `suppressed` is true right after the app handled a notification click:
//   Gmail's own click handler then ALSO opens the thread (a normal window or
//   its focused pop-out), which would be a duplicate/stray window.
// - `popoutExpected` is true only while the app is deliberately triggering
//   Gmail's pop-out button (window mode). A pop-out window.open is allowed only
//   then, or when nothing is being suppressed (a manual ↗ click by the user).
//   During a notification click we did NOT initiate, a pop-out is suppressed.
export function windowOpenAction(
  url: string,
  mode: 'app' | 'window',
  suppressed: boolean,
  popoutExpected: boolean,
): WindowOpenAction {
  if (!isInAppUrl(url)) return 'open-external';
  if (isPopoutUrl(url)) {
    if (popoutExpected) return 'allow'; // the pop-out we deliberately triggered
    if (suppressed) return 'suppress'; // Gmail's own auto pop-out on a notification click
    return 'allow'; // a manual ↗ click by the user
  }
  if (suppressed) return 'suppress';
  return mode === 'app' ? 'open-in-app' : 'allow';
}

export function attachExternalLinkHandling(
  webContents: WebContents,
  opts?: {
    getOpenMode?: () => 'app' | 'window';
    openInApp?: (url: string) => void;
    isNotificationClickInFlight?: () => boolean;
    isPopoutExpected?: () => boolean;
  },
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    const action = windowOpenAction(
      url,
      opts?.getOpenMode?.() ?? 'window',
      opts?.isNotificationClickInFlight?.() ?? false,
      opts?.isPopoutExpected?.() ?? false,
    );
    if (action === 'open-in-app' && opts?.openInApp) {
      opts.openInApp(url);
      return { action: 'deny' };
    }
    if (action === 'suppress') return { action: 'deny' };
    if (action === 'open-external') {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (!isGoogleUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}
