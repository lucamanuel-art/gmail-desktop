# Bouwopdracht: "Gmail Desktop" — een native desktop-wrapper rond Gmail

Bouw een cross-platform desktop-app (Linux, Windows, macOS) die de **echte
Gmail-webinterface** in geïsoleerde vensters laadt en aanvoelt als een native
app. Het is nadrukkelijk **geen eigen mailclient**: Gmail zelf blijft de UI. Wij
bouwen een schil eromheen met een accountzijbalk, desktop-notificaties, een
ongelezen-badge op het app-icoon, een system-tray die de app op de achtergrond
laat draaien, en automatische detectie van alle Google-accounts waarmee je bent
ingelogd — plus Google Agenda per account.

Werk volgens TDD waar de logica puur is, en houd de Electron-bedrading dun
bovenop geteste modules. Lees eerst de hele opdracht; bouw daarna incrementeel.

---

## 1. Techniekkeuzes (niet onderhandelbaar, met reden)

| Beslissing | Keuze | Reden |
|---|---|---|
| Type | Wrapper rond Gmails web-UI | 90% native-gevoel, fractie van de moeite, altijd up-to-date |
| Framework | **Electron** (v31+) | Bundelt Chromium; Google's login accepteert Electron altijd — losse `<webview>`/BrowserView-embeds worden soms geweigerd |
| Taal | **TypeScript strict** overal | |
| Zijbalk-UI | **Next.js 14 (static export) + React 18 + Tailwind 3** | Vertrouwde stack; `output: 'export'` want Electron laadt van bestandssysteem, geen Node-server |
| Main-bundeling | **esbuild** (bundle → CJS, target node22, `--external:electron`) | |
| Tests | **Vitest** (node-omgeving) | |
| Packaging | **electron-builder** | AppImage+deb (Linux), NSIS (Windows), dmg (macOS) |
| Node/npm | Node >= 22, npm >= 10 | |

**Architectuurprincipe:** pure, Electron-vrije logica in losse modules met
unit-tests; de Electron-laag (vensters, views, IPC, tray) is een dunne bedrading
daaromheen. De GUI-runtime is meestal niet in de dev-sandbox te draaien →
verifieer met build + typecheck + unit-tests, en rooktest handmatig op een echte
desktop.

---

## 2. Procesmodel & architectuur

Drie soorten processen/contexten:

1. **Main process** — bezit het venster, de tray, de app-lifecycle, de
   accountdetectie, de kleuren-store en de IPC-router.
2. **Zijbalk-renderer (Next.js static export)** — tekent **alleen** de smalle
   64px-chrome links (avatars + agenda-icoon + detecteer-knop + instellingen) en
   het instellingen-paneel. Bevat géén Gmail. Draait met
   `contextIsolation: true` en praat met main via een `window.desktop`-bridge
   (contextBridge in een sidebar-preload).
3. **Eén `WebContentsView` per (account × oppervlak)** — de echte Gmail/Agenda,
   rechts naast de zijbalk. Draait met `contextIsolation: false` (alleen
   vertrouwde Google-domeinen) zodat het per-view preload de `Notification`-API
   kan wrappen. Elke view krijgt hetzelfde per-view preload geïnjecteerd.

Layout: de zijbalk is vast **64px** breed; de actieve view vult de rest
(`x:64, y:0, width:winW-64, height:winH`). Bij venster-resize herbereken je de
bounds van de actieve view. Instellingen openen = actieve view verbergen zodat
de renderer-ruimte rechts vrijkomt voor het paneel; sluiten = view weer tonen.

```
┌──┬───────────────────────────────────────┐
│(A)│  ← actieve view: mail.google.com/u/N   │
│📅 │     of calendar.google.com/u/N         │
│(B)│     (WebContentsView, volledige Gmail) │
│📅 │                                         │
│+  │  ← "Accounts opnieuw detecteren"        │
│⚙ │  ← instellingen                         │
└──┴───────────────────────────────────────┘
 ↑ zijbalk 64px (Next.js): avatar per account + agenda-icoontje eronder
```

---

## 3. Sessie- & profielmodel (de kern)

- **Eén gedeelde persistente sessie** voor álle views: partitie
  `persist:google`. Google's eigen multi-login beheert de accounts binnen die
  sessie (net als in een browser waar je meerdere Google-accounts hebt).
- Een **profiel** is **afgeleide, niet-persistente** data:
  `{ index: number; email: string; name: string; avatarUrl: string; color: string }`.
  Bij elke start opnieuw gedetecteerd (de login blijft in de sessie bewaard).
  `index` = Google's authuser-index uit de URL (`/u/N/`).
