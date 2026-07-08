# Gmail Desktop — werk voor 8 juli 2026 (overdracht)

Stand aan het eind van 7 juli. Alles staat op `master` (`origin/master`), working tree schoon.

## Waar we staan

- **Uitgebracht:** v0.1.7 (external links → default browser).
- **Klaar maar NIET uitgebracht:** v0.1.8. `master` = 0.1.8, changelog bijgewerkt, en er is een
  **lokale tag `v0.1.8`** (nog niet gepusht → geen release getriggerd).
  - 0.1.8 bevat: instelling **"When you click a notification: Open in the app / Open in a new
    window"** (Instellingen → General, standaard *in de app*). In-app modus weigert het losse
    venster, haalt het hoofdvenster naar voren (ook uit geminimaliseerd) en opent de mail/afspraak
    in-place. Geïntegreerd in de bestaande `external-links.ts` (`attachExternalLinkHandling` kreeg
    een `opts`-param met `getOpenMode` + `openInApp`).
  - Een **testbare installer** voor 0.1.8 is gebouwd via de nieuwe workflow **"Build (no publish)"**
    → GitHub Actions → artefact `gmail-desktop-windows` (geen release).

### Direct af te maken: 0.1.8 releasen (bijgewerkt 8 juli)
0.1.8 bevat nu óók de melding-klik-fix (opent de aangeklikte mail; instelling werkt) en de
crash-fix voor zelf-sluitende views — zie de OPGELOST-secties hieronder. De agenda-fix zit er
bewust NIET in (die is voor 0.1.9, branch `calendar-reminders-0.1.9`).
1. **Lokaal testen op Windows**: installer is lokaal gebouwd (Windows Node via cmd.exe, zie
   memory/handleiding) — `C:\Users\luca.manuel\gmail-desktop-build\dist\Gmail Desktop Setup 0.1.8.exe`.
2. Als goed → **release**: tag `v0.1.8` verplaatsen naar de nieuwe commit
   (`git tag -d v0.1.8 && git tag v0.1.8`) en pushen → CI bouwt + publiceert.

## OPGELOST (8 juli): agenda-herinneringen vuren niet af

