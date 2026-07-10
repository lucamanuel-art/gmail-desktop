export interface NotifyDecisionInput {
  state: string; // autoUpdater-derived state
  version: string | null; // the available version
  background: boolean; // was the triggering check a background one?
  notifiedVersion: string | null; // last version already notified this session
}

// Notify only for a genuinely new version surfaced by a background check — not
// for manual checks (the user is already looking) and not twice for the same
// version within a session.
export function shouldNotifyUpdate(i: NotifyDecisionInput): boolean {
  return (
    i.state === 'available' &&
    i.background &&
    !!i.version &&
    i.version !== i.notifiedVersion
  );
}
