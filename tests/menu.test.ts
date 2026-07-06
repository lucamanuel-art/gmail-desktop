import { describe, it, expect } from 'vitest';
import { menuTemplate } from '../electron/menu';

describe('menuTemplate', () => {
  it('provides an Edit submenu with clipboard roles', () => {
    const template = menuTemplate();
    const edit = template.find((m) => m.label === 'Edit');
    const roles = (edit?.submenu ?? []).map((i) => (i as { role?: string }).role);
    for (const r of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(roles).toContain(r);
    }
  });
  it('does NOT bind reload, forceReload, or toggleDevTools roles (they steal Outlook shortcuts)', () => {
    const roles = menuTemplate()
      .flatMap((m) => (m.submenu ?? []) as Array<{ role?: string }>)
      .map((i) => i.role);
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forceReload');
    expect(roles).not.toContain('toggleDevTools');
  });
  it('includes a quit role so the app is quittable', () => {
    const roles = menuTemplate()
      .flatMap((m) => (m.submenu ?? []) as Array<{ role?: string }>)
      .map((i) => i.role);
    expect(roles).toContain('quit');
  });
});
