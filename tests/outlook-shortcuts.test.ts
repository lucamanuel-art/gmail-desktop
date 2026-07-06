import { describe, it, expect } from 'vitest';
import { mapKey, toSendInputEvents, type KeyInput } from '../electron/outlook-shortcuts';

const base: KeyInput = { type: 'keyDown', key: '', control: false, shift: false, alt: false, meta: false };
const k = (over: Partial<KeyInput>): KeyInput => ({ ...base, ...over });

describe('mapKey — list context (not editable)', () => {
  it('maps Ctrl+R to reply (r) and prevents default', () => {
    expect(mapKey(k({ key: 'r', control: true }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: 'r' }],
    });
  });
  it('maps Ctrl+Shift+R to reply all (a)', () => {
    expect(mapKey(k({ key: 'R', control: true, shift: true }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: 'a' }],
    });
  });
  it('maps Delete to # (Shift+3)', () => {
    expect(mapKey(k({ key: 'Delete' }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: '3', shift: true }],
    });
  });
  it('maps Ctrl+Shift+I to the go-to-inbox sequence g,i', () => {
    expect(mapKey(k({ key: 'I', control: true, shift: true }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: 'g' }, { key: 'i' }],
    });
  });
  it('maps Ctrl+Q to mark-read (Shift+i)', () => {
    expect(mapKey(k({ key: 'q', control: true }), false)).toEqual({
      preventDefault: true,
      inject: [{ key: 'i', shift: true }],
    });
  });
  it('passes plain letter through', () => {
    expect(mapKey(k({ key: 'x' }), false)).toEqual({ preventDefault: false, inject: null });
  });
});

describe('mapKey — compose context (editable)', () => {
  it('maps Ctrl+R to align-right (mod+shift+r), NOT reply', () => {
    expect(mapKey(k({ key: 'r', control: true }), true)).toEqual({
      preventDefault: true,
      inject: [{ key: 'r', shift: true, mod: true }],
    });
  });
  it('does not intercept Ctrl+B (native bold)', () => {
    expect(mapKey(k({ key: 'b', control: true }), true)).toEqual({
      preventDefault: false,
      inject: null,
    });
  });
  it('maps Alt+S to send (mod+Enter)', () => {
    expect(mapKey(k({ key: 's', alt: true }), true)).toEqual({
      preventDefault: true,
      inject: [{ key: 'Enter', mod: true }],
    });
  });
  it('Delete is not intercepted while editable (normal text delete)', () => {
    expect(mapKey(k({ key: 'Delete' }), true)).toEqual({ preventDefault: false, inject: null });
  });
});

describe('mapKey — ignores non-keydown', () => {
  it('returns pass-through for keyUp', () => {
    expect(mapKey(k({ key: 'r', control: true, type: 'keyUp' }), false)).toEqual({
      preventDefault: false,
      inject: null,
    });
  });
});

describe('toSendInputEvents', () => {
  it('uses control on linux and shift when set', () => {
    expect(toSendInputEvents([{ key: 'Enter', mod: true }], 'linux')).toEqual([
      { keyCode: 'Enter', modifiers: ['control'] },
    ]);
    expect(toSendInputEvents([{ key: 'i', shift: true }], 'linux')).toEqual([
      { keyCode: 'i', modifiers: ['shift'] },
    ]);
  });
  it('uses meta on darwin for mod', () => {
    expect(toSendInputEvents([{ key: 'Enter', mod: true }], 'darwin')).toEqual([
      { keyCode: 'Enter', modifiers: ['meta'] },
    ]);
  });
  it('expands a sequence in order', () => {
    expect(toSendInputEvents([{ key: 'g' }, { key: 'i' }], 'linux')).toEqual([
      { keyCode: 'g', modifiers: [] },
      { keyCode: 'i', modifiers: [] },
    ]);
  });
});
