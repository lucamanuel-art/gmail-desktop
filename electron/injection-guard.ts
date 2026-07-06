// Guards against re-processing keystrokes we synthesize via `sendInputEvent`:
// Electron re-dispatches synthetic input through `before-input-event`, so an
// injected combo whose Gmail target is itself a mapped combo (e.g. Ctrl+Shift+D)
// would otherwise loop forever. We count the keyDowns we inject and let exactly
// that many pass through unmapped.
export interface InjectionGuard {
  /** True when this keyDown is one of our own injected keystrokes (skip mapping). */
  consume(isKeyDown: boolean): boolean;
  /** Arm the guard for `count` about-to-be-injected keys (one keyDown each). */
  arm(count: number): void;
}

export function createInjectionGuard(): InjectionGuard {
  let pending = 0;
  return {
    consume(isKeyDown: boolean): boolean {
      if (isKeyDown && pending > 0) {
        pending -= 1;
        return true;
      }
      return false;
    },
    arm(count: number): void {
      pending += count;
    },
  };
}
