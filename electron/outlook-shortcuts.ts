export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface InjectKey {
  key: string;
  shift?: boolean;
  mod?: boolean; // control on win/linux, meta on darwin
}

export interface MapResult {
  preventDefault: boolean;
  inject: InjectKey[] | null;
}

const PASS: MapResult = { preventDefault: false, inject: null };
const hit = (...inject: InjectKey[]): MapResult => ({ preventDefault: true, inject });

// Only Control-based (Outlook-for-Windows) combos and specific bare keys are matched.
function mapList(key: string, ctrl: boolean, shift: boolean): MapResult {
  if (ctrl && shift) {
    if (key === 'm') return hit({ key: 'c' });
    if (key === 'r') return hit({ key: 'a' });
    if (key === 'v') return hit({ key: 'v' });
    if (key === 'd') return hit({ key: 'm' });
    if (key === 'i') return hit({ key: 'g' }, { key: 'i' });
  }
  if (ctrl && !shift) {
    if (key === 'n') return hit({ key: 'c' });
    if (key === 'r') return hit({ key: 'r' });
    if (key === 'f') return hit({ key: 'f' });
    if (key === 'o') return hit({ key: 'o' });
    if (key === 'q') return hit({ key: 'i', shift: true });
    if (key === 'u') return hit({ key: 'u', shift: true });
    if (key === 'z') return hit({ key: 'z' });
    if (key === 'a') return hit({ key: '8', shift: true }, { key: 'a' });
    if (key === 'e') return hit({ key: '/' });
    if (key === '1') return hit({ key: 'g' }, { key: 'i' });
    if (key === '.') return hit({ key: 'n' });
    if (key === ',') return hit({ key: 'p' });
    if (key === ' ') return hit({ key: 'x' });
  }
  if (!ctrl && !shift) {
    if (key === 'delete') return hit({ key: '3', shift: true });
    if (key === 'backspace') return hit({ key: 'e' });
    if (key === 'insert') return hit({ key: 's' });
    if (key === 'f3') return hit({ key: '/' });
    if (key === 'arrowdown') return hit({ key: 'j' });
    if (key === 'arrowup') return hit({ key: 'k' });
  }
  return PASS;
}

function mapCompose(key: string, ctrl: boolean, shift: boolean, alt: boolean): MapResult {
  if (alt && key === 's') return hit({ key: 'Enter', mod: true });
  if (ctrl && shift) {
    if (key === 'l') return hit({ key: '8', shift: true, mod: true });
    if (key === 't') return hit({ key: '[', mod: true });
    if (key === 'd') return hit({ key: 'd', shift: true, mod: true });
  }
  if (ctrl && !shift) {
    if (key === 't') return hit({ key: ']', mod: true });
    if (key === 'l') return hit({ key: 'l', shift: true, mod: true });
    if (key === 'e') return hit({ key: 'e', shift: true, mod: true });
    if (key === 'r') return hit({ key: 'r', shift: true, mod: true });
    if (key === ' ') return hit({ key: '\\', mod: true });
  }
  // Ctrl+B/I/U/K and Ctrl+Enter are left native → pass through.
  return PASS;
}

export function mapKey(input: KeyInput, editableFocused: boolean): MapResult {
  if (input.type !== 'keyDown') return PASS;
  const key = input.key.toLowerCase();
  return editableFocused
    ? mapCompose(key, input.control, input.shift, input.alt)
    : mapList(key, input.control, input.shift);
}

export function toSendInputEvents(
  keys: InjectKey[],
  platform: NodeJS.Platform,
): Array<{ keyCode: string; modifiers: string[] }> {
  const modKey = platform === 'darwin' ? 'meta' : 'control';
  return keys.map((k) => {
    const modifiers: string[] = [];
    if (k.mod) modifiers.push(modKey);
    if (k.shift) modifiers.push('shift');
    return { keyCode: k.key, modifiers };
  });
}