- **Symptoom was:** mail-meldingen werken; **agenda-herinneringen komen niet** (op de achtergrond).
- **Root cause (bewezen met live CDP-instrumentatie op 8 juli):** Google Agenda vuurt herinneringen
  **niet** via `new window.Notification(...)` (zoals Gmail) maar via
  **`ServiceWorkerRegistration.showNotification(...)`** ("persistent notification"). Electron toont
  persistent notifications helemaal niet (bekend, electron/electron#13041) én dat pad omzeilde onze
  notify-allowed-gate en klik-routing. De verborgen view was NIET het probleem: de herinnering vuurde
  exact op tijd vanuit de verborgen achtergrond-view (`document.visibilityState === 'hidden'`).
- **Fix:** `rerouteServiceWorkerNotifications()` in `electron/preload.ts` — patcht
  `ServiceWorkerRegistration.prototype.showNotification` zodat de aanroep door de bestaande (gegate,
  klik-geroute) `window.Notification`-wrapper loopt. `actions` wordt gestript (alleen geldig voor
  persistente meldingen); de ctor wordt bij aanroep opgelost zodat de gate-wrapper meedoet.
- **Geverifieerd:** live in WSL met een echte Agenda-herinnering vanuit de verborgen view — de
  SW-aanroep komt nu als `window.Notification`-constructie binnen (zelfde pad als mail, dat op
  Windows aantoonbaar werkt). Unit tests: `tests/preload-sw-notifications.test.ts` (81 totaal groen).
- **Nog te doen:** smoke-test op Windows (echte toast zichtbaar + klik opent agenda van het juiste
  account). De code staat op branch **`calendar-reminders-0.1.9`** (bewust buiten 0.1.8 gehouden);
  mergen + versie bumpen zodra 0.1.8 lokaal is goedgekeurd, en dan als **concept-release** (draft)
  uitbrengen: zet daarbij `releaseType: draft` in `electron-builder.yml`.

## OPGELOST (8 juli): melding-klik opent de mail niet / "When you click a notification" doet niets

- **Root cause (bewezen met live CDP-experimenten):** Gmail's eigen notification-click-handler doet
  in de wrapper **helemaal niets** — geen `window.open`, geen focus, geen navigatie — zelfs mét user
  activation (A/B-getest). De 0.1.8-aanname dat een melding-klik de thread via `window.open` opent
  (waar de instelling op gebouwd was) klopt dus niet: die popup komt er nooit, dus de instelling had
  nooit effect en alleen ons eigen focus+switch gedrag draaide.
- **Extra obstakel:** de melding zelf bevat géén thread-id (`tag` = accountmail, `data` = null).
- **Fix:** de app zoekt de thread zelf op. `findThreadIdBySubject()` in `electron/preload.ts` matcht
  de notification-body (= onderwerp) op de `data-legacy-thread-id`-spans in de inboxlijst
  (locale-onafhankelijk attribuut; nieuwste rij eerst; prefix-match bij afgekapt onderwerp).
  Klik stuurt `NOTIFICATION_ACTIVATE(threadId?)`; main routeert per `notificationOpen`:
  - **in de app**: venster naar voren + hash-navigatie (`#inbox/<id>`, instant SPA) in de mail-view
    (`ProfileViewManager.openMailThread`);
  - **nieuw venster**: `openThreadWindow()` in `compose-window.ts` (eigen venster met de thread).
  Geen thread gevonden → fallback = oud gedrag (inbox van het juiste account).
- **Geverifieerd (live in WSL, echte zelf-gestuurde testmail):** klik in 'app'-modus opent exact de
  juiste thread in-place; 'window'-modus opent een apart venster met die thread. Unit tests:
  `tests/preload-thread-lookup.test.ts`.

## OPGELOST (8 juli): main-process crash na window.close() vanuit een view

- Gmail's losse compose (view=cm) sluit zichzelf na verzenden (`window.close()`); de view bleef in
  de manager-map staan en de 60s-`refreshNotifyAllowed`-tick crashte op de vernietigde webContents
  ("Cannot read properties of undefined (reading 'send')"). Fix: `destroyed`-listener ruimt de view
  op + guard in `pushNotifyAllowed`. Live geverifieerd.

## Release-flow: concept-releases (gepland voor 0.1.9)

- Voor 0.1.9: zet `releaseType: draft` in `electron-builder.yml`. Een tag-push bouwt dan de
  installer en zet hem als **concept-release** (draft) op GitHub; auto-update ziet 'm pas na
  handmatig **"Publish release"**. 0.1.8 volgt nog de bestaande flow (`releaseType: release`).

## Backlog-feature A: Google-apps (Sheets/Docs/Drive/…)

Aanpak (uit scoping): volg het bestaande surface-patroon (`/u/<N>/` per account).

- **v1 apps (veilig, zelfde `/u/N/`-vorm):** Drive `drive.google.com/drive/u/<N>/my-drive`,
  Docs `docs.google.com/document/u/<N>/`, Sheets `.../spreadsheets/u/<N>/`,
  Slides `.../presentation/u/<N>/`, Keep `keep.google.com/u/<N>/`,
  Contacts `contacts.google.com/u/<N>/`, Chat `chat.google.com/u/<N>/`.
- **Eerst handmatig spiken (misschien uit v1):** Meet (query-param, niet path; call-shaped),
  Tasks (panel-shaped, geen echte standalone pagina).
- **Belangrijke ontwerpkeuzes (voor de brainstorm):**
  1. Welke apps in v1 (7 veilige nu, Meet/Tasks later)?
  2. **Sidebar-UX** — aanbevolen **"waffle"-flyout per account** (Optie B): avatar + agenda blijven
     gepind, plus een `⋯`/grid-knop die de rest toont. Alternatieven: vaste icoonrij (schaalt slecht),
     of globale app-switcher.
  3. Notificatie/ongelezen-pariteit: v1 = **geen** notificaties voor nieuwe surfaces (Chat mogelijk v2).
- **Refactor die dit nodig maakt:** `Surface` is nu 3× los gedupliceerd (`profile-view-manager.ts`,
  `page.tsx`, `sidebar-preload.ts`) + hardcoded in `notification-policy.ts`. Bij ~9 waarden: **consolideer
  naar één gedeelde `Surface`-type + een `SURFACE_CONFIG` lookup-map** i.p.v. `if (surface === 'x')` op ≥4
  plekken, zodat een ontbrekende surface een TS-fout is i.p.v. stille `else`-doorval.
- Volledige scoping stond in `.superpowers/sdd/scoping-google-apps.md` (gitignored scratch).

## Backlog-feature B: Tray-menu-uitbreidingen  ✅ GEÏMPLEMENTEERD (branch `worktree-tray-menu-enhancements`)

Alle drie de items zijn gebouwd volgens de scoping-aanbevelingen: `createTray` bouwt het menu niet meer
statisch — `buildTrayMenu(state)` + `updateTrayMenu(tray, state)` + een pure `trayMenuTemplate(state)`
(unit-getest zonder Electron). `dndUntil?: number` toegevoegd aan `NotificationPrefs` (defensief ingelezen
in `PrefsStore.getAll`), `notificationsAllowed` gate uitgebreid, en de 60s `refreshNotifyAllowed`-tick ruimt
een verlopen snooze zelf op + herbouwt het tray-menu. Nieuw IPC `SET_SNOOZE`. Update/autostart/snooze-logica
is gefactoreerd zodat tray én instellingen exact dezelfde functie aanroepen. Tests:
`tests/tray-controller.test.ts` (+ uitbreidingen in `notification-policy` / `prefs-store`). Nog te doen:
Windows-smoke-test van het echte tray-menu (in WSLg niet te draaien).

Drie items (uit scoping):

1. **Check for updates** in de tray — hergebruik bestaande `UPDATE_CHECK`-flow + `lastUpdateStatus` als label.
2. **Tijdelijk dempen (10/30/60 min)** — voeg `dndUntil?: number` (epoch ms) toe aan `NotificationPrefs`
   (naast `dnd`). In `notificationsAllowed`: `if (dndUntil && now.getTime() < dndUntil) return false;`.
   Zelf-herstellend via de bestaande 60s `refreshNotifyAllowed`-tick (verlopen `dndUntil` opruimen +
   `pushPrefs()`). Nieuw IPC `SET_SNOOZE` (minuten of null = "tot ik het weer aanzet" → `dnd=true`).
   `PrefsStore.getAll()` moet `dndUntil` net zo defensief inlezen als `dnd`.
3. **Autostart-toggle** in de tray — hergebruik `SET_AUTO_START` / `app.setLoginItemSettings`.
- **Kern-refactor:** `createTray` bouwt het menu nu **één keer statisch**. Maak er
  `buildTrayMenu(state)` + `updateTrayMenu(tray, state)` van, en roep `updateTrayMenu` aan na elke
  state-wijziging (snooze, autostart, update-status). `shouldHideOnClose` ongemoeid laten.
- **Open keuzes (brainstorm):** "off/until I turn back on" = hergebruik `dnd` bool of apart? Snooze
  ook in Settings-UI met afteller? Autostart-checkbox `prefs.autoStart` vertrouwen of
  `app.getLoginItemSettings()` live lezen?
- Volledige scoping stond in `.superpowers/sdd/scoping-tray-menu.md` (gitignored scratch).

## Kleinere wens
- **Meldingsknop duidelijker** in Instellingen (per-account Mail/Agenda-toggles). Deels gedaan
  (labels toegevoegd); evt. nog visueel verduidelijken.

## Handige commando's
```bash
npm run build      # renderer (next) + main (esbuild)
npx tsc --noEmit                       # typecheck main
npx tsc --noEmit -p renderer/tsconfig.json  # typecheck renderer
npx vitest run     # unit tests (76 nu)
git push origin v0.1.8                 # → CI bouwt + publiceert de release
gh workflow run build.yml --ref master # → testbare .exe als artefact (geen release)
```

## Repo-/proces-notities
- **CI:** `release.yml` triggert op tag-push (`v*`) → bouwt Windows-`.exe` + publiceert release.
  `build.yml` = handmatig (`workflow_dispatch`), `--publish never`, uploadt de `.exe` als artefact
  (geen release). Er is **geen** CI die op elke master-push bouwt.
- **Versie:** bump in `package.json`, changelog in `CHANGELOG.md`, dan tag `vX.Y.Z` pushen.
- **Let op parallelle sessies:** op 7 juli veranderde `origin/master` onder de sessie door (0.1.7 kwam via
  een andere sessie/PR). Vóór pushen altijd `git fetch` + controleren dat je een fast-forward bent.
- Meldingen (mail én agenda) lopen via onderschepping van `window.Notification` in `electron/preload.ts`
  (géén API, géén DOM-scraping). Ongelezen-badge = tab-titel; accountdetectie = `a[aria-label]` + e-mail-regex.
