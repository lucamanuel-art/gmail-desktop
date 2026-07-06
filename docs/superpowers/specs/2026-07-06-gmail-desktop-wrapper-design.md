# Ontwerp: Gmail Desktop Wrapper

**Datum:** 2026-07-06
**Status:** Goedgekeurd ontwerp (klaar voor implementatieplan)

## Doel

Een cross-platform desktop-app (Linux, Windows, macOS) die de echte Gmail-webinterface
in geïsoleerde sessies laadt en aanvoelt als een native app: eigen venster + icoon,
desktop-notificaties, ongelezen-badge, system-tray met achtergronddraaien, en een smalle
zijbalk om tussen meerdere Google-accounts te wisselen.

Geen eigen mailclient — Gmail zelf blijft de interface. Deze app is een **wrapper**.

## Aanpak & keuzes

| Beslissing        | Keuze                          | Reden |
|-------------------|--------------------------------|-------|
| Type              | Wrapper (geen eigen client)    | 90% native-gevoel, fractie van de moeite, altijd up-to-date |
| Framework         | Electron                       | Bundelt Chromium; Google's login accepteert dit altijd (webviews worden soms geweigerd) |
| Platforms         | Linux, Windows, macOS          | Eén codebase, packaging per platform via electron-builder |
| Renderer-chrome   | Next.js (static export) + TS + Tailwind | Vertrouwde stack; static export omdat Electron van bestandssysteem laadt, geen Node-server |
| Multi-account     | Geïsoleerde sessies + zijbalk  | Echt gescheiden logins per account, eigen ongelezen-teller (Rambox-model) |

## Layout

```
┌──┬───────────────────────────────────────┐
│▓▓│  ← actieve account: mail.google.com    │
│  │     (WebContentsView, volledige Gmail) │
│●3│                                         │
│  │                                         │
│○ │                                         │
│  │                                         │
│+ │  ← account toevoegen                    │
│⚙ │  ← instellingen                         │
└──┴───────────────────────────────────────┘
 ↑ zijbalk (~64px, Next.js): één knop per account met ongelezen-teller-badge
```

## Architectuur

- **Main process** — vensterbeheer, tray, app-lifecycle, accounts-config, IPC-router.
- **Chrome-renderer (Next.js static export)** — tekent alleen de zijbalk + instellingen-scherm.
  Bevat géén Gmail. Wordt via `file://` geladen.
- **Eén `WebContentsView` per account** — elk met een eigen persistente sessie-partitie
  (`persist:account-<id>`), dus volledig gescheiden cookies/logins. Bij wisselen brengen we
  de juiste view naar voren; de zijbalk-breedte wordt van de view-bounds afgetrokken.
- **Preload-script** (in elke Gmail-view) — leest het ongelezen-aantal, routeert notificaties,
  en communiceert via IPC met de main process. Raakt Gmail's eigen code niet aan; leest mee.

## Hoe de features werken

- **Ongelezen-teller** — Gmail zet het aantal in de document-titel (`Inbox (12) - …`).
  Het preload-script leest die titel en meldt het aantal per account via IPC.
- **Badge op app-icoon** — som over alle accounts. `app.setBadgeCount()` op macOS/Linux;
  op Windows geen numerieke badge → overlay-icoon via `win.setOverlayIcon()`.
- **Zijbalk-badges** — per account een klein cijfer op de knop (state in chrome-renderer,
  gevoed door IPC vanuit main).
- **Notificaties** — Gmail's eigen HTML5-notificaties worden door Electron native getoond.
  Het preload wrapt `Notification` zodat een klik het venster opent én naar het juiste
  account springt.
- **Tray + achtergrond** — tray-icoon met "Openen"/"Afsluiten". Venster sluiten verbergt naar
  tray i.p.v. afsluiten (behalve echt afsluiten via tray-menu of macOS-quit). Notificaties
  blijven werken terwijl het venster verborgen is.
- **Meerdere accounts** — accountlijst (`id`, `label`, `color`) in een JSON-config in de
  userData-map. Toevoegen = nieuwe geïsoleerde sessie + nieuwe knop. Verwijderen wist de sessie.

## Componenten (units met één duidelijke taak)

1. **`unread-parser`** — pure functie: document-titel → ongelezen-aantal (of null). Geen Electron.
2. **`accounts-store`** — CRUD op de accounts-config (JSON in userData). Geen Electron-UI.
3. **`account-view-manager`** (main) — maakt/toont/verbergt `WebContentsView`s, beheert sessies,
   berekent bounds t.o.v. zijbalk.
4. **`tray-controller`** (main) — tray-icoon, menu, verberg/toon-gedrag.
5. **`badge-controller`** (main) — aggregeert per-account tellers → app-badge / overlay-icoon.
6. **`preload`** — titel-observer + notificatie-wrapper + IPC-brug.
7. **Chrome-UI** (Next.js) — zijbalk-component, instellingen-scherm.

## Testbaarheid (TDD)

- `unread-parser` en `accounts-store` zijn pure, Electron-vrije modules → unit-tests met Vitest.
- De Electron-bedrading blijft dun bovenop die geteste modules.
- Optioneel later: lichte end-to-end rooktest met Playwright-for-Electron.

## Packaging

electron-builder → AppImage/deb (Linux), NSIS (Windows), dmg (macOS).

## Bewust buiten scope (YAGNI)

Auto-updates, `mailto:`-handler (standaard-mailapp worden), globale sneltoetsen, offline-opslag.
Later toe te voegen indien gemist.

## Open naamkeuze

Werktitel: **Gmail Desktop**. Definitieve naam nog te bepalen (beïnvloedt app-id en packaging-metadata).
