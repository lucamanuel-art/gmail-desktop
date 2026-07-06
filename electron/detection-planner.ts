export function planNext(
  seenEmails: string[],
  index: number,
  identity: { email: string } | null,
  maxAccounts = 10,
): { register: boolean; stop: boolean } {
  if (!identity || !identity.email) return { register: false, stop: true };
  if (seenEmails.includes(identity.email)) return { register: false, stop: true };
  return { register: true, stop: index + 1 >= maxAccounts };
}
