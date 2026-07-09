import type { MailtoFields } from './mailto';

// Builds Gmail's standalone compose URL for account `index`, optionally
// prefilled from mailto fields. With no fields this equals the plain compose URL.
export function composeUrl(index: number, fields?: MailtoFields): string {
  const base = `https://mail.google.com/mail/u/${index}/?view=cm&fs=1&tf=1`;
  if (!fields) return base;
  const params: Array<[string, string]> = [
    ['to', fields.to],
    ['su', fields.subject],
    ['body', fields.body],
    ['cc', fields.cc],
    ['bcc', fields.bcc],
  ];
  return (
    base +
    params
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
      .join('')
  );
}
