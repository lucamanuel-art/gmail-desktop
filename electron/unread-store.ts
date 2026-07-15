// Owns the per-account unread counts that feed the taskbar badge and the sidebar
// markers, keyed by accountKey.
//
// The badge "sticking" class of bug comes from a view being torn down (a delegated
// mailbox reloaded on token rotation, a duplicate/empty probe discarded, an account
// removed) while its last-reported count lingers in the map — it keeps summing into
// the badge total forever, since a gone view never reports a fresh number. Routing
// every count change through here, where reporting 0 *forgets* the key, means a
// discarded view (which reports 0 on teardown) can no longer stick.
export class UnreadStore {
  private counts: Record<string, number> = {};

  // Record a view's current unread count. A count of 0 (or anything non-positive /
  // non-finite) forgets the key entirely rather than storing a 0, so torn-down and
  // read-empty accounts drop out of the total instead of lingering.
  report(key: string, count: number): void {
    if (Number.isFinite(count) && count > 0) this.counts[key] = count;
    else delete this.counts[key];
  }

  forget(key: string): void {
    delete this.counts[key];
  }

  snapshot(): Record<string, number> {
    return { ...this.counts };
  }
}
