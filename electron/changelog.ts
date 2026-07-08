// Parses the repo's CHANGELOG.md (Keep-a-Changelog style, bilingual) into
// structured data for the "What's new" section in Settings. Pure and
// dependency-free so it can be unit-tested and reused in main + renderer.

export type Lang = 'en' | 'nl' | 'unknown';

export interface ChangelogEntry {
  heading: string; // the "### Category" text, or '' for prose directly under a version
  lang: Lang;
  items: string[];
}

export interface ChangelogVersion {
  version: string; // e.g. "0.1.9" or "0.1.1 – 0.1.4"
  date: string; // e.g. "2026-07-08", or '' when the header carries no date
  entries: ChangelogEntry[];
}

const EN_HEADINGS = new Set(['added', 'fixed', 'changed', 'removed', 'security', 'deprecated']);
const NL_HEADINGS = new Set([
  'toegevoegd',
  'opgelost',
  'gewijzigd',
  'verwijderd',
  'beveiliging',
  'verouderd',
]);

function headingLang(heading: string): Lang {
  const key = heading.trim().toLowerCase();
  if (EN_HEADINGS.has(key)) return 'en';
  if (NL_HEADINGS.has(key)) return 'nl';
  return 'unknown';
}

// Splits "## " content into a version label and an optional date.
// "[0.1.9] — 2026-07-08" -> { version: '0.1.9', date: '2026-07-08' }
// "[0.1.1] – [0.1.4]"    -> { version: '0.1.1 – 0.1.4', date: '' }
function parseHeader(text: string): { version: string; date: string } {
  const first = text.match(/^\[([^\]]+)\]/);
  if (!first) return { version: text.trim(), date: '' };
  let version = first[1].trim();
  const remainder = text.slice(first[0].length).replace(/^[\s—–-]+/, '');
  const second = remainder.match(/^\[([^\]]+)\]/);
  if (second) return { version: `${version} – ${second[1].trim()}`, date: '' };
  return { version, date: remainder.trim() };
}

export function parseChangelog(markdown: string): ChangelogVersion[] {
  const versions: ChangelogVersion[] = [];
  let version: ChangelogVersion | null = null;
  let entry: ChangelogEntry | null = null;
  let item: string | null = null;

  const flushItem = () => {
    if (item !== null && entry) entry.items.push(item);
    item = null;
  };
  const flushEntry = () => {
    flushItem();
    if (entry && version && (entry.items.length > 0 || entry.heading)) version.entries.push(entry);
    entry = null;
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r$/, '');

    if (line.startsWith('## ')) {
      flushEntry();
      version = { ...parseHeader(line.slice(3).trim()), entries: [] };
      versions.push(version);
      entry = null;
      continue;
    }
    if (!version) continue; // title + intro before the first version

    if (line.startsWith('### ')) {
      flushEntry();
      const heading = line.slice(4).trim();
      entry = { heading, lang: headingLang(heading), items: [] };
      continue;
    }

    if (line.trim() === '') {
      flushItem();
      continue;
    }

    // Any content under a version with no explicit "###" gets an implicit entry.
    if (!entry) entry = { heading: '', lang: 'unknown', items: [] };

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushItem();
      item = bullet[1].trim();
    } else if (item !== null) {
      item = `${item} ${line.trim()}`; // wrapped continuation line
    } else {
      item = line.trim(); // start of a prose paragraph
    }
  }
  flushEntry();

  // Drop versions that ended up with no displayable content at all.
  return versions.filter((v) => v.entries.length > 0);
}
