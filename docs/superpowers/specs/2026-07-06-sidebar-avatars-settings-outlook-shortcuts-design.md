# Ontwerp: Zijbalk-avatars, instellingen-paneel & Outlook-sneltoetsen

**Datum:** 2026-07-06
**Status:** Goedgekeurd ontwerp (klaar voor implementatieplan)
**Bouwt voort op:** de bestaande Gmail-desktop-wrapper (Electron + Next.js) op `master`.

## Doel

Drie uitbreidingen op de bestaande wrapper:

1. **Echte profiel-avatars + auto-labels** in de zijbalk (nu een gekleurde letter).
2. **Instellingen-paneel** achter de ⚙-knop (die nu niets doet): accounts hernoemen/kleuren/verwijderen + Outlook-sneltoetsen aan/uit.
3. **Outlook-sneltoetsen** (klassiek Outlook voor Windows) die binnen Gmail werken, zo volledig als zinvol mapbaar is.

## Kernprincipes (ongewijzigd t.o.v. de bestaande app)

- TypeScript strict; pure, Electron-vrije logica in aparte modules met Vitest-tests; Electron-bedrading dun eromheen.
- Account-views draaien op `contextIsolation: false` (alleen vertrouwd `mail.google.com`); de zijbalk op `contextIsolation: true` met de `window.desktop`-bridge.

---

## Feature 1 — Profiel-avatars & identiteit

**Data flow:** het preload-script (`electron/preload.ts`, draait in elke Gmail-view) leest na laden de ingelogde identiteit uit de Gmail-DOM en stuurt die via een nieuw IPC-kanaal naar main.

- **Bron in de DOM:** de account-knop rechtsboven — `a[aria-label^="Google Account"]`. De `aria-label` bevat naam + e-mail (regex: e-mail = eerste match op `\S+@\S+`); de avatar-URL komt uit de `img` daarin (`img[src*="googleusercontent"]`).
- **Robuustheid:** poll elke 1s, max 15 pogingen, tot het element bestaat; stop zodra gevonden. Herhaal bij navigatie (Gmail is een SPA) via de bestaande title-observer als trigger. Bij niets gevonden: geen identiteit sturen (zijbalk houdt de letter-fallback).
- **IPC:** `ACCOUNT_IDENTITY` (view → main) met `{ email: string; name: string; avatarUrl: string }`. Main mapt sender → accountId (via bestaande `accountIdForWebContents`) en werkt de store bij.

**Opslag:** `Account` in `accounts-store.ts` krijgt optionele velden `email?`, `name?`, `avatarUrl?`. Nieuwe methode `update(id, patch: Partial<Pick<Account,'label'|'color'|'email'|'name'|'avatarUrl'>>): Account | null`. Bij binnenkomende identiteit: als `label` nog de default is, wordt het e-mailadres het label.

**Weergave:** `renderer/app/page.tsx` toont `<img src={avatarUrl} referrerPolicy="no-referrer">` in de accountknop wanneer `avatarUrl` aanwezig is, anders de bestaande gekleurde letter. Tooltip = `email` (val terug op `label`). De googleusercontent-URL's zijn publiek, dus de aparte zijbalk-sessie laadt ze zonder auth.

---

## Feature 2 — Instellingen-paneel

**Mechanisme:** de renderer tekent altijd de 64px-zijbalk; de actieve Gmail-view ligt daar rechts overheen. Bij het openen van settings verbergt main de actieve view (`setVisible(false)`), waardoor de renderer-ruimte rechts vrijkomt; de renderer toont daar het settings-paneel. Sluiten = view weer tonen (`show(activeId)`).

