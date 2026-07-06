# Remove Outlook keyboard shortcuts feature — report

## Status
Done.

## Files removed (git rm)
- electron/outlook-shortcuts.ts
- tests/outlook-shortcuts.test.ts
- electron/injection-guard.ts
- tests/injection-guard.test.ts
- electron/menu.ts
- tests/menu.test.ts
- electron/settings-store.ts
- tests/settings-store.test.ts

## Files edited
- electron/account-view-manager.ts — removed `before-input-event` handler, imports of
  `mapKey`/`toSendInputEvents`/`KeyInput`/`createInjectionGuard`, the `editableFocused` map,
  `shortcutsEnabled` field, `setShortcutsEnabled` method, and the `IPC.EDITABLE_FOCUS` ipc-message
  branch. Kept `onIdentity`, `IPC.ACCOUNT_IDENTITY`, `IPC.UNREAD_UPDATE`,
  `IPC.NOTIFICATION_ACTIVATE`, `hideAll()`, `showActive()`.
- electron/main.ts — removed `installMenu` import/call, `SettingsStore` import, `settings`
  variable + init, `manager.setShortcutsEnabled(...)` call, `IPC.SETTINGS_GET`/`SETTINGS_SET`
  handlers. Kept `IPC.SETTINGS_TOGGLE`, `settingsPanelOpen`, `SETTINGS_FORCE_CLOSE`,
  `IPC.ACCOUNTS_UPDATE`, identity wiring.
- electron/preload.ts — removed the editable-focus reporting block (`reportFocus`,
  focusin/focusout listeners, `IPC.EDITABLE_FOCUS` send). No "TEMP DEBUG keydown" /
  `debug:pagekey` block existed in this codebase, so nothing to remove there. Kept
  `isEditableTarget` export (harmless) and its tests, `extractIdentity`, identity polling,
  unread title reporting, Notification wrapper.
- electron/sidebar-preload.ts — removed `getSettings`/`setSettings` bridge methods. Kept
  `updateAccount`, `toggleSettings`, `onSettingsForceClose`.
- electron/ipc.ts — removed `EDITABLE_FOCUS`, `SETTINGS_GET`, `SETTINGS_SET` channels. Kept
  `ACCOUNT_IDENTITY`, `ACCOUNTS_UPDATE`, `SETTINGS_TOGGLE`, `SETTINGS_FORCE_CLOSE`.
- renderer/app/page.tsx — removed `getSettings`/`setSettings` from `DesktopBridge` interface.
- renderer/app/SettingsPanel.tsx — removed the "Shortcuts" section (`shortcuts` state,
  `useEffect` calling `getSettings`, `toggleShortcuts`, checkbox, label, Gmail-shortcuts hint
  paragraph), and the now-unused `useEffect`/`useState` import. Kept Accounts section
  (rename/recolor/remove) and Close button.

## Verification
- `npx tsc --noEmit` (root): clean.
- `cd renderer && npx tsc --noEmit`: clean.
- `npx vitest run`: 9 test files, 27 tests passed (was 13 test files before removal; shortcuts/
  menu/settings-store/injection-guard test files deleted).
- `npm run build`: succeeded. `renderer/out/index.html` present, no Tailwind "content is missing
  or empty" warning. `dist-electron/main.js`, `dist-electron/preload.js`,
  `dist-electron/sidebar-preload.js` all produced.
- Grep for dangling references (`outlook-shortcuts|injection-guard|setShortcutsEnabled|
  EDITABLE_FOCUS|SETTINGS_GET|SETTINGS_SET|debug:pagekey|installMenu|settings-store|\[sc\]|
  \[page\]` across `electron` and `renderer/app`): no matches — clean.

## Concerns
- None blocking. Note: the "TEMP DEBUG keydown listener" / `debug:pagekey` branch described in
  the task instructions did not exist anywhere in this repo's preload.ts or elsewhere — verified
  via repo-wide grep before and after edits, so this was a no-op removal target.
- Kept `isEditableTarget` export in electron/preload.ts and its tests in
  tests/preload-identity.test.ts (allowed choice per instructions; harmless, still exercised by
  passing tests).
