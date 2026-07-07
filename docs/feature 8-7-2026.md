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

### Direct af te maken: 0.1.8 releasen
1. **Smoke-test op Windows** (kon niet in WSL): melding-klik in-app vs nieuw venster, klik terwijl
   geminimaliseerd → venster komt terug, externe links → browser (moet nog werken).
2. Als goed → **release**: `git push origin v0.1.8` → CI (`.github/workflows/release.yml`) bouwt de
   `.exe` en publiceert de GitHub-release + `latest.yml` (auto-update).
   - Let op: de lokale tag `v0.1.8` staat al op commit `92caab4`. Als er ná die commit nog wijzigingen
     komen vóór release, eerst de tag verplaatsen (`git tag -d v0.1.8 && git tag -a v0.1.8 -m ...`).

## Openstaande bug (belangrijk): agenda-herinneringen vuren niet af

- **Symptoom:** mail-meldingen werken; **agenda-herinneringen komen niet** (op de achtergrond).
- **Wat al uitgesloten is:** DND uit, stille uren uit, per-account Mail-toggle aan. De config-desync
  (per-account toggle toonde verkeerde stand) is al gefixt in 0.1.6 (`pushPrefs()` in `SET_ACCOUNT_PREF`).
- **Hypothese (nog te bevestigen):** de agenda-view draait altijd **verborgen**; Chromium kan die als
  "hidden" behandelen waardoor Google Agenda z'n `window.Notification` niet afvuurt — óf Google Agenda's
  eigen bureaubladmelding staat uit / de afspraak heeft geen "Melding"-herinnering.
- **Volgende stap (isolatietest, nog niet gedaan):**
  1. Bevestig `"calendarNotify": true` in `%APPDATA%\gmail-desktop\prefs.json` voor het account.
  2. In Google Agenda: Instellingen → Instellingen voor gebeurtenissen → Meldingen = **"Bureaubladmeldingen"**;
     testafspraak met een **"Melding"**-herinnering ~2–5 min vooruit.
  3. Klik de **agenda-knop** zodat de agenda zichtbaar/actief is en laat 'm open tot de herinneringstijd.
  4. Komt de melding **wel** als zichtbaar maar **niet** als verborgen → dan is de "verborgen achtergrond-view"-aanpak
     de oorzaak. Mogelijke oplossingen: agenda-view niet echt `setVisible(false)` maar off-screen houden,
     of een andere bron (Calendar API met OAuth — zwaarder). Opnieuw scopen via brainstorm.
- **Relevante code:** `syncCalendarViews()` in `main.ts`, `backgroundThrottling` in
  `profile-view-manager.ts:ensureView`, `notificationsAllowed(..., 'calendar')` in `notification-policy.ts`.

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

## Backlog-feature B: Tray-menu-uitbreidingen

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