- **URL's** (pure, testbare functies):
  - `mailUrl(index)    = https://mail.google.com/mail/u/${index}/`
  - `calendarUrl(index)= https://calendar.google.com/calendar/u/${index}/r`
- **Kleur** wordt afgeleid uit een vaste palette op `index`, optioneel
  overschreven per e-mail. Palette:
  `['#4285F4','#EA4335','#34A853','#FBBC05','#A142F4','#00ACC1']`,
  `colorForIndex(i) = PALETTE[i % PALETTE.length]`. Overrides in een klein
  JSON-bestand `colors.json` in userData (`email → color`).

---

## 4. Auto-detectie van accounts (het lastigste onderdeel)

De detectie leunt volledig op het **uit de Gmail-pagina scrapen van de
ingelogde identiteit**. Bouw en verifieer dat mechanisme éérst — de rest hangt
eraan.

### 4a. Identiteit scrapen (in het per-view preload, locale-onafhankelijk!)

De account-knop rechtsboven in Gmail is een `<a>` met een `aria-label` die het
e-mailadres bevat en die de avatar-`<img>` omvat.

> **Kritieke valkuil:** match **niet** op Engelse UI-tekst zoals
> `aria-label^="Google Account"` — Gmail draait in de taal van de gebruiker
> (bv. Nederlands). Selecteer taal-onafhankelijk: pak alle `a[aria-label]`, en
> kies de eerste waarvan de `aria-label` een e-mailpatroon (`/@[^\s@]+\.[^\s@]+/`)
> bevat **én** een `<img>` binnenin heeft.

Uit die anchor:
- `email` = eerste match op `/[^\s()]+@[^\s()]+\.[^\s()]+/` in de label.
- `name`  = label met leidend `"Xxx: "`-prefix gestript en trailing `"(email)"`
  weggehaald.
