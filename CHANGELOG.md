# Changelog

All notable changes to Gmail Desktop are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

## [0.2.6] — 2026-07-13

### Opgelost
- **Account verwijderen deed niets.** Klikken op "Weg ermee" bij een account in
  de instellingen had geen effect meer: het account bleef gewoon in de lijst
  staan. Verwijderen werkt nu weer, en het account blijft ook na een
  herdetectie verborgen.

### Fixed
- **Removing an account did nothing.** Clicking "Remove" on an account in
  settings no longer had any effect: the account simply stayed in the list.
  Removal works again, and the account also stays hidden after re-detection.

## [0.2.5] — 2026-07-10

### Opgelost
- **"Volledig bericht weergeven" opende in hetzelfde venster.** Bij een
  ingekort bericht opende de link "Volledig bericht weergeven" de volledige
  tekst in hetzelfde venster, waarna je niet meer terug kon naar je inbox. De
  link opent nu in een apart venster, net als in de browser.

### Fixed
- **"View entire message" opened in the same window.** On a clipped email, the
  "View entire message" link loaded the full text into the same window, leaving
  no way back to your inbox. It now opens in a separate window, as it does in the
  browser.

## [0.2.4] — 2026-07-10

### Toegevoegd
- **Melding bij een nieuwe update.** Zodra er een nieuwe versie klaarstaat, krijg
  je een melding op je bureaublad. Klik erop en de app opent meteen bij de
  update-instellingen, waar je de update kunt downloaden en installeren. De app
  kijkt nu ook elke 30 minuten of er een update is (voorheen alleen bij het
  opstarten).

### Opgelost
- **Achtergebleven getal in de taakbalk.** Had je al je post gelezen, dan bleef
  er soms nog een ongelezen-getal op het app-icoon in de taakbalk staan totdat je
  de app opnieuw opende of er nieuwe post binnenkwam. Het getal verdwijnt nu
  meteen zodra er niets meer ongelezen is.

### Added
- **Update-available notification.** When a new version is ready, you get a
  desktop notification. Click it and the app opens straight to the update
  settings, where you can download and install the update. The app now also
  checks for an update every 30 minutes (previously only at launch).

### Fixed
- **Stale taskbar badge.** After you'd read all your mail, the app icon in the
  taskbar sometimes kept showing an unread number until you reopened the app or
  new mail arrived. The number now clears immediately once nothing is unread.

## [0.2.3] — 2026-07-09

### Toegevoegd
- **Badge-teller per account aan/uit.** In Instellingen → Accounts heeft elk
  account nu een "Badge"-vinkje. Zet je het uit, dan telt de ongelezen post van
  dat account niet meer mee in het getal op het app-icoon in de taakbalk.
  Standaard staat het aan (net als voorheen). Dit verandert alleen het
  taakbalk-getal — meldingen en de teller in de zijbalk blijven gewoon werken.

### Added
- **Per-account taskbar badge toggle.** In Settings → Accounts, each account now
  has a "Badge" checkbox. Turn it off and that account's unread mail no longer
  counts toward the number on the taskbar app icon. Default is on (unchanged
  from before). This only affects the taskbar count — notifications and the
  sidebar unread counter keep working as usual.

## [0.2.2] — 2026-07-09

### Toegevoegd
- **Gedelegeerde postvakken.** Postvakken die een ander account aan jou heeft
  gedelegeerd (Gmails "toegang delegeren") verschijnen nu als eigen account in
  de zijbalk. De app herkent gedelegeerde postvakken waar je al toegang toe hebt
  en stelt ze voor; je kunt ze toevoegen of verwijderen, en ze worden onthouden
  na een herstart. Elk postvak heeft zijn eigen ongelezen-teller en meldingen,
  net als een gewoon account.

### Opgelost
- **Inloggen met een Workspace-account dat via Microsoft gaat, werkt nu.** Gaat
  het inloggen van je Google Workspace-domein via Microsoft (Entra ID /
  Office 365), dan mislukte het toevoegen van het account eerder met de melding
  "AADSTS900561: The endpoint only accepts POST requests". De app stuurde de
  Microsoft-inlogstap naar je browser als het verkeerde soort verzoek; nu blijft
  het inloggen in de app zelf, zodat het gewoon lukt.

