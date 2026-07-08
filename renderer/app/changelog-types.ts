// Shape of the changelog data sent from the main process (electron/changelog.ts).
// Kept in the renderer separately because renderer code can't import from electron/.

export type Lang = 'en' | 'nl' | 'unknown';

export interface ChangelogEntry {
  heading: string;
  lang: Lang;
  items: string[];
}

export interface ChangelogVersion {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}