- **IPC:** `SETTINGS_TOGGLE` (renderer → main) met `{ open: boolean }`; main verbergt/toont de actieve view. Bij `open:true` zonder actieve view (0 accounts) toont de renderer het paneel sowieso.
- **Paneel-inhoud** (renderer-component `SettingsPanel`):
  - Lijst van accounts, elk met: **naam/label bewerken** (tekstveld), **kleur** (kleurkiezer/preset-swatches), **verwijderen** (met bevestiging).
  - Globale schakelaar **"Outlook-sneltoetsen"** (aan/uit).
  - Statische hint: "Zet Gmail-sneltoetsen aan (Instellingen → Alles bekijken → Sneltoetsen) zodat de Outlook-toetsen werken."
- **IPC voor bewerken:** `ACCOUNTS_UPDATE` (renderer → main, invoke) met `(id, { label?, color? })` → roept `store.update` → `pushAccounts`. Verwijderen gebruikt het bestaande `ACCOUNTS_REMOVE`.

**Instellingen-opslag:** nieuwe pure module `electron/settings-store.ts` (zelfde patroon als `accounts-store.ts`), JSON in `userData/settings.json`, met `{ outlookShortcuts: boolean }` (default `true`). Methoden: `get(): Settings`, `set(patch: Partial<Settings>): Settings`. IPC: `SETTINGS_GET` (invoke) en `SETTINGS_SET` (invoke). Wanneer `outlookShortcuts` wijzigt, past main de interceptie live aan (zie Feature 3).

---

## Feature 3 — Outlook-sneltoetsen → Gmail

### Interceptiemodel

Onderscheppen gebeurt in de **main-process** op elke Gmail-view via `view.webContents.on('before-input-event', handler)` — niet in de renderer, want Chromium vangt combo's als Ctrl+R/Ctrl+F af vóór de pagina ze ziet.

