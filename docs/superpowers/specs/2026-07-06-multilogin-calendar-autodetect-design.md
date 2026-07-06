# Ontwerp: Google multi-login, auto-detectie & Agenda per profiel

**Datum:** 2026-07-06
**Status:** Goedgekeurd ontwerp (Optie B), klaar voor implementatieplan na spec-review.
**Bouwt voort op:** de Gmail-wrapper op `master` (avatars/identiteit + settings-paneel aanwezig; Outlook-shortcuts verwijderd).

## Doel

1. **Google multi-login**: één gedeelde Google-sessie i.p.v. geïsoleerde sessies per account.
2. **Auto-detectie**: alle in die sessie ingelogde Google-accounts worden automatisch als profiel toegevoegd — geen handmatig "+".
3. **Agenda per profiel**: elk profiel heeft naast Mail ook Google Agenda; een agenda-icoontje onder de avatar wisselt tussen Mail en Agenda voor dat account.

## Prerequisite (eerst verifiëren!)

De hele auto-detectie leunt op het **uit de Gmail-pagina scrapen van identiteit** (naam/e-mail/avatar) — precies het mechanisme achter de avatars, dat nog nooit visueel bevestigd is. **Implementatiestap 0 = verifiëren dat de avatar/identiteit-detectie op de echte app werkt** (avatar + e-mail verschijnen in de zijbalk na inloggen). Werkt dat niet, dan wordt dat éérst opgelost; pas daarna bouwen we detectie erop. Geen enkele latere taak begint voordat dit bevestigd is.

## Architectuur

### Sessie & profielen
- **Eén gedeelde persistente sessie** (`persist:google`) voor alle views. Google's eigen multi-login beheert de accounts erin.
- Een **profiel** is afgeleide, niet-persistente data: `{ index: number; email: string; name: string; avatarUrl: string; color: string }`. Bij elke start opnieuw gedetecteerd (login blijft in de sessie bewaard). `index` = Google's authuser-index (`/u/N/`).
- **Kleur** wordt afgeleid uit een vaste palette op `index`; optioneel overschreven per e-mail (persistente override, klein JSON-bestand `profile-colors.json`: `email → color`).

### URL's (puur, testbaar)
- `mailUrl(index) = https://mail.google.com/mail/u/${index}/`
- `calendarUrl(index) = https://calendar.google.com/calendar/u/${index}/r`

### Detectie (`detectionPlanner` — puur + view-probing)
Puur beslismodel `planNext(seen: string[], lastEmail: string | null, index: number): 'register' | 'stop' | 'probe-next'` met stopcondities, plus de driver in de main-process:
1. **Profiel 0**: toon Mail-view op `mailUrl(0)`. Nog niet ingelogd → Google-login; gebruiker logt in. Zodra identiteit(0) binnenkomt → registreer profiel 0.
2. **Probe index 1, 2, …** met een tijdelijke (verborgen) Mail-view op `mailUrl(N)`:
   - Identiteit met **nieuw** e-mailadres → registreer profiel N (de view wordt de Mail-view van dat profiel).
   - Identiteit met een **al gezien** e-mailadres → Google heeft een ongeldige index teruggestuurd naar account 0 → **stop**.
   - Geen identiteit binnen ~8s (loginscherm/chooser) → **stop**.
   - Hard cap: index 10.
3. Dit hergebruikt uitsluitend de bestaande identiteit-parser; "e-mail herhaalt → stop" is de robuuste stopconditie (authuser-indexen zijn aaneengesloten per sessie).

### Views (`ProfileViewManager` — herschreven `AccountViewManager`)
- Beheert profielen op `index`, elk met een `mailView` en een lui aangemaakte `calendarView`, allemaal in `persist:google`.
- `show(index, surface: 'mail' | 'calendar')`: maakt de calendar-view lui aan bij eerste gebruik, toont de juiste view, verbergt de rest, herberekent bounds.
- Notificaties/ongelezen-teller/identiteit lopen zoals nu via het preload per Mail-view (Agenda-views doen dat niet).
- `contextIsolation: false` blijft (alleen vertrouwde Google-domeinen), nodig voor de Notification-wrapper.

## Zijbalk (renderer)
- Eén **avatar** per gedetecteerd profiel; eronder een klein **agenda-icoontje**. Klik avatar → `show(index,'mail')`; klik agenda-icoontje → `show(index,'calendar')`. Actief profiel + oppervlak gemarkeerd (bijv. ring om de avatar, agenda-icoon oplicht als Agenda actief is).
- **"+"-knop → "Accounts opnieuw detecteren"** (re-run detectie; pikt accounts op die je via Gmail's eigen "ander account toevoegen" hebt toegevoegd).
- **⚙ instellingen-paneel** (hergebruikt de bestaande hide/show-view-aanpak): per profiel een **kleur-override** (swatches) + een **"Opnieuw detecteren"**-knop. Hernoemen/verwijderen vervalt (accounts zijn auto-beheerd).

## IPC (herzien)
- `PROFILES_CHANGED` (main → renderer): `Profile[]` met `{index,email,name,avatarUrl,color}`.
- `SWITCH_SURFACE` (renderer → main): `(index, surface)` → toon die view.
- `REDETECT` (renderer → main): start detectie opnieuw.
- `SET_COLOR` (renderer → main): `(email, color)` → override opslaan + `PROFILES_CHANGED`.
- Behouden: `ACCOUNT_IDENTITY` (preload → main), `UNREAD_UPDATE`, `NOTIFICATION_ACTIVATE`, `SETTINGS_TOGGLE`, `SETTINGS_FORCE_CLOSE`.
- **Vervalt**: de handmatige `ACCOUNTS_LIST/ADD/REMOVE/SWITCH` en `ACCOUNTS_UPDATE`/`ACCOUNTS_CHANGED` (vervangen door detectie + `PROFILES_CHANGED` + `SWITCH_SURFACE`). De oude `accounts-store` (handmatige lijst) verdwijnt; alleen de kleur-override-store blijft.

## Componenten & testbaarheid
- **Puur, getest (Vitest):** `detectionPlanner` (stop/registreer/volgende-logica, incl. e-mail-herhaling en cap), `urls` (`mailUrl`/`calendarUrl`), `palette` (kleur per index), de bestaande identiteit-parser (blijft), en `color-store` (email→color persist).
- **Dun Electron-omheen:** `ProfileViewManager` (view-lifecycle, detectie-driver), main-IPC, sidebar-renderer. GUI-runtime niet in deze sandbox testbaar → verificatie op de machine van de gebruiker (zie Prerequisite en per-taak rooktests).

## Bewust buiten scope (YAGNI)
- Aparte notificaties/tellers voor Agenda-views.
- Handmatig hernoemen/verwijderen van accounts (auto-beheerd).
- Detectie bij niet-aaneengesloten authuser-indexen (zeldzaam; we stoppen bij de eerste gap).
- Andere Google-apps dan Mail/Agenda.

## Eerlijke risico's
- Detectie is zo betrouwbaar als het pagina-scrapen: Google-DOM-wijzigingen kunnen het breken (zelfde klasse fragiliteit als avatars).
- Eén gedeelde sessie: minder isolatie; Google kan alle accounts tegelijk uitloggen (bekend Gmail-gedrag).
- Meerdere views (Mail + Agenda × profielen) verhogen geheugengebruik; daarom lui aanmaken.
