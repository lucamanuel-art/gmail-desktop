import { describe, expect, it } from 'vitest';
import { findThreadIdBySubject } from '../electron/preload';

// Gmail's new-mail notification carries no thread id (tag is just the account
// email, data is null), but the inbox list DOM marks each row's subject span
// with data-legacy-thread-id. Matching the notification body (= subject) against
// those spans gives the thread to open on click. Rows are newest-first, so the
// first match is the message that just fired the notification.
type FakeEl = { text: string; id: string };
function doc(rows: FakeEl[]) {
  return {
    querySelectorAll: () =>
      rows.map((r) => ({
        textContent: r.text,
        getAttribute: (name: string) => (name === 'data-legacy-thread-id' ? r.id : null),
      })),
  };
}

describe('findThreadIdBySubject', () => {
  it('returns the first row whose subject matches exactly (newest first)', () => {
    const d = doc([
      { text: 'Weekly report', id: 'aaa' },
      { text: 'Notificatieklik test', id: 'bbb' },
      { text: 'Notificatieklik test', id: 'ccc' }, // older thread, same subject
    ]);
    expect(findThreadIdBySubject(d, 'Notificatieklik test')).toBe('bbb');
  });

  it('trims whitespace on both sides of the comparison', () => {
    const d = doc([{ text: '  Hello  ', id: 'x1' }]);
    expect(findThreadIdBySubject(d, 'Hello ')).toBe('x1');
  });

  it('falls back to prefix match when the notification body is ellipsized', () => {
    const d = doc([{ text: 'A very long subject line that Gmail cut off somewhere', id: 'y1' }]);
    expect(findThreadIdBySubject(d, 'A very long subject line that…')).toBe('y1');
    expect(findThreadIdBySubject(d, 'A very long subject line that...')).toBe('y1');
  });

  it('returns null when nothing matches or the subject is empty', () => {
    const d = doc([{ text: 'Something', id: 'z1' }]);
    expect(findThreadIdBySubject(d, 'Other')).toBeNull();
    expect(findThreadIdBySubject(d, '')).toBeNull();
    expect(findThreadIdBySubject(doc([]), 'Something')).toBeNull();
  });

  it('ignores rows without a usable id', () => {
    const d = {
      querySelectorAll: () => [
        { textContent: 'Hit', getAttribute: () => null },
        { textContent: 'Hit', getAttribute: (n: string) => (n === 'data-legacy-thread-id' ? 'ok1' : null) },
      ],
    };
    expect(findThreadIdBySubject(d, 'Hit')).toBe('ok1');
  });
});
