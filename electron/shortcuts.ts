export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}
export type Action =
  | { type: 'switch'; n: number }
  | { type: 'compose' }
  | { type: 'zoom'; dir: 'in' | 'out' | 'reset' };

export function resolveShortcut(input: KeyInput): Action | null {
  if (input.type !== 'keyDown') return null;
  const mod = input.control || input.meta;
  if (!mod) return null;
  const key = input.key.toLowerCase();
  if (key === 'n') return { type: 'compose' };
  if (key === '0') return { type: 'zoom', dir: 'reset' };
  if (key === '=' || key === '+') return { type: 'zoom', dir: 'in' };
  if (key === '-' || key === '_') return { type: 'zoom', dir: 'out' };
  if (/^[1-9]$/.test(key)) return { type: 'switch', n: Number(key) };
  return null;
}