### Added
- **Delegated mailboxes.** Mailboxes another account has delegated to you
  (Gmail's "delegate access") now appear in the sidebar as their own account.
  The app detects delegated mailboxes you already have access to and suggests
  them; you can add or remove them, and they're remembered across restarts. Each
  has its own unread badge and notifications, just like a regular account.

### Fixed
- **Signing in with a Microsoft-federated Workspace account now works.** If your
  Google Workspace domain signs in through Microsoft (Entra ID / Office 365),
  adding the account previously failed with "AADSTS900561: The endpoint only
  accepts POST requests". The app was handing the Microsoft sign-in step to your
  browser as the wrong kind of request; it now keeps the sign-in inside the app
  so it completes normally.

## [0.2.1] — 2026-07-08

### Toegevoegd
- **Google-apps per account** — naast Mail en Agenda opent elk account nu ook
  Drive, Documenten, Spreadsheets, Presentaties, Keep, Contacten en Chat in de
  app. Onder de agendaknop zit een nieuw rasterknopje dat de apps van dat
  account uitklapt.
- Links naar deze Google-apps (bijvoorbeeld een Documenten-link in een e-mail)
  openen nu in de app zelf, in het juiste onderdeel, in plaats van in de
  externe browser. De nieuwe onderdelen sturen geen meldingen.

### Added
- **Google apps per account** — next to Mail and Calendar, each account can now
  open Drive, Docs, Sheets, Slides, Keep, Contacts and Chat inside the app. A
  new grid button under the calendar button expands that account's apps.
- Links to these Google apps (e.g. a Docs link in an email) now open inside the
  app, in the right section, instead of in the external browser. The new
  sections don't send notifications.

## [0.2.0] — 2026-07-08

### Added
- **The tray icon's right-click menu can now do more:**
  - **Snooze notifications** — for 10, 30 or 60 minutes, or "until I turn them
    back on". The menu shows when notifications will resume; a timed snooze
    clears itself when it expires, and "Turn notifications on" lifts it
    immediately.
  - **Check for updates** straight from the tray. It brings the window forward,
    opens Settings, and once the check finishes shows a small popup: a newer
    version is available (with a Download button), you're already on the latest
    version, or the check couldn't be completed.
  - **Start at login** — a checkbox kept in sync with the same setting in
    Settings.

### Toegevoegd
- **In het kleine menu (rechtsklik op het plaatje onderin je scherm) kun je nu
  meer doen:**
  - **Even geen piepjes.** Kies 10, 30 of 60 minuten stil, of "totdat ik ze weer
    aanzet". Het menu laat zien tot hoe laat het stil blijft. Is de tijd om? Dan
    komen de piepjes vanzelf weer terug. Wil je ze eerder terug? Klik op "Piepjes
    weer aan".
  - **Kijken of er iets nieuws is.** De app kijkt of er een nieuwere versie is.
    Het venster komt naar voren en de instellingen gaan open. Is er iets nieuws?
    Dan kun je op de knop klikken om het op te halen. Is alles al goed? Dan zegt
    de app dat. Lukt het kijken niet? Dan zegt de app dat ook.
  - **Vanzelf opstarten.** Zet dit vinkje aan. Dan gaat de app vanzelf aan als je
    de computer aanzet.

## [0.1.9] — 2026-07-08

### Opgelost
- Herinneringen uit Google Agenda komen nu ook echt binnen als melding op je
  computer. Eerst stuurde de agenda die herinneringen op een manier weg die de
  app niet kon laten zien, dus zag je ze niet. Nu laat de app ze wel zien. Ze
  luisteren netjes naar je instellingen: staat "niet storen" of de stille uren
  aan, of heb je agenda-meldingen voor dat account uitgezet, dan blijft het
  stil. Klik je op zo'n herinnering, dan gaat de agenda van dat account open.

### Fixed
- Google Calendar reminders now actually show up as desktop notifications.
  Previously the calendar sent them in a way the app could not display, so you
  never saw them. They now respect your settings: if Do Not Disturb or quiet
  hours are on, or you have turned off Calendar notifications for that account,
  they stay silent. Clicking a reminder opens that account's calendar.

## [0.1.8] — 2026-07-08

### Added
- Choose how clicking a notification opens its message or event: **in the app**
  (default — brings the window forward and opens it in place) or **in a new
  window**. Setting lives under General.
- Settings now has a **Save** button and a "Saved ✓" confirmation. All controls
  still apply instantly; Save additionally commits an in-progress name edit and
  confirms everything was stored.

### Fixed
- Clicking a notification while the app is minimized now restores and focuses
  the window (with "Open in the app"), instead of leaving it minimized behind a
  stray window.
- Clicking a notification no longer opens **two** windows in "Open in a new
  window" mode (the app's own open and Gmail's follow-up popup both fired).
- Account name edits now also save on Enter, and the quiet-hours time fields no
  longer lose their value while you're typing a new time.
- **Clicking a mail notification now opens the clicked message**, not just the
  account's inbox. The "When you click a notification" setting now works as
  intended: *in the app* opens the message in place, *in a new window* opens it
  in Gmail's focused pop-out reading window (just the message, without the
  sidebar/search chrome). (Gmail's notifications carry no message reference and
  its own click handler does nothing inside the wrapper, so the app resolves the
  message from the notification's subject and triggers Gmail's own pop-out; if
  that button can't be found it falls back to a full thread window.)
- The app no longer crashes ("Cannot read properties of undefined") after a
  Google page inside a view closes itself, e.g. Gmail's pop-out compose after
  sending. Dead views are now cleaned up.
- Fixed a crash on quit ("Object has been destroyed") when views were torn down
  after the main window had already closed.
- Fixed a crash ("Object has been destroyed") when clicking a notification after
  the main window had been closed/torn down — the click now rebuilds the window
  and brings the app back instead of failing silently.
- Clicking a notification no longer triggers Gmail's "pop-up blocked" warning
  (the app opens the message itself and hands Gmail's follow-up popup a
  harmless stub instead of a blocked-looking null window).

## [0.1.7] — 2026-07-07

### Fixed
- Links clicked inside an email now open in your default browser instead of
  loading inside the mail view. Gmail, Calendar and Google sign-in navigation
  still stay in the app.

## [0.1.6] — 2026-07-07

### Fixed
- Per-account notification toggles in Settings now reflect the stored state and
  respond to clicks. Previously a toggle could show "on" while notifications for
  that account were actually muted, and toggling it had no effect (the settings
  UI was not kept in sync after a change).

### Added
- **Calendar reminders.** Google Calendar's own event reminders can now appear as
  desktop notifications, enabled per account (opt-in). They respect the global
  Do Not Disturb switch and quiet hours, and clicking a reminder opens that
  account's calendar. No calendar data is read — Google Calendar fires the
  reminders itself from a background view.
- Each account row in Settings now has separate **Mail** and **Calendar**
  notification toggles.

## [0.1.5] — 2026-07-06

### Added
- Launch at login (optional) and remembered window size/position.
- Per-account notifications with a global Do Not Disturb switch and quiet hours.
- Clicking a notification restores the window and switches to the right account.
- Drag to reorder accounts in the sidebar, and custom per-account labels.
- Keyboard shortcuts: Ctrl+1–9 to switch accounts, Ctrl+N to compose.
- Per-account zoom (Ctrl +/−/0), remembered across sessions.
- Light and dark theme for the app shell, following the system with a manual
  override.
- Google Calendar logo for the calendar button; removed the dark frame around
  the Gmail view.

## [0.1.1] – [0.1.4]

Initial Gmail Desktop wrapper: multi-account sidebar with avatars and unread
badges, per-account calendar, desktop notifications, tray with minimize-to-tray,
single-instance, account add/remove, and auto-update from GitHub Releases.