- `avatarUrl` = `src` van de `<img>` (googleusercontent-URL; publiek laadbaar,
  dus de zijbalk-sessie toont 'm zonder auth — gebruik `referrerPolicy="no-referrer"`).

Poll elke 1s, max 15 pogingen, tot gevonden; stuur dan via IPC en stop de
poll. Herhaal ook periodiek want Gmail is een SPA en vervangt de titel/DOM.
Vind je niets: stuur niets (de zijbalk valt terug op een gekleurde letter).

Maak deze scrape-functie een **pure functie** `extractIdentity(doc)` die alleen
een `querySelectorAll`-achtig object nodig heeft, zodat je 'm zonder Electron
kunt unit-testen met verschillende (ook niet-Engelse) aria-labels.

### 4b. Het detectie-beslismodel (pure functie, getest)

`planNext(seenEmails: string[], index: number, identity: {email}|null, maxAccounts=10): { register: boolean; stop: boolean }`

- Geen identiteit / geen e-mail → `{ register:false, stop:true }`.
- E-mail al eerder gezien → `{ register:false, stop:true }`
  (Google stuurt een ongeldige `/u/N/` stiekem terug naar account 0; herhaling
  is dus de betrouwbare stopconditie — authuser-indexen zijn aaneengesloten).
- Anders → `{ register:true, stop: index+1 >= maxAccounts }` (harde cap 10).

### 4c. De detectie-driver (main process)

1. **Profiel 0**: toon een **zichtbare** Mail-view op `mailUrl(0)`. Nog niet
   ingelogd → Google-login verschijnt; gebruiker logt in. Zodra identiteit(0)
   binnenkomt → registreer profiel 0.
2. **Probe index 1, 2, …** met een **verborgen** Mail-view op `mailUrl(N)`:
   - Nieuw e-mailadres → registreer profiel N (de probe-view wordt de Mail-view
     van dat profiel).
   - Al gezien / geen identiteit binnen de timeout → discard de view en **stop**.
3. Timeout voor een probe: **~16s** (ruimer dan het ~15s identity-poll-venster,
   zodat trage accounts niet gemist worden).

> **Valkuils die je moet inbouwen (anders lekken views of hangt detectie):**
> - **Discard index 0 nooit automatisch.** Het is de zichtbare primaire/login-
>   view en mag willekeurig lang duren. Alleen forward-probes (index ≥ 1)
>   krijgen de discard-timeout.
> - **Negeer opnieuw-afgevuurde identiteit** voor een al-geregistreerde index.
>   Gmails SPA draait de identity-poll opnieuw bij volledige navigaties; zonder
>   guard breekt dat een lopende probe-timer af en laat het views lekken/
>   spuriously doorschieten. (`if profiles.some(p=>p.index===index) return;`)
> - **Re-detect** (via de "+"-knop) ruimt een nog lopende probe-view op en
>   herstart de probe vanaf `max(bestaande index)+1`, zodat herhaald
>   re-detecten geen verweesde verborgen views achterlaat.

---

## 5. Views: `ProfileViewManager`

Beheert per `(index, surface)` een `WebContentsView` in `persist:google`.

- `ensureView(index, surface, visible)` — maakt de view lui aan als die nog niet
  bestaat, laadt `mailUrl`/`calendarUrl`, hangt 'm in de contentView, verbergt
  'm; toont indien `visible`. **Alleen Mail-views** krijgen de IPC-listener voor
  ongelezen-teller / notificatie-activatie / identiteit — Agenda-views niet.
- `show(index, surface)` — zorgt dat de view bestaat, verbergt alle andere views,
  toont deze, zet bounds. Agenda-view wordt dus **lui** bij eerste gebruik
  aangemaakt (geheugen).
- `discardView`, `hideAll`, `showActive`, `relayout` (op venster-resize).

---

## 6. Features & hoe ze werken

- **Ongelezen-teller** — Gmail zet het aantal in de document-titel
  (`Inbox (12) - …`). Pure `parseUnreadCount(title)` pakt `\((\d+)\)` → getal,
  anders 0. Het preload leest de titel (MutationObserver op `<title>` +
  fallback-interval van 5s) en meldt per view via IPC.
- **App-icoon-badge** — som over alle accounts (`totalUnread(counts)`), gezet via
  `app.setBadgeCount(n)`. (Op Windows heeft dat geen numerieke badge; een
  overlay-icoon via `win.setOverlayIcon()` mag later.)
- **Zijbalk-badges** — klein rood cijfer op de avatarknop per account, gevoed
  door de per-index unread-counts uit main.
- **Notificaties** — Gmails eigen HTML5-notificaties toont Electron native. Het
  preload wrapt `window.Notification` zó dat een **klik** het venster opent en
  naar het juiste account springt (IPC `NOTIFICATION_ACTIVATE`). Behoud
  `permission` en `requestPermission` van het origineel.
- **Tray + achtergrond** — tray-icoon met "Open" / "Quit". Venster sluiten
  **verbergt** naar tray i.p.v. afsluiten (`shouldHideOnClose` = `!isQuitting`);
  echt afsluiten alleen via tray-menu of platform-quit. `window-all-closed` doet
  niets (blijft draaien in tray). Notificaties blijven werken als 't venster weg is.
- **Google Agenda per profiel** — agenda-icoontje (📅) onder elke avatar wisselt
  die view naar `calendarUrl(index)`. Actief profiel + oppervlak visueel
  gemarkeerd (ring om avatar; agenda-icoon licht op als Agenda actief is).
- **Instellingen-paneel** (achter ⚙) — lijst van gedetecteerde accounts, elk met
  kleur-swatches (override per e-mail) + een "Re-detect accounts"-knop + een hint
  dat je extra accounts toevoegt via Gmails eigen accountwisselaar en dan
  opnieuw detecteert. Openen verbergt de actieve view; sluiten toont 'm weer.

---

## 7. IPC-contract (exact deze kanalen)

```
// Gmail-view (preload) -> main
UNREAD_UPDATE        'unread:update'         send(count:number)
NOTIFICATION_ACTIVATE'notification:activate' send()
ACCOUNT_IDENTITY     'account:identity'      send({email,name,avatarUrl})

// zijbalk-renderer -> main
SWITCH_SURFACE       'switch:surface'        send({index, surface:'mail'|'calendar'})
REDETECT             'accounts:redetect'     send()
SET_COLOR            'color:set'             send({email, color})
SETTINGS_TOGGLE      'settings:toggle'       send({open:boolean})

// main -> zijbalk-renderer
PROFILES_CHANGED     'profiles:changed'      Profile[]
UNREAD_CHANGED       'unread:changed'        Record<index, number>
SETTINGS_FORCE_CLOSE 'settings:force-close'
```

De sidebar-preload exposeert via `contextBridge` een `window.desktop` met:
`onProfilesChanged`, `onUnreadChanged`, `switchSurface`, `redetect`, `setColor`,
`toggleSettings`, `onSettingsForceClose`. Herduw `PROFILES_CHANGED` op elke
renderer-(re)load zodat de zijbalk zich herbevolkt. Bij een notificatie-klik of
account-activatie: toon het venster, sluit een eventueel open instellingen-paneel
(`SETTINGS_FORCE_CLOSE`), en switch naar die Mail-view. De renderer houdt de
actieve selectie geldig: verdwijnt het actieve profiel, val terug op het eerste.

---

## 8. Bestandsstructuur (richtlijn)

```
electron/                (main + preloads, esbuild → dist-electron/)
  main.ts                app-lifecycle, venster, tray, detectie-driver, IPC-router
  profile-view-manager.ts view-lifecycle per (index,surface)
  detection-planner.ts   planNext() — puur
  google-urls.ts         mailUrl/calendarUrl — puur
  palette.ts             PALETTE + colorForIndex — puur
  color-store.ts         email→color JSON-persist
  unread-parser.ts       parseUnreadCount — puur
  badge-math.ts          totalUnread — puur
  badge-controller.ts    applyBadge(counts, setBadge)
  layout.ts              SIDEBAR_WIDTH + contentBounds — puur
  tray-controller.ts     shouldHideOnClose + createTray
  ipc.ts                 de IPC-constanten hierboven
  preload.ts             per-view: unread-report + Notification-wrap + extractIdentity + isEditableTarget
  sidebar-preload.ts     window.desktop-bridge
renderer/                (Next.js static export → renderer/out/)
  app/page.tsx           de zijbalk (avatars, 📅, +, ⚙)
  app/SettingsPanel.tsx  het instellingen-paneel
  app/layout.tsx, globals.css
  next.config.mjs        { output:'export', images:{unoptimized:true} }
tests/                   Vitest, één test per pure module
run-dev.sh               one-command dev-launcher (zie §10)
electron-builder.yml, tsconfig.json, vitest.config.ts, package.json
```

---

## 9. Testbaarheid (TDD)

Schrijf Vitest-tests (node-omgeving) vóór de implementatie voor elke pure
module: `unread-parser`, `badge-math`, `detection-planner` (registreer/stop,
e-mail-herhaling, cap), `google-urls`, `palette`, `color-store` (default/persist/
patch), `layout`, `tray-controller` (`shouldHideOnClose`), en de
`extractIdentity`/`isEditableTarget`-helpers uit het preload (met o.a. een
**niet-Engelse** aria-label als testcase). De Electron-bedrading blijft dun en
wordt handmatig gerookt op een echte desktop.

---

## 10. Build, dev & packaging

- `npm run build:renderer` → Next static export naar `renderer/out/`.
- `npm run build:main` → esbuild bundelt `main.ts`, `preload.ts`,
  `sidebar-preload.ts` → `dist-electron/` (CJS, node22, `--external:electron`).
- `npm run build` → beide. `npm start` → `electron .`.
- **In productie** laadt main de zijbalk via een geregistreerd, privileged
  `app://`-protocol dat uit `renderer/out/` serveert; **in dev** via
  `ELECTRON_RENDERER_URL` (Next dev-server) voor hot reload.
- `run-dev.sh`: installeert deps indien nodig, bundelt main/preload, start de
  Next dev-server, wacht tot die reageert, start Electron met
  `ELECTRON_RENDERER_URL`, en zet de dev-server bij exit weer af (trap).
- `npm run dist` → electron-builder: AppImage+deb / NSIS / dmg.

---

## 11. Bewust buiten scope (YAGNI — niet bouwen)

- Auto-updates, `mailto:`-handler, globale sneltoetsen, offline-opslag.
- Aparte notificaties/tellers voor Agenda-views.
- Handmatig accounts hernoemen/verwijderen (accounts zijn auto-beheerd).
- Detectie bij niet-aaneengesloten authuser-indexen (stop bij de eerste gap).
- Andere Google-apps dan Mail/Agenda.
- **Toetsaanslagen simuleren in Gmail** (bv. een Outlook-sneltoetsenlaag via
  `sendInputEvent` naar de Gmail-`WebContentsView`). Dit is geprobeerd en
  **werkt niet betrouwbaar** — Gmails eigen handlers accepteren de gesynthetiseerde
  keystrokes niet. Wil je Gmail-acties triggeren, doe dat door de UI aan te
  klikken, niet door toetsen te injecteren.

---

## 12. Eerlijke risico's om vooraf te weten

- Detectie/avatars zijn zo betrouwbaar als het DOM-scrapen: een Google-UI-wijziging
  kan het breken. Houd `extractIdentity` locale-onafhankelijk en makkelijk aan te
  passen.
- Eén gedeelde sessie = minder isolatie; Google kan alle accounts tegelijk
  uitloggen (bekend Gmail-gedrag).
- Meerdere views (Mail + Agenda × profielen) kosten geheugen → maak Agenda-views
  lui aan.

---

**Naam/branding:** werktitel "Gmail Desktop" (appId bv. `com.gmaildesktop.app`).
Kies desgewenst een eigen naam; dat beïnvloedt app-id en packaging-metadata.
Schrijf de README in het Engels.
