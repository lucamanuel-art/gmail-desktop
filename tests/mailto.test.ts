import { describe, it, expect } from 'vitest';
import { parseMailto, extractMailtoFromArgv } from '../electron/mailto';

describe('parseMailto', () => {
  it('returns null for a non-mailto url', () => {
    expect(parseMailto('https://example.com')).toBeNull();
  });
  it('parses a single recipient from the path', () => {
    expect(parseMailto('mailto:a@b.com')).toEqual({ to: 'a@b.com', cc: '', bcc: '', subject: '', body: '' });
  });
  it('parses multiple comma-separated path recipients', () => {
    expect(parseMailto('mailto:a@b.com,c@d.com')!.to).toBe('a@b.com,c@d.com');
  });
  it('reads subject and body from the query, percent-decoded', () => {
    const r = parseMailto('mailto:a@b.com?subject=Hi%20there&body=Line%20one');
    expect(r).toMatchObject({ subject: 'Hi there', body: 'Line one' });
  });
  it('reads cc and bcc from the query', () => {
    const r = parseMailto('mailto:a@b.com?cc=c@d.com&bcc=e@f.com');
    expect(r).toMatchObject({ cc: 'c@d.com', bcc: 'e@f.com' });
  });
  it('merges a to= query param with path recipients', () => {
    expect(parseMailto('mailto:a@b.com?to=c@d.com')!.to).toBe('a@b.com,c@d.com');
  });
  it('decodes an encoded ampersand in the body and treats + as literal', () => {
    const r = parseMailto('mailto:a@b.com?body=you%20%26%20me%20a+b');
    expect(r!.body).toBe('you & me a+b');
  });
  it('scheme-only mailto: yields all-empty fields', () => {
    expect(parseMailto('mailto:')).toEqual({ to: '', cc: '', bcc: '', subject: '', body: '' });
  });
  it('is case-insensitive on the scheme', () => {
    expect(parseMailto('MAILTO:a@b.com')!.to).toBe('a@b.com');
  });
});

describe('extractMailtoFromArgv', () => {
  it('finds a mailto arg among electron flags', () => {
    expect(extractMailtoFromArgv(['electron', '--flag', 'mailto:a@b.com'])).toBe('mailto:a@b.com');
  });
  it('returns null when no mailto arg is present', () => {
    expect(extractMailtoFromArgv(['electron', '.', '--foo'])).toBeNull();
  });
  it('returns the first mailto when several are present', () => {
    expect(extractMailtoFromArgv(['mailto:a@b.com', 'mailto:c@d.com'])).toBe('mailto:a@b.com');
  });
});
