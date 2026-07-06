import { describe, it, expect } from 'vitest';
import { extractIdentity, isEditableTarget } from '../electron/preload';

function fakeDoc(ariaLabel: string | null, imgSrc: string | null) {
  const anchor =
    ariaLabel === null
      ? null
      : {
          getAttribute: (n: string) => (n === 'aria-label' ? ariaLabel : null),
          querySelector: () => (imgSrc === null ? null : { getAttribute: () => imgSrc }),
        };
  return {
    querySelectorAll: (sel: string) => (sel === 'a[aria-label]' && anchor ? [anchor] : []),
  };
}

describe('extractIdentity', () => {
  it('pulls email, name and avatar from the account anchor', () => {
    const doc = fakeDoc(
      'Google Account: Ada Lovelace (ada@gmail.com)',
      'https://lh3.googleusercontent.com/a/pic',
    );
    expect(extractIdentity(doc)).toEqual({
      email: 'ada@gmail.com',
      name: 'Ada Lovelace',
      avatarUrl: 'https://lh3.googleusercontent.com/a/pic',
    });
  });
  it('handles a localized (Dutch) aria-label', () => {
    const doc = fakeDoc(
      'Google-account: Ada Lovelace (ada@gmail.com)',
      'https://lh3.googleusercontent.com/a/pic',
    );
    expect(extractIdentity(doc)).toEqual({
      email: 'ada@gmail.com',
      name: 'Ada Lovelace',
      avatarUrl: 'https://lh3.googleusercontent.com/a/pic',
    });
  });
  it('ignores an aria-label anchor without an email', () => {
    expect(
      extractIdentity(fakeDoc('Main menu', 'https://lh3.googleusercontent.com/a/pic')),
    ).toBeNull();
  });
  it('returns null when the anchor is absent', () => {
    expect(extractIdentity(fakeDoc(null, null))).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('is true for input, textarea and contenteditable', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
  it('is false for a plain element or null', () => {
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
