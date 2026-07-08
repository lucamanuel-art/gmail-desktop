import { describe, it, expect } from 'vitest';
import { parseChangelog } from '../electron/changelog';

const SAMPLE = `# Changelog

All notable changes to Gmail Desktop are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

## [0.1.9] — 2026-07-08

### Fixed
- Google Calendar reminders now actually show up as desktop notifications.
  Previously the calendar sent them in a way the app could not display, so you
  never saw them.

### Opgelost
- Herinneringen uit Google Agenda komen nu ook echt binnen als melding op je
  computer.

## [0.1.8] — 2026-07-08

### Added
- Choose how clicking a notification opens its message.
- Settings now has a **Save** button.

### Fixed
- Clicking a notification while the app is minimized now restores the window.

## [0.1.1] – [0.1.4]

Initial Gmail Desktop wrapper: multi-account sidebar with avatars and unread
badges, per-account calendar.
`;

describe('parseChangelog', () => {
  it('returns versions newest-first in document order', () => {
    const versions = parseChangelog(SAMPLE);
    expect(versions.map((v) => v.version)).toEqual(['0.1.9', '0.1.8', '0.1.1 – 0.1.4']);
  });

  it('extracts the date from the header', () => {
    const [latest] = parseChangelog(SAMPLE);
    expect(latest.version).toBe('0.1.9');
    expect(latest.date).toBe('2026-07-08');
  });

  it('groups bullets under their category heading', () => {
    const v018 = parseChangelog(SAMPLE).find((v) => v.version === '0.1.8')!;
    const added = v018.entries.find((e) => e.heading === 'Added')!;
    expect(added.items).toEqual([
      'Choose how clicking a notification opens its message.',
      'Settings now has a **Save** button.',
    ]);
    const fixed = v018.entries.find((e) => e.heading === 'Fixed')!;
    expect(fixed.items).toHaveLength(1);
  });

  it('joins wrapped continuation lines into one item', () => {
    const [latest] = parseChangelog(SAMPLE);
    const fixed = latest.entries.find((e) => e.heading === 'Fixed')!;
    expect(fixed.items[0]).toBe(
      'Google Calendar reminders now actually show up as desktop notifications. Previously the calendar sent them in a way the app could not display, so you never saw them.',
    );
  });

  it('language-tags English and Dutch headings', () => {
    const [latest] = parseChangelog(SAMPLE);
    expect(latest.entries.find((e) => e.heading === 'Fixed')!.lang).toBe('en');
    expect(latest.entries.find((e) => e.heading === 'Opgelost')!.lang).toBe('nl');
  });

  it('handles a version range header with no date', () => {
    const range = parseChangelog(SAMPLE).find((v) => v.version === '0.1.1 – 0.1.4')!;
    expect(range.date).toBe('');
  });

  it('ignores the title and intro before the first version', () => {
    const versions = parseChangelog(SAMPLE);
    expect(versions.every((v) => v.version !== 'Changelog')).toBe(true);
  });

  it('returns an empty array for empty or version-less input', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('# Changelog\n\nJust some prose.\n')).toEqual([]);
  });
});
