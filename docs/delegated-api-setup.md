# Delegated postvakken via de Gmail API

Hoe je mail kunt kopiëren **naar en uit een gemachtigd postvak** (een mailbox die
in Gmail aan jou gedelegeerd is), en hoe je dat correct inricht.

Lees eerst [§3](#3-waarvoor-je-dwd-wél-en-niet-nodig-hebt): voor de leeskant heb
je dit misschien niet nodig, en dat scheelt je de hele installatie hieronder.

De sidebar-kant van delegated mailboxen (`electron/delegation.ts`,
`electron/delegated-store.ts`) werkt bewust zónder API, op de websessie, en
verandert hier niet door.

---

## 1. Waarom de gewone weg niet werkt

Het kopiëren gebruikt nu één access token per account en post naar
`users/me/messages` (`electron/gmail-api.ts:17`, `electron/gmail-api.ts:505`).
De logische gedachte is: zet in plaats van `me` het adres van het gemachtigde
postvak in de URL. Dat werkt niet.

De Gmail API kent het begrip "gemachtigde" niet. In elke methode is `userId`
gedocumenteerd als *"The user's email address. The special value `me` can be used
to indicate the authenticated user"* — en dat adres moet **dezelfde gebruiker
zijn als die van het token**. Vul je een ander adres in, dan antwoordt Google:

```
403  Delegation denied for bart@abovomaxlead.nl
```

Belangrijk om te internaliseren: **delegatie die je in de Gmail-webinterface
instelt, geeft alleen toegang tot die webinterface.** Er komt geen API-toegang
mee. Er bestaan wel delegatie-endpoints (`users.settings.delegates`), maar die
beheren alleen de *lijst* met gemachtigden — ze geven geen toegang tot de mail,
en ze vereisen zelf al de opzet die hieronder staat.

Dat is precies waarom de bestaande delegated-laag op de websessie werkt en niet
op de API (zie de notitie bovenaan `electron/delegation.ts`).

## 2. Hoe het wél werkt: impersonatie

In plaats van "ik ben Luca en ik ben gemachtigd voor Bart" zegt je code
**"ik ben Bart"**. Dat kan met een service account waaraan de Workspace-beheerder
domain-wide delegation heeft gegeven.

```
  service-account sleutel (privé)
            │
            │  1. JWT ondertekenen, met sub = bart@abovomaxlead.nl
            ▼
  https://oauth2.googleapis.com/token
            │
            │  2. grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
            ▼
  access token, 1 uur geldig
            │
            │  3. gewoon Bearer-header, zoals nu
            ▼
  https://gmail.googleapis.com/.../users/me/messages
            │
            └─►  `me` IS het postvak van Bart
```

Het cruciale gevolg: **`insertMessage`, `fetchLabels`, `messageExistsInLabel` en
`fetchThreadRaw` hoeven geen letter te veranderen.** Ze krijgen alleen een token
uit een andere bron. Je hebt geen tweede code-pad voor delegated nodig, alleen
een tweede tokenbron.

Let op wat dit *niet* is: dit is geen delegatie, dit is volledige toegang tot een
postvak. Zie [§8 Beveiliging](#8-beveiliging) — dat is het echte werk aan deze
feature, niet de installatie.

## 3. Waarvoor je DWD wél en niet nodig hebt

Belangrijk onderscheid, want het scheelt je mogelijk de halve installatie.
Kopiëren bestaat uit twee kanten, en die hebben niet dezelfde eisen:

| Kant | Nodig |
| --- | --- |
| **Uit** een gemachtigd postvak lezen (bron van een sleep) | Misschien geen DWD — zie hieronder |
| **Naar** een gemachtigd postvak schrijven (doel van een kopie) | DWD; hier is geen weg omheen |

Voor het schrijven is dat hard: `messages.insert` bestaat alleen in de API. Er is
geen web-endpoint dat een RFC822-bericht in een postvak zet, dus geen sessieweg
die je in plaats daarvan kunt gebruiken.

Voor het lezen niet. De app heeft namelijk al een **tweede weg naar de ruwe
bytes die geen token gebruikt**, alleen de ingelogde sessie
(`electron/mail-fetch.ts`): de "Origineel bekijken"-pagina (`view=om`), en van
daaruit de "Origineel downloaden"-link (`view=att&disp=comp`). Dat is de weg die
overblijft als er geen koppeling is (zie `collectLabelViaApi`,
`electron/main.ts:1324`).

En een gemachtigd postvak zit in precies dezelfde sessie — het is dezelfde
inlog, alleen een andere URL: `/mail/u/<host>/d/<token>/` in plaats van
`/mail/u/<n>/`. De sessieweg heeft dus geen principieel probleem met delegatie;
`omUrl` bouwt nu alleen de `authuser`-vorm (`electron/mail-fetch.ts:16`).

**Test dit eerst.** Werkt de `view=om`-pagina achter het `/d/<token>/`-pad, dan
kun je uit gemachtigde postvakken slepen zonder service account, zonder
beheerder en zonder sleutel op een server. Dat is een aanzienlijk kleiner
apparaat dan wat hieronder staat, en het is niet zeker dat het werkt — Google
kan `view=om` onder een delegatiepad anders behandelen. Een half uur uitproberen
beslist of je de rest van dit document nodig hebt.

## 4. Voorwaarden

| Voorwaarde | Waarom |
| --- | --- |
| Het postvak zit in hetzelfde Workspace-domein | Impersonatie werkt alleen binnen je eigen domein. Een gemachtigd `@gmail.com`-postvak of een ander domein kan hier niet. |
| Je hebt een Workspace-beheerder nodig | Alleen een beheerder kan de scopes autoriseren (stap 2). Zonder dat werkt de sleutel niet. |
| Het **primaire** e-mailadres | Een alias geeft `Delegation denied`, ook als alles verder klopt. |
| Een GCP-project | Je hebt er al een voor de OAuth-client en het Pub/Sub-topic; gebruik hetzelfde. |

---

## 5. Installatie

### Stap 1 — Service account aanmaken

In de Google Cloud console, in hetzelfde project als je OAuth-client:

1. Ga naar **IAM & Admin → Service Accounts**.
2. **Create service account**. Geef een naam (bijv. `gmail-delegated`), en een
   beschrijving waaruit blijkt waar de sleutel woont. Rollen zijn **niet** nodig
   — IAM-rollen gaan over GCP-resources, en Gmail-toegang komt hier niet uit IAM
   maar uit stap 2.
3. Klik **Create and continue**, daarna **Done**.
4. Open het service account en noteer de **Unique ID** (een lang getal). Dat is
   het Client ID dat stap 2 nodig heeft — *niet* het e-mailadres.
5. Tab **Keys → Add key → Create new key → JSON**. Het bestand downloadt één
   keer en is daarna niet opnieuw op te halen.

> De sleutel is een wachtwoord voor élk postvak in het domein. Zet hem nooit in
> deze repo — die is publiek. Zie stap 3 voor waar hij hoort.

### Stap 2 — Scopes laten autoriseren door de beheerder

Dit is de stap die de sleutel daadwerkelijk macht geeft. Zonder deze stap krijg
je bij het minten `unauthorized_client`.

In de **Admin console** (admin.google.com), als beheerder:

1. **Main menu → Security → Access and data control → API controls**.
2. In het paneel **Domain wide delegation**: **Manage Domain Wide Delegation**.
3. **Add new**.
4. **Client ID**: de Unique ID uit stap 1.4.
5. **OAuth scopes (comma-delimited)** — exact deze twee, dezelfde als `SCOPES`
   in `electron/google-oauth.ts:27` op `userinfo.email` na (dat is een
   gebruikersscope en hier niet van toepassing):

   ```
   https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.insert
   ```

6. **Authorize**.

Vraag niet om `https://mail.google.com/` "voor het gemak". Dat is volledige
lees-, schrijf- en verwijderrechten op elk postvak in het domein; de twee scopes
hierboven kunnen lezen en toevoegen, maar niets weggooien.

De autorisatie kan een paar minuten doorwerken. Werkt het direct na `Authorize`
nog niet, wacht dan even voordat je gaat zoeken naar een fout.

### Stap 3 — De sleutel op de relay zetten, niet in de app

**Zet de sleutel niet in het installatiepakket en niet in `userData`.** Een
desktop-app staat op de machine van de gebruiker; wie daar bij die sleutel komt,
leest elk postvak in abovomaxlead.nl. Dat is een fundamenteel ander risico dan
de OAuth-tokens die er nu staan, want die geven alleen toegang tot postvakken
waarvoor de gebruiker zelf toestemming gaf.

Je hebt al een push-relay op een eigen domein (`electron/push-config.ts`). Die is
de juiste plek:

- De sleutel staat alleen op de relay.
- De app vraagt de relay om een token voor één postvak.
- De relay bepaalt of dat mag, en mint alleen dan.

De autorisatie op de relay kan hard, niet op goed vertrouwen. De relay weet al
welk account aan een verbinding hangt (via het e-mailadres uit `tokeninfo`), en
kan de delegatie bij Google zelf navragen in plaats van de client te geloven:

1. Mint een token voor het doelpostvak (`sub` = bart@abovomaxlead.nl).
2. Roep `users.settings.delegates.list` aan op `users/me` met dat token — dat
   werkt al met `gmail.readonly`, dus je hebt er geen extra scope voor nodig.
3. Sta het toe als het adres van de aanvrager in de teruggegeven `delegates`
   staat, en weiger anders.

Zo hangt de beveiliging aan Google's eigen delegatie-administratie. `delegated.json`
in de app blijft dan wat het is: een lijst voor de interface, geen recht.

### Stap 4 — Config in de app

De app hoeft alleen te weten waar hij een token kan vragen. Dat past in
`google-oauth.json` in `userData`
(`%APPDATA%/gmail-desktop/google-oauth.json` op Windows), naast `clientId`,
`clientSecret`, `relayUrl` en `pushTopic`:

```json
{
  "clientId": "…",
  "clientSecret": "…",
  "relayUrl": "wss://…",
  "pushTopic": "projects/…/topics/…",
  "delegatedTokenUrl": "https://relay.example/delegated-token"
}
```

Ontbreekt die regel, dan blijft kopiëren naar delegated postvakken uit en werkt
de app precies zoals nu — hetzelfde patroon als push (`electron/push-config.ts:1`).

### Stap 5 — Verifiëren

De scherpste test is één verzoek, want het antwoord zegt letterlijk wiens postvak
`me` is:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://gmail.googleapis.com/gmail/v1/users/me/profile
```

Verwacht:

```json
{ "emailAddress": "bart@abovomaxlead.nl", "messagesTotal": …, "historyId": "…" }
```

Staat daar jouw eigen adres, dan is de `sub`-claim niet aangekomen en werk je
tegen je eigen postvak — dan zou een kopieeractie stil op de verkeerde plek
landen. Controleer dit vóór de eerste insert.

---

## 6. Een token minten

Geen library nodig; `node:crypto` kan RS256 ondertekenen. `sa` is het JSON-bestand
uit stap 1.5.

```js
const { createSign } = require('node:crypto');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.insert',
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assertion(sa, subject, now = Math.floor(Date.now() / 1000)) {
  const claims = {
    iss: sa.client_email,
    sub: subject, // hét verschil: wiens postvak `me` wordt
    scope: SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600, // max een uur; meer wordt geweigerd
  };
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
  const sig = createSign('RSA-SHA256').update(input).sign(sa.private_key);
  return `${input}.${sig.toString('base64url')}`;
}

async function tokenFor(sa, subject) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion(sa, subject),
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description ?? json.error ?? `HTTP ${res.status}`);
  // Geen refresh token bij deze flow: je mint simpelweg opnieuw. Een minuut
  // marge, net als applyTokenResponse in google-oauth.ts.
  return { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 - 60_000 };
}
```

Cache per postvak op `expiresAt`; bij een labelsleep van honderden berichten wil
je niet per insert opnieuw minten.

## 7. Waar dit in de app landt

| Plek | Verandering |
| --- | --- |
| `electron/gmail-api.ts` | Geen. Alle functies nemen al een `accessToken`. |
| Tokenbron | Naast `OAuthStore` een bron die tokens voor delegated postvakken haalt en cachet. Zelfde vorm als `StoredToken` (`electron/google-oauth.ts:112`), zonder `refreshToken`. |
| `electron/mail-copy.ts` | Geen. `CopyTarget.email` is al gewoon een adres. |
| Doelenlijst | `LABELS_GET` filtert nu op `p.kind === 'authuser'` (`electron/main.ts:2232`), dus delegated postvakken vallen eruit. Daar moeten ze bij, met hun labels via `fetchLabels` op het nieuwe token. |
| Doelenlijst zónder DWD | Tonen kan wel, aanvinken niet: label-ID's en `insert` zijn beide API-only. Geef de rij dan mee met `labels: []` en een `error` ("Beheerdertoegang nodig"), zoals `'Niet gekoppeld'` nu (`electron/main.ts:2236`) — eerlijker dan stil weglaten, want in de sidebar staat het postvak wél. |
| Foutmeldingen | `GmailHttpError` 401 betekent hier "opnieuw minten", niet "verversen". |

## 8. Beveiliging

Dit is het deel dat aandacht verdient, want de installatie is het makkelijke
stuk.

- **Domain-wide is echt domein-breed.** Er is geen manier om een DWD-grant te
  beperken tot een lijstje postvakken of een OU. De grant uit stap 2 geeft
  toegang tot elke mailbox in het domein, ook die van morgen. Beperking moet dus
  uit *jouw* code komen — en daarom uit de relay (stap 3), niet uit de client.
- **De sleutel nooit in de repo.** Die is publiek. Ook niet in een build-script,
  een `.env` die meegepakt wordt, of een log.
- **Roteren.** Sleutels in de Keys-tab kunnen naast elkaar bestaan: nieuwe
  aanmaken, relay omzetten, oude verwijderen. Doe dit als de relay ooit
  gecompromitteerd zou zijn, en anders periodiek.
- **Loggen wat er gemint wordt.** Wie, voor welk postvak, wanneer. Zonder dat is
  misbruik van de relay niet terug te vinden. In het Admin console-auditlog
  verschijnt de toegang als het service account, niet als de gebruiker die het
  vroeg — dat verband bestaat alleen in jouw log.
- **Verwijder de grant als de feature weggaat.** Een vergeten DWD-autorisatie is
  een openstaande deur zonder gebruiker.

## 9. Probleemoplossing

| Melding | Oorzaak |
| --- | --- |
| `unauthorized_client` bij het minten | Stap 2 niet gedaan, verkeerde Client ID (het e-mailadres in plaats van de Unique ID), of de scope-string wijkt af van wat je in de JWT vraagt. Ze moeten letterlijk overeenkomen. |
| `invalid_grant` bij het minten | `sub` bestaat niet, zit niet in het domein, of is een alias. Of de klok van de relay loopt te ver uit — `iat` in de toekomst wordt geweigerd. |
| `403 Delegation denied` op een Gmail-call | Je zet een ander adres in `userId` in plaats van `me`. Met een impersonatietoken hoort daar altijd `me` te staan. |
| `403 Request had insufficient authentication scopes` | Scope wél in de JWT maar niet geautoriseerd in stap 2 (of net toegevoegd en nog niet doorgewerkt). |
| `/profile` geeft je eigen adres terug | De `sub`-claim ontbreekt of staat verkeerd. Je werkt tegen je eigen postvak. |
| Kopie landt op vandaag in plaats van de originele datum | `internalDateSource=dateHeader` mist in de URL — zie `INSERT_URL`, `electron/gmail-api.ts:17`. |

## 10. Wat dit verder oplevert

Met tokens voor delegated postvakken werken ook `watch`, `history.list` en
`labels.get` daar. Concreet: echte ongelezen-tellers en push-meldingen voor
gemachtigde postvakken, in plaats van wat er nu uit de paginatitel van de webview
gelezen wordt. Dat is geen extra installatie — dezelfde tokens, dezelfde
functies in `electron/gmail-api.ts`.

---

## Bronnen

- [users.messages.insert](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/insert) — `userId` en de scopes voor insert
- [Domain-wide delegation of authority](https://developers.google.com/identity/protocols/oauth2/service-account) — service account, JWT-claims, Admin console-pad
- [Manage delegates](https://developers.google.com/workspace/gmail/api/guides/delegate_settings) — vereist zelf een service account met domain-wide authority; primair adres, max 25 gemachtigden
- [users.settings.delegates.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.delegates/list) — werkt met `gmail.readonly`