1. Alleen `type === 'keyDown'` verwerken.
2. `editableFocused` bepalen uit preload-state (kanaal `EDITABLE_FOCUS`, view → main, boolean; het preload luistert op `focusin`/`focusout` en meldt of het actieve element een `input`/`textarea`/`[contenteditable]` is).
3. `mapKey(input, editableFocused, platform)` (pure functie) → `{ preventDefault: boolean; inject: InjectKey[] | null }`.
4. Bij `preventDefault`: `event.preventDefault()`. Bij `inject`: voor elke `InjectKey` een `sendInputEvent` keyDown+keyUp met de gemapte toets/modifiers (dit telt als "trusted" input die Gmail's eigen handlers accepteren).

`InjectKey = { key: string; shift?: boolean; mod?: boolean }` waarbij `mod` → `Control` op Windows/Linux en `Meta` op macOS. Sequenties (bijv. `g i`) zijn een array van meerdere `InjectKey`s die achter elkaar worden gestuurd. Injectie van kale letters triggert géén nieuwe interceptie (die letters staan niet in de Outlook-tabel), dus geen loop.

**Vereiste:** Gmail-sneltoetsen moeten aanstaan (server-side setting die wij niet kunnen zetten) — het settings-paneel wijst de gebruiker hierop.

**Aan/uit:** de hele interceptie hangt aan `settings.outlookShortcuts`. Bij uit: handler doet niets (alle toetsen normaal). Live omschakelbaar vanuit het paneel.

### Menu-hardening

Electron's standaardmenu bindt accelerators (Ctrl+R reload, Ctrl+W tab/venster sluiten, Ctrl+Shift+I DevTools, Ctrl+N nieuw venster, Ctrl+1-9 tabs) die onze mappings zouden overrulen. Nieuwe module `electron/menu.ts` bouwt een **minimaal** applicatiemenu (alleen essentieel: kopiëren/plakken/knippen/alles selecteren voor tekstvelden, en Afsluiten) en zet het via `Menu.setApplicationMenu(...)`. Gevolg: standaard browser-sneltoetsen (reload/find/nieuw venster) zijn niet meer beschikbaar — dat is gewenst voor een mailclient. DevTools blijft bereikbaar via een niet-conflicterende toets (**F12**, dev-only), zodat debuggen kan.

### Contexten

Dezelfde Outlook-toets betekent iets anders bij opstellen dan in de lijst. De mapper kiest op `editableFocused`:

- `editableFocused = false` → **lijst/lezen-tabel** (Tabel A).
- `editableFocused = true` → **opstellen/opmaak-tabel** (Tabel B).

### Tabel A — Lijst / lezen (geen tekstveld actief)

| Actie | Outlook | Gmail-injectie |
|---|---|---|
| Nieuw bericht | Ctrl+Shift+M | `c` |
| Nieuw bericht | Ctrl+N | `c` |
| Beantwoorden | Ctrl+R | `r` |
| Allen beantwoorden | Ctrl+Shift+R | `a` |
| Doorsturen | Ctrl+F | `f` |
| Openen | Ctrl+O | `o` |
| Verwijderen | Delete | `#` (Shift+3) |
| Archiveren | Backspace | `e` |
| Markeer gelezen | Ctrl+Q | Shift+`i` |
| Markeer ongelezen | Ctrl+U | Shift+`u` |
| Ster/vlag | Insert | `s` |
| Verplaatsen naar (label) | Ctrl+Shift+V | `v` |
| Dempen (delete & ignore) | Ctrl+Shift+D | `m` |
| Ongedaan maken | Ctrl+Z | `z` |
| Alles selecteren | Ctrl+A | `*` dan `a` |
| Item (de)selecteren | Ctrl+Spatie | `x` |
| Zoeken | Ctrl+E | `/` |
| Zoeken | F3 | `/` |
| Naar Postvak IN | Ctrl+Shift+I | `g` dan `i` |
| Naar Postvak IN (Mail-module) | Ctrl+1 | `g` dan `i` |
| Volgende in lijst | ↓ (Down) | `j` |
| Vorige in lijst | ↑ (Up) | `k` |
| Volgend bericht in thread | Ctrl+. | `n` |
| Vorig bericht in thread | Ctrl+, | `p` |
| Spam melden | (geen chord in Outlook) | *niet gemapt* |

> **Kanttekening ↑/↓:** dit is de meest ingrijpende mapping — je kunt een lange e-mail dan niet met pijltjes scrollen (gebruik muis/PageUp/PageDown/spatie). Het hoort bij de Outlook-set en zit erin; via de globale schakelaar uit te zetten.

### Tabel B — Opstellen (tekstveld/compose actief)

| Actie | Outlook | Gmail-injectie | Opmerking |
|---|---|---|---|
| Verzenden | Ctrl+Enter | — (native) | niet onderscheppen; werkt al |
| Verzenden | Alt+S | `mod`+Enter | |
| Vet | Ctrl+B | — (native) | identiek in Gmail; niet onderscheppen |
| Cursief | Ctrl+I | — (native) | idem |
| Onderstrepen | Ctrl+U | — (native) | idem (in compose = onderstrepen, niet ongelezen) |
| Hyperlink | Ctrl+K | — (native) | identiek |
| Opsomming | Ctrl+Shift+L | `mod`+Shift+`8` | |
| Inspringen meer | Ctrl+T | `mod`+`]` | |
| Inspringen minder | Ctrl+Shift+T | `mod`+`[` | |
| Links uitlijnen | Ctrl+L | `mod`+Shift+`l` | |
| Centreren | Ctrl+E | `mod`+Shift+`e` | |
| Rechts uitlijnen | Ctrl+R | `mod`+Shift+`r` | |
| Opmaak wissen | Ctrl+Spatie | `mod`+`\` | |
| Concept weggooien | Ctrl+Shift+D | `mod`+Shift+`d` | |

### Tabel C — Doorlopen (niet onderschept, voor volledigheid)

Deze Outlook-toetsen worden bewust **niet** onderschept omdat ze óf al identiek werken in Gmail, óf geen Gmail-doel hebben in een mail-only wrapper. Ze vallen normaal door naar Gmail/Chromium:

- **Al identiek (compose):** Ctrl+B, Ctrl+I, Ctrl+U (compose), Ctrl+K, Ctrl+Enter.
- **Geen equivalent (functie ontbreekt in Gmail-wrapper):** alle Agenda/Contacten/Taken/Notities-toetsen (Ctrl+Shift+A/Q/C/K/N/X/…), regels, kleurcategorieën, mappen aanmaken/favorieten, recall, "check names", spelling (F7), afdrukken (Ctrl+P → browser/Gmail), handmatig verzenden/ontvangen (Ctrl+M/F9), definitief verwijderen (Shift+Delete), kopiëren naar map (Ctrl+Shift+Y), niet-junk (Ctrl+Alt+J), doorsturen als bijlage (Ctrl+Alt+F), adresboek (Ctrl+Shift+B), zoekmap/geavanceerd zoeken (Ctrl+Shift+P/F).

---

## Componenten & bestanden

**Nieuw (pure, getest):**
- `electron/outlook-shortcuts.ts` — `InjectKey`-type, de mappingtabellen (A/B), en `mapKey(input, editableFocused, platform): { preventDefault, inject }`. Unit-tests dekken: lijst-mappings, compose-mappings, context-omschakeling, pass-through, platform-`mod`, sequenties.
- `electron/settings-store.ts` — `SettingsStore(filePath)` met `get`/`set`, `Settings { outlookShortcuts: boolean }`. Unit-tests (default, persist, patch).
- `electron/menu.ts` — `buildAppMenu()` → minimaal `Menu`; `installMenu()`.
- `renderer/app/SettingsPanel.tsx` (of inline in `page.tsx`) — het paneel.

**Uitgebreid:**
- `electron/ipc.ts` — kanalen: `ACCOUNT_IDENTITY`, `EDITABLE_FOCUS`, `ACCOUNTS_UPDATE`, `SETTINGS_TOGGLE`, `SETTINGS_GET`, `SETTINGS_SET`. (Identiteit-updates rijden mee op het bestaande `ACCOUNTS_CHANGED`: de account-objecten dragen nu `email/name/avatarUrl`, dus een apart kanaal is niet nodig.)
- `electron/accounts-store.ts` — velden `email/name/avatarUrl` + `update()`.
- `electron/preload.ts` — identiteit-scrape (poll + regex) en editable-focus-tracking.
- `electron/account-view-manager.ts` — `before-input-event`-wiring per view (roept `mapKey`, respecteert `settings.outlookShortcuts` en `editableFocused`-state per account), forward van `ACCOUNT_IDENTITY`/`EDITABLE_FOCUS`, en helpers voor settings-hide/show.
- `electron/main.ts` — nieuwe IPC-handlers, `SettingsStore`-init, `installMenu()`, identiteit → store → `pushAccounts`.
- `renderer/sidebar-preload.ts` — bridge-methoden: `updateAccount(id, patch)`, `toggleSettings(open)`, `getSettings()`, `setSettings(patch)`.
- `renderer/app/page.tsx` — avatar-`<img>` met letter-fallback, ⚙ opent `SettingsPanel`, bedrading naar de nieuwe bridge-methoden.

## Testbaarheid

- Zwaartepunt in de pure mapper (`outlook-shortcuts.ts`) en `settings-store.ts`/`accounts-store.update` → Vitest, Electron-vrij.
- Electron-bedrading (before-input-event, sendInputEvent, view hide/show, menu) blijft dun en wordt handmatig geverifieerd; GUI-runtime is in deze WSL2-sandbox niet te draaien (bekende omgevingslimiet) — verificatie via build + typecheck + unit-tests.

## Bewust buiten scope (YAGNI)

Per-shortcut individueel aan/uit (alleen globale toggle), het automatisch server-side aanzetten van Gmail-sneltoetsen, mapping van niet-mail Outlook-modules, en configureerbare eigen keymaps.
