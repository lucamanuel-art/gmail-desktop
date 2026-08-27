# Changelog

All notable changes to Gmail Desktop are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

## [0.3.1-beta.14] — 2026-08-27

### Toegevoegd
- **Betaversies aan- of uitzetten in de instellingen.** Onder Updates staat een nieuwe
  schakelaar, "Betaversies ontvangen". Staat hij uit — en dat is hoe hij begint — dan krijg je
  alleen afgeronde versies aangeboden, precies zoals nu. Zet je hem aan, dan wordt ook een
  voorlopige versie als update aangeboden, en zo kom je bij de 1.0.0-beta. De schakelaar werkt
  meteen; de app hoeft er niet voor opnieuw op.

### Opgelost
- **Wie op een betaversie zat, kreeg nooit meer een update aangeboden.** De app vroeg GitHub
  alleen naar de release die daar als "Latest" gemarkeerd staat, en dat is per definitie geen
  betaversie. Op 0.3.1-beta.13 was de nieuwste "Latest" versie 0.3.0 — ouder dan wat er al
  stond — dus het antwoord was steevast "je hebt de nieuwste al", terwijl er zes nieuwere
  beta's klaarstonden. Met de schakelaar hierboven aan loopt de app nu de releaselijst zelf na
  in plaats van alleen die ene markering te volgen.

## [0.3.1-beta.13] — 2026-08-20

### Gewijzigd
- **Gesleepte mail komt op deze computer te staan, niet meer op de server.** De standaardmap
  was de map Documenten, en die is op een domeinprofiel omgeleid naar
  `\\ABOVOMEDIA.local\Files\Redirection\...`. Daardoor ging elke bewaarde mail meteen weer het
  netwerk op, en de share verloor bovendien hele regels uit `log.jsonl` terwijl het bestand
  wel groeide: gemeten 65 KB nullen in een bestand van 578 KB, met complete records ertussen
  weg. De map is nu `%LOCALAPPDATA%\Gmail Desktop\Mail` op Windows en
  `~/Library/Application Support/Gmail Desktop/Mail` op de Mac, waar iCloud niet bij komt.
  **Wat er al bewaard is blijft staan waar het staat** — er wordt niets verplaatst of
  weggegooid, en wie zelf een map had gekozen houdt die. Kiest iemand een map op een share of
  in een syncmap, dan zegt de instelling dat er nu bij.
- **Er wordt één sleep tegelijk opgehaald, en je ziet hoe ver hij is.** De strook boven Gmail
  telt de gesprekken terwijl ze binnenkomen (`12 van 40 opgehaald`) in plaats van alleen
  "bezig met opslaan". Zolang dat loopt ligt er een sluier over Gmail — in elk gekoppeld
  postvak, niet alleen in het postvak waaruit gesleept is — en een tweede sleep wordt
  geweigerd met een melding.
- **Kopiëren naar meerdere postvakken gaat naast elkaar in plaats van na elkaar.** De limiet
  die een kopie afknijpt is die van Gmail zelf en die geldt per postvak, dus drie postvakken
  naast elkaar hebben drie keer die ruimte. De voortgangsbalk noemt daarom geen postvak meer:
  er lopen er meerdere, en één noemen zou niet waar zijn.

### Opgelost
- **Een tweede sleep tijdens het ophalen gooide de eerste weg.** Het ophalen begint met het
  leegmaken van de lijst opgeslagen mail en het opschuiven van de sleepteller, nog voordat er
  één bestand geschreven is. Kwam er in dat gaatje een nieuwe sleep binnen — makkelijk, want
  er was niets dat het tegenhield en van postvak wisselen mocht ook — dan won die, en het
  resultaat van de eerste sleep was er niet meer. Nu houdt één sleep het slot vast tot hij
  klaar is; laat hij het na vijf minuten niet los, dan neemt de volgende het over, zodat een
  verzoek dat nooit antwoordt het slepen niet blokkeert.
- **Een sleep vraagt hetzelfde gesprek niet meer één keer per regel op.** Tien regels uit één
  gesprek waren tien keer datzelfde gesprek ophalen en tien keer helemaal uitlezen. Een
  gemeten sleep vroeg Gmail 742 keer iets waar 79 antwoorden genoeg waren.
- **De dubbelencheck kijkt naar de hele sleep in plaats van naar de eerste tien mailtjes.**
  Dat plafond van tien zat er omdat elke vraag een eigen verzoek was; ze gaan nu gebundeld
  naar Gmail, en wat de app zelf ergens heeft neergezet weet hij daarna zonder te vragen.

### Changed
- **Dragged mail is kept on this machine instead of on the server.** The default folder was
  Documents, which a domain profile redirects to a share, so saved mail went straight back
  onto the network — and that share silently lost whole records from `log.jsonl` while the
  file kept growing. It is now `%LOCALAPPDATA%\Gmail Desktop\Mail` on Windows and
  `~/Library/Application Support/Gmail Desktop/Mail` on a Mac, which iCloud does not sync.
  **Nothing already saved is moved or deleted**, and a folder you picked yourself is kept. A
  folder on a share or in a sync folder now says so in settings.
- **One drag is pulled at a time, and you can see how far it is.** The strip above Gmail
  counts the conversations as they arrive (`12 van 40 opgehaald`) rather than saying only that
  it is busy. While it runs Gmail sits under a veil — in every linked mailbox, not only the
  one dragged from — and a second drag is refused with a message.
- **Copying into several mailboxes runs them side by side.** The limit that binds a copy is
  Gmail's own and it counts per mailbox, so three mailboxes at once have three times that
  room. The progress bar no longer names a mailbox, because more than one is running.

### Fixed
- **A second drag during a pull threw the first one away.** A pull empties the list of saved
  mail and moves the drag counter on before it has written a single file, so a drop landing in
  that gap won and the first drag's results were gone. One pull now holds a lock until it is
  done, and a hold that outlasts five minutes may be taken over, so a request that never
  answers cannot take dragging out of the app.
- **A drag no longer asks Gmail for the same conversation once per row.** Ten rows from one
  conversation were ten fetches and ten full parses of the same thread: 742 requests where 79
  answers were enough.
- **The duplicate check covers the whole drag instead of its first ten mails.** That cap
  existed because every question was its own request; they are batched now, and what the app
  itself filed somewhere it remembers without asking.

### Voor ontwikkelaars
- **Nieuw: `electron/gmail/quota.ts`, `electron/gmail/batch.ts`, `electron/mail/message-index.ts`,
  `electron/mail/drop-lock.ts`, `electron/mail/mail-folder.ts`.** De concurrency-constanten waren
  gokwerk met een opmerking over quota-eenheden ernaast; `quota.ts` rekent nu met Google's eigen
  prijslijst en verdeelt de momenten gelijkmatig, in de volgorde waarin ze gevraagd zijn. Een
  venster dat een hele seconde in één keer uitdeelt levert precies de 429 op waarvan de backoff
  meer kost dan de gelijktijdigheid oplevert — gemeten: 2,2x langzamer bij 32 tegelijk.
- **Batchen levert round trips op en geen eenheden.** Een batch van n telt als n verzoeken voor
  de quota, dus het scheelt wachttijd en geen budget; dat was ook de bedoeling, want de gemeten
  sleep gebruikte een derde van zijn toegestane quota. `messages.insert` kan er niet in: media
  uploads worden in een batch geweigerd. Valt een multipart-antwoord verkeerd uit, dan gaat de
  aanroep terug over het oude pad, met `batch mislukt` of `batch gaf niets bruikbaars` in het log.
- **Uploadruimte wordt in bytes uitgedeeld, niet in mailtjes.** Een vast aantal moest laag genoeg
  zijn voor die ene mail van 11,4 MB en kneep daarmee de negenennegentig van 53 KB af — gemeten
  28% van wat Gmail toestond, puur door die instelling. `COPY_BYTES_IN_FLIGHT` is 64 MB, met een
  plafond op het aantal, en de piek in geheugengebruik wordt daarmee begrensd door het budget in
  plaats van door acht keer de grootste mail.
- **Het slot draagt een token.** Een sleep die antwoordt nadat zijn eigen slot verlopen is mag
  niet het slot vrijgeven van de sleep die hem opvolgde. `DROP_LOCK_MS` is vijf minuten; de
  sluier gaat daarna zelf weg met `Ophalen duurde te lang` in de strook.
- **Nog niet tegen een echte mailbox gedraaid.** De hele keten hierboven — het pacen, het
  batchen, het parallel kopiëren, het slot, de nieuwe map — is met tests gebouwd en niet met een
  postvak. 1627 tests groen, `tsc --noEmit` schoon op beide projecten. Daarom een beta, en de
  eerste draai is er een om het log bij te houden: `batch mislukt`, `batch gaf niets bruikbaars`,
  `[quota] Gmail weigerde binnen het budget` en `tweede sleep geweigerd` zijn alle vier signalen
  dat een van deze stukken niet doet wat de tests zeggen.

## [0.3.1-beta.12] — 2026-08-18

### Opgelost
- **Een submap levert de mail van de submap, niet die van de map erboven.** Een submap is in
  Gmail geen aparte map maar één labelnaam met een schuine streep erin — `Werk/Grote
  klanten` — en Gmail schrijft die naam voluit in de link van de rij. De app las alleen het
  stuk vóór de eerste streep, want een streep op diezelfde plek kondigt ook Gmail's
  paginanummer aan (`/p3`), en hield `Werk/Grote klanten` dus voor `Werk`. Daarna klopte de
  hele keten: dat label werd opgezocht, gaf het id van de hoofdmap, en er kwam alle mail uit
  de hoofdmap mee — een sleep van een submap met vier gesprekken schreef de honderd van de
  map erboven weg. Alleen een afsluitende `/p<nummer>` gaat er nu nog af.
- **En de map waarin die mail landt draagt de naam van de submap.** Een mapnaam kan geen pad
  bevatten, dus de streep werd weggepoetst en de twee namen plakten aan elkaar tot
  `..._label_WerkGrote klanten`. Dat pad was onbereikbaar zolang elke submap als zijn
  hoofdmap binnenkwam; het heet nu `..._label_Werk - Grote klanten`.

### Fixed
- **A subfolder yields the subfolder's mail, not that of the folder above it.** A subfolder is
  not a folder of its own in Gmail but one label name with a slash in it — `Werk/Grote
  klanten` — and Gmail writes that name out in full in the href of the row. The app read only
  what came before the first slash, because a slash in that same place also announces Gmail's
  page number (`/p3`), and so took `Werk/Grote klanten` for `Werk`. Everything after that was
  consistent: that label was looked up, answered with the parent's id, and the whole parent
  folder came along — a drag of a subfolder holding four conversations saved the hundred of
  the folder above it. Only a trailing `/p<number>` comes off now.
- **And the folder that mail lands in is named after the subfolder.** A folder name cannot
  hold a path, so the slash was stripped and the two names glued into
  `..._label_WerkGrote klanten`. That path was unreachable while every subfolder arrived as
  its parent; it now reads `..._label_Werk - Grote klanten`.

### Voor ontwikkelaars
- **De bug zat in één teken van een reguliere expressie.** `labelFromHref` matchte op
  `/#label\/([^/?#]+)/`, waarin de schuine streep het einde van de naam markeert; dat is nu
  `/#label\/([^?#]+)/` met een aparte `/p\d+$` eraf. Beide spellingen die Gmail kan
  aanleveren komen zo op dezelfde naam uit: een echte streep en `%2F`, want
  `decodeURIComponent` maakt van de tweede de eerste. De keten eronder had niets nodig:
  `fetchLabelId` matcht exact op de volledige naam die de API zelf teruggeeft.
- **Twee tests faalden eerst op de oude code.** `labelFromHref` antwoordde `Werk` op
  `#label/Werk/Grote+klanten`, en `writeLabel` schreef de aan elkaar geplakte mapnaam die de
  oude test nog als juist vastlegde. 1419 tests groen, `tsc --noEmit` schoon.
- **Nog niet in een draaiende installatie gezien: een sleep van een hoofdmap met uitgeklapte
  submappen.** `labelFromDragTarget` weigert te gokken zodra het binnen één rij twee
  verschillende labelnamen vindt. Vóór deze fix waren dat er altijd één — de submap werd
  immers gelezen als zijn hoofdmap — en nu zijn ze verschillend. Tekent Gmail de submaprijen
  binnen de rij van de hoofdmap, dan doet een sleep die náást de naam van de hoofdmap begint
  niets meer; op de naam zelf blijft werken, en er komt in geen geval verkeerde mail uit.
  Daarom een beta.
## [0.3.1-beta.11] — 2026-08-18

### Gewijzigd
- **De labelkiezer laat één postvak tegelijk zien.** Elk gekoppeld postvak kreeg een eigen
  kolom in een paneel van 768 px breed, dus bij tien accounts stonden er negen kolommen van
  63 px naast elkaar. Een regel heeft 59 px nodig aan vinkje, icoon en tussenruimte voordat
  de naam begint, dus daar bleef 4 px labelnaam van over, met kolomkoppen afgekapt op zeven
  tekens en één lijst die zo lang werd als het langste postvak. Nu staat er een lijst
  postvakken van 240 px naast één labellijst over de volle breedte, elk met eigen scroll, en
  blijft het adres van het open postvak boven zijn labels staan in plaats van weg te
  scrollen. Per postvak staat in die lijst wat je anders alleen kon zien door erin te kijken:
  een amber stip als deze mail daar al staat, een blauw getal met hoeveel labels je er koos,
  een rode stip als het postvak niet te lezen is, en tijdens zoeken hoeveel labels er
  overblijven — typ "fact" en je ziet meteen in welke postvakken dat iets oplevert. Onderin
  staat per postvak welk label je koos, want met deze indeling is er altijd een postvak uit
  het zicht.

### Opgelost
- **Twee gesleepte mails zijn geen drie meer.** Gmail's eigen "alles selecteren" in de
  werkbalk is dezelfde soort checkbox als die van een regel, en staat aangevinkt zodra alle
  zichtbare regels dat zijn. In een lijst waarin elke regel bij hetzelfde gesprek hoort — na
  zoeken op één conversatie bijvoorbeeld — hield de app dat vakje voor een regel, en die
  regel noemde geen bericht. Een sleep van twee aangevinkte berichten kwam zo als drie
  regels binnen: twee mails en één die werd geweigerd met "Kon niet zien welk bericht deze
  rij is", terwijl de balk "2 van 3 opgeslagen" meldde. Een vinkje telt nu alleen als regel
  wanneer er een regel om heen staat.

### Changed
- **The label picker shows one mailbox at a time.** Every linked mailbox got a column of its
  own in a 768 px panel, so ten accounts left nine columns of 63 px. A row spends 59 px on
  its checkbox, icon and gaps before the name starts, which left 4 px of label name, heads
  cut to seven characters, and one list as long as the longest mailbox. There is now a 240 px
  rail of mailboxes beside a single full-width label list, each with its own scroll, and the
  open mailbox stays above its labels instead of scrolling away. Every rail row carries what
  a column used to say by being in sight: an amber dot when the scan already found this mail
  there, a blue count of what is ticked, a red dot when the mailbox cannot be read, and while
  a search runs, how many labels it leaves standing — type "fact" and you see which mailboxes
  hold one. The footer names the ticked label per mailbox, because with a rail there is
  always a mailbox out of sight.

### Fixed
- **Two dragged mails are no longer three.** Gmail's own select-all in the toolbar is the
  same kind of checkbox as a row's and is ticked as soon as every visible row is. In a list
  where every row belongs to one conversation — after searching for that conversation, say —
  the app took that box for a row, and that row named no message. A drag of two ticked
  messages arrived as three rows: two mails and one refused with "Kon niet zien welk bericht
  deze rij is", while the strip read "2 van 3 opgeslagen". A tick now counts as a row only
  when a row encloses it.

### Voor ontwikkelaars
- **De fantoomrij is in de DOM gemeten, niet beredeneerd.** De console gaf voor twee
  aangevinkte mails drie treffers op `[role="checkbox"][aria-checked="true"]`, waarvan één
  zonder rij-voorouder. Dat sluit aan op de 26 eerdere sleepacties in `notify.log`: geen
  daarvan had een kale rij, en geen daarvan had een selectie binnen één gesprek — precies de
  voorwaarde die de werkbalk-checkbox nodig heeft om aan een threadId te komen, want
  `threadIdFromDragTarget` haakt alleen af als de zoektocht meer dan één id vindt.
  `selectedRows` slaat zo'n vakje nu over via `insideOneRow`, dat op `role="row"` matcht of
  op een voorouder die zelf het threadId draagt.
- **De rail is afgeleide staat, geen tweede waarheid.** `mailbox-rail.ts` bevat de vier pure
  functies erachter — `mailboxRows`, `pickedChips`, `firstPickable`, `localPart` — met eigen
  tests op de tellers, de zoektreffers en de volgorde van de chips. `mailboxRows` gebruikt
  dezelfde `filterLabels` als de lijst ernaast, zodat het getal in de rail niet uit elkaar
  kan lopen met wat je te zien krijgt.
- **De layout zelf is nog niet in een draaiende installatie bekeken.** De logica eronder is
  getest, de indeling is op maat nagebouwd — maar dat is niet hetzelfde als het ding zien
  werken. Daarom een beta.

## [0.3.1-beta.10] — 2026-08-18

### Toegevoegd
- **Opgeslagen mail wordt na drie dagen weggegooid.** De map waarin een sleep landt was een
  archief dat alleen groeide: er werd nooit iets opgeruimd, terwijl er volledige klantmail
  in staat, buiten Gmail, op een netwerkschijf. De app ruimt nu op bij het opstarten en
  daarna elke zes uur, zodat een computer die een week aan blijft staan niet alleen op de
  dag van opstarten opruimt. De leeftijd komt uit de datum in de mapnaam en niet uit de
  tijd van het bestand zelf, want die is op een omgeleide netwerkschijf niet te vertrouwen.

### Gewijzigd
- **In `log.jsonl` staat niet langer de inhoud van je mail.** Die log hield van elke
  opgeslagen mail de volledige tekst bij — een tweede kopie van elke mail die ooit door de
  app ging, op een schijf waar niemand mail verwacht, en hij bleef staan als de mails zelf
  al lang weg waren. De log houdt nu alleen bij *wat* er met een mail gebeurde: wanneer,
  welk postvak, welk gesprek, afzender, onderwerp en waar hij is neergezet. De tekst die
  eerdere versies er al in schreven wordt bij elke opruimronde uit de bestaande regels
  gehaald, ongeacht hoe oud ze zijn.

### Opgelost
- **Een sleep pakt het bericht dat je aanwijst, of hij zegt dat hij het niet kon.** Twee
  wegen leverden stil een mail op die je niet had aangewezen. Vinkte je drie berichten van
  hetzelfde gesprek aan, dan kon Gmail bij één van die regels niet zeggen welk bericht het
  was; daar sloeg de app dan het nieuwste bericht van dat gesprek op — een mail die een
  andere regel van diezelfde sleep al had opgeslagen. Zo werden drie aangevinkte mails er
  twee, met een dubbele. En sleepte je een ouder bericht uit een lang gesprek in een
  postvak zonder koppeling, dan kon dat bericht helemaal niet opgehaald worden en ging
  ook daar het nieuwste mee. Dat bericht wordt nu bij naam opgevraagd, en lukt het dan nog
  niet, dan meldt de balk "2 van 3 opgeslagen" in plaats van je een verkeerde mail te geven.

### Added
- **Saved mail is thrown away after three days.** The folder a drag lands in was an archive
  that only ever grew: nothing was ever removed, while it holds complete customer mail
  outside Gmail on a network share. The app now sweeps at startup and every six hours after,
  so a machine that stays on for a week does not only clean up on the day it was started.
  Age comes from the date in the folder name rather than the file's own timestamp, which on
  a redirected share is not to be trusted.

### Changed
- **`log.jsonl` no longer holds the content of your mail.** That log kept the full text of
  every mail saved — a second copy of every mail that ever passed through the app, on a
  share where nobody expects mail to be, still there long after the mails themselves were
  gone. It now records only *what* happened to a mail: when, which mailbox, which
  conversation, sender, subject and where it was put. Text that earlier versions already
  wrote is taken out of the existing lines on every sweep, however old they are.

### Fixed
- **A drag takes the message you point at, or says it could not.** Two routes silently
  handed over a mail you had not pointed at. With three messages of one conversation ticked,
  Gmail could not say which message one of those rows was, and the app saved that
  conversation's newest message for it — a mail another row of the same drag had already
  saved. Three ticked mails became two, with a duplicate. And dragging an older message out
  of a long conversation in a mailbox without a link, that message could not be fetched at
  all and the newest went along there too. That message is now asked for by name, and if it
  still cannot be found the strip reads "2 van 3 opgeslagen" instead of giving you the
  wrong mail.

### Voor ontwikkelaars
- **Beide sleepfouten zijn op productielogs gemeten, niet beredeneerd.** De eerste stond in
  een log als drie rijen van één gesprek waarvan de middelste geen `|msg-f:` in
  `data-thread-id` had; `itemsForDrag` markeert zo'n rij nu (`messageUnknown`) en
  `saveOneThread` weigert hem vóór het ophalen. Waaróm Gmail die rij zo rendert is nog niet
  gemeten — dit voorkomt de verkeerde mail, het haalt de goede nog niet op. De tweede stond
  er twee keer als `gesleept bericht niet in de conversatie gevonden`: de pagina-route
  refereert een ingeklapt gesprek niet volledig, dus `permMsgIdsToFetch` zet de id die de
  sleep draagt vooraan de lijst met op te halen berichtpagina's.
- **De logregels zeggen nu genoeg om dit zonder DOM-meting te lezen.** Een onleesbare rij
  krijgt `|?` in de `[drag]`-regel, en de terugval noemt het bericht dat hij koos — zonder
  dat laatste is uit een log niet te zien of twee rijen op dezelfde mail landden.
- **Het opruimen is twee pure functies plus één die schrijft.** `expiredEntries` en
  `logLinesWithoutBody` zijn getest op de termijngrens, op stempel-boven-mtime en op een
  regel die niet te parsen valt; `cleanMailDrop` draait in de tests tegen een echte
  tijdelijke map, omdat het de enige functie in de app is die iets verwijdert. `log.jsonl`
  wordt via een tijdelijk bestand en een rename herschreven, zodat een halve schrijfactie
  de log laat staan zoals hij was.

## [0.3.1-beta.9] — 2026-08-17

### Gewijzigd
- **Aan de app verandert in deze versie niets; er is alleen code weg die al niets meer
  deed.** Bijna 500 regels: een venster dat nog "Test" toonde en nooit werd geopend, twee
  hulpfuncties die overbleven toen de Outlook-sneltoetsen eruit gingen, dubbele varianten
  van code die elders al in een betere vorm stond, een kanaal tussen de twee helften van
  de app dat niemand ooit gebruikte, en zes teksten die nergens meer op het scherm komen.
  De tests draaien alle 1372 nog.

### Changed
- **Nothing about the app changes in this version; only code that had stopped doing
  anything is gone.** Close to 500 lines: a window that still read "Test" and was never
  opened, two helpers left behind when the Outlook shortcuts went, duplicate versions of
  code that already stood elsewhere in a better shape, a channel between the app's two
  halves that nobody ever sent on, and six strings that no longer reach the screen. All
  1372 tests still run.

### Voor ontwikkelaars
- **De hele boom is één keer nagelopen op dode einden.** Niet op gevoel: een importgraaf
  over alle 279 bestanden, `tsc` met `--noUnusedLocals --noUnusedParameters` over beide
  tsconfigs, en alle 87 IPC-kanalen, 245 UI-teksten en prefs-keys aan beide kanten
  geteld. Eruit: `src/sanity.ts` met zijn test en de `src`-regel in `tsconfig.json`;
  `electron/gmail/google-apps-open.ts`, een shim die na opruiming één re-export overhield
  terwijl `surface-opener.ts` al rechtstreeks uit `renderer/lib/` importeerde; het
  `SET_SNOOZE`-kanaal met zijn handler, want de tray regelt snooze in main zelf; de
  `labelFromDragTarget` in `dropzone.ts` die stil verloren had van die in
  `label-drop.ts`; en de vlag `ALWAYS_VISIBLE`, die alleen `false` kon zijn.
  Dekking is verhuisd in plaats van geschrapt: de trim-, ellipsis- en leeg-onderwerp-
  gevallen staan nu op `matchThreadsBySubject`, de orde- en dubbelen-gevallen op
  `filterPinned`. De 13 tests die wél verdwenen, hoorden bij weggehaalde code.
- **De avatar was drie keer nagebouwd en is nu één `renderer/app/Avatar.tsx`.**
  Compose-picker, toastkaart en de accountlijst in de instellingen tekenden alle drie
  hetzelfde rondje met dezelfde terugval op de eerste letter. Omdat de lijstversie in een
  `.map()` stond, hield die stukke foto's bij in een map (`brokenAvatars`); nu houdt elke
  avatar zijn eigen vlag bij en is die map weg. Eén verschil is bewust blijven staan: de
  instellingenrij neemt de letter van `p.name`, de compose-picker die van `a.label`.
  Blijven staan: `metadata` in `layout.tsx` (dat leest Next.js zelf), en de ruim honderd
  dingen die `export` zijn maar alleen in hun eigen bestand gebruikt worden.
  De opruiming zelf zit in commit `8e18e9c`.

## [0.3.1-beta.8] — 2026-08-17

### Opgelost
- **Meerdere mails tegelijk slepen pakt nu alle mails die je aanvinkte.** Staat je lijst
  op losse berichten in plaats van gesprekken, dan horen twee aangevinkte regels soms bij
  hetzelfde gesprek. De app hield die twee voor één mail: er verdween er één, en van de
  ander werd het nieuwste bericht van dat gesprek opgeslagen in plaats van de regel die je
  had aangevinkt. Elke aangevinkte regel staat nu voor zijn eigen bericht.
- **Een sleep die niet alles kon opslaan zegt dat nu ook.** Sleepte je drie mails en lukte
  er één niet, dan meldde de balk "2 berichten opgeslagen" — precies de tekst van een
  gelukte sleep. Er staat nu "2 van 3 opgeslagen".
- **Een label slepen haalt het hele label op.** Gmail vult zo'n lijst regel voor regel, en
  de app nam wat er op dat moment stond. Daardoor leverde hetzelfde label de ene keer twee
  mails op en de andere keer één. Er wordt nu gewacht tot de lijst compleet is.

### Fixed
- **Dragging several mails at once now takes every mail you ticked.** When your list shows
  separate messages instead of conversations, two ticked rows can belong to the same
  conversation. The app treated those two as one mail: one disappeared, and for the other
  it saved that conversation's newest message instead of the row you had ticked. Every
  ticked row now stands for its own message.
- **A drag that could not save everything now says so.** Drag three mails and have one
  fail, and the strip reported "2 berichten opgeslagen" — the wording of a drag that
  worked. It now reads "2 van 3 opgeslagen".
- **Dragging a label fetches the whole label.** Gmail fills such a list row by row, and the
  app took whatever stood there at that moment. The same label therefore yielded two mails
  one time and one the next. It now waits until the list is complete.

## [0.3.1-beta.7] — 2026-08-17

### Opgelost
- **De teller in de taakbalk telt geen postvakken meer mee die er niet zijn.** Bij het
  opstarten opent de app kort een venster per Google-account om te zien wie er is
  aangemeld en of er nieuwe delegaties bij zijn gekomen. Leverde zo'n ronde niets op,
  dan werd het venster weggegooid maar bleef het aantal ongelezen mail dat het had
  doorgegeven staan — bij niemand, en dus voor altijd. Elke keer opstarten legde er
  weer een paar bovenop, waardoor de teller te hoog stond en niet meer op nul kwam ook
  al had je alles gelezen. De teller houdt nu alleen de postvakken aan die je echt hebt.
- **De Google-koppeling zit weer in de installer.** Op een verse computer vroeg de app
  om zelf een configuratiebestand te importeren voordat je een account kon koppelen.
  De koppeling hoort standaard mee te komen, en dat doet ze nu weer.

### Fixed
- **The taskbar counter no longer counts mailboxes that are not there.** At startup the
  app briefly opens a window per Google account to see who is signed in and whether new
  delegations have appeared. When such a round came up empty the window was thrown away,
  but the unread count it had reported stayed behind — belonging to nobody, and therefore
  forever. Every startup piled on a few more, leaving the counter too high and unable to
  reach zero even with everything read. The counter now keeps only the mailboxes you
  actually have.
- **The Google link ships in the installer again.** On a fresh machine the app asked you
  to import a configuration file yourself before an account could be linked. That link is
  meant to come along by default, and it does again.

## [0.3.1-beta.5] — 2026-08-17

### Gewijzigd
- **De teller in de taakbalk schrijft op waar hij zijn getal vandaan haalt.** Alleen
  om te kunnen zien waarom hij soms te hoog staat of blijft hangen: bij elke
  verandering komt er een `[badge]`-regel in `notify.log` met per postvak het aantal
  en de bron ervan. Aan de teller zelf verandert niets.

### Changed
- **The taskbar counter records where its number comes from.** Purely to find out why
  it sometimes reads too high or stops moving: every change writes a `[badge]` line to
  `notify.log` naming each mailbox, its count and the source that reported it. The
  counter itself is unchanged.

## [0.3.1-beta.4] — 2026-08-13

### Gewijzigd
- **Alleen @abovomaxlead.nl-accounts worden aan Gmail gekoppeld.** Voeg je een
  privé-account toe, dan komt er geen toestemmingsvenster meer: het postvak staat
  gewoon in de zijbalk en je leest het als altijd, maar de app koppelt het niet aan
  de Gmail-API. Er verschijnt dus ook geen Verbinden-knop en geen melding
  rechtsonder die je vraagt iets te herstellen wat niet gekoppeld hoort te zijn.
  Een koppeling van vóór deze versie voor zo'n account wordt bij het opstarten
  ongedaan gemaakt.
- **"Blijft staan" staat voortaan uit bij elk postvak.** Een melding verdwijnt
  vanzelf na een paar tellen; blijven staan tot je hem wegklikt is iets wat je nu
  per postvak aanzet bij Instellingen → Meldingen. Ook postvakken die de
  schakelaar nooit hebben aangeraakt volgen de nieuwe stand.

### Opgelost
- **De sleepstrip verschijnt niet meer in een geopende mail.** De leesweergave
  hangt al haar berichten onder één conversatie, waardoor een streep tekst
  selecteren al gold als een sleep: de strip klapte uit en je selectie werd
  gewist. Slepen begint weer alleen in de lijst en op een label.
- **Een label slepen pakt nu de hele regel.** De link in de zijbalk zit alleen om
  de naam heen, dus greep je hem net ernaast — op het aantal, op de witruimte —
  dan zag de app geen label en bleef de strip weg; erger nog, de browser begon
  dan zijn eigen sleep van die link, en die slikt de muisbewegingen op waarmee de
  strip verschijnt. Vandaar dat het de eerste keer vaak misging en de tweede keer
  wel lukte. De regel om de link telt nu mee.

### Changed
- **Only @abovomaxlead.nl accounts are linked to Gmail.** Adding a personal
  account no longer brings up a consent screen: the mailbox sits in the sidebar and
  reads as it always did, but the app never links it to the Gmail API. That also
  means no Connect button and no banner in the corner asking you to repair a link
  that was never meant to exist. A link made before this version for such an
  account is undone at startup.
- **"Persist" is off for every mailbox now.** A notification fades on its own
  after a few seconds; staying up until you dismiss it is something you switch on
  per mailbox under Settings → Notifications. Mailboxes that never touched the
  toggle follow the new default too.

### Fixed
- **The drag strip no longer shows up inside an opened mail.** The reading view
  hangs every message under one conversation, so selecting a line of text already
  counted as a drag: the strip appeared and the selection was cleared. Dragging
  starts in the list and on a label again.
- **Dragging a label now takes the whole row.** The link in the sidebar wraps the
  name and nothing else, so grabbing just beside it — on the count, on the empty
  space — found no label and the strip stayed away; worse, the browser then
  started its own drag of that link, which swallows the mouse moves the strip is
  armed by. Hence the first attempt failing and the second one working. The row
  around the link counts now.


## [0.3.1-beta.2] — 2026-08-13

### Opgelost
- **Mail slepen uit een gedelegeerd postvak werkt.** Een sleep uit zo'n postvak
  gaf foutcode 403: de app viel terug op Gmail's eigen pagina, en die is zonder
  het `/d/<token>/`-deel van de url niet te bereiken — precies het deel dat een
  sleep niet meedraagt. De mail komt nu via de API binnen, met het token dat de
  relay voor dat postvak afgeeft. Geldt ook voor een heel label slepen.
- **Het venster na een mislukte sleep vraagt niet meer om een label.** Er is dan
  niets opgeslagen om te kopiëren, dus in plaats van labels waar je niets aan
  hebt staat er nu wat er misging.

### Fixed
- **Dragging mail out of a delegated mailbox works.** Such a drag returned error
  403: the app fell back to Gmail's own page, which cannot be reached without the
  `/d/<token>/` part of the url — exactly the part a drag does not carry. The mail
  now comes in through the API, on the token the relay issues for that mailbox.
  Dragging a whole label out of one is fixed with it.
- **The window after a failed drag no longer asks for a label.** Nothing was
  saved, so there is nothing to copy; it shows what went wrong instead of labels
  that cannot be used.


## [0.3.1-beta.1] — 2026-08-13

### Toegevoegd
- **Meldingen komen van Gmail zelf, en een klik opent de mail waar de melding
  over ging.** Gmail's eigen pagina meldt de nieuwe mail, de app vangt die op en
  vraagt de API welk bericht het was. Daardoor opent een kaartje precies dat
  bericht, in plaats van het nieuwste van de conversatie.
- **Gedelegeerde postvakken worden via de API gevonden** in plaats van uit de
  accountswitcher gelezen. Een postvak dat in Gmail nog één keer aangeklikt moet
  worden zegt dat er zelf bij, en een gedelegeerd postvak kan nu ook een doel zijn
  als je gesleepte mail kopieert.
- **Per account zie je of de Google-koppeling nog klopt.** Bij Instellingen →
  Accounts staat de status per account, met een knop om de koppeling te
  herstellen als er iets aan mankeert.
- **Een verse machine kan koppelen zonder handwerk.** De app heeft een standaard
  OAuth-config aan boord en accepteert daarnaast het bestand dat Google zelf laat
  downloaden — een oudere config wordt nooit over een nieuwere heen gezet.
- **De meldingenstapel heeft een donkere variant** en volgt het thema.
- **Een zoekbalk boven de labels** in het venster na een sleep. Wat je typt
  versmalt de kolom van elk account tegelijk; labels die je al aangevinkt hebt
  blijven staan, wat je ook zoekt.

### Opgelost
- **Een gesleepte conversatie komt aan als één mail** in plaats van als een map
  met een bericht per stuk.
- **Eén bericht slepen levert dat bericht op, niet het nieuwste van het
  gesprek.** Met gesprekweergave uit is elke regel in je lijst één bericht, en
  die sleep je nu ook als zodanig: de oudere staan er als citaat in, de reacties
  die er later op kwamen blijven achter — anders had je die wel gesleept. Sleep
  je een hele conversatie, dan blijft het bij het laatste bericht.
- **Rene-modus zoomt op 170%** in plaats van 200%.
- **Dubbele en verdwenen meldingen.** Gmail's eigen kanaal werd niet meer stil
  gezet, en elk kaartje komt uit één stapel in plaats van uit twee.
- **Een mail die in zijn eigen venster opent laat het hoofdvenster staan** waar
  het stond.
- **Een gedelegeerd postvak zonder opgeslagen url laat de app niet meer
  vastlopen**; hij weigert die weergave en zegt waarom.
- **Vijf defecten die tegen 0.3.0 gemeld waren**, en de gaten die de review over
  de hele branch aan het licht bracht.

### Added
- **Notifications now come from Gmail itself, and a click opens the mail the
  notification was about.** Gmail's own page announces the new mail, the app
  catches it and asks the API which message it was, so a card opens that message
  rather than the newest one in the conversation.
- **Delegated mailboxes are discovered through the API** instead of read out of
  the account switcher. A mailbox that still needs one click in Gmail says so
  itself, and a delegated mailbox can now be a target when copying dragged mail.
- **Each account shows whether its Google connection still holds**, under
  Settings → Accounts, with a button to repair it.
- **A fresh machine can link without hand-editing anything.** The app ships a
  default OAuth config and also accepts the file Google itself hands you — an
  older config is never written over a newer one.
- **The notification stack has a dark variant** and follows the theme.
- **A search box above the labels** in the window a drag opens. What you type
  narrows every account's column at once, and labels you already ticked stay in
  sight whatever you search for.

### Fixed
- **A dragged conversation arrives as one mail** instead of a folder holding one
  message per file.
- **Dragging one message yields that message, not the newest of its thread.**
  With conversation view off every row in the list is a single message, and it
  now travels as one: the older exchange is quoted inside it, the replies that
  came after it stay behind — you would have dragged one of those otherwise.
  Dragging a whole conversation still yields its last message.
- **Rene mode zooms to 170%** instead of 200%.
- **Duplicate and missing notifications.** Gmail's own channel is no longer
  silenced, and every card comes from one stack instead of two.
- **A mail that opens in its own window leaves the main window** where it was.
- **A delegated mailbox with no stored url no longer crashes the app**; it
  refuses that view and says why.
- **Five defects reported against 0.3.0**, plus the gaps the whole-branch review
  turned up.


## [0.3.0] — 2026-08-07

### Toegevoegd
- **Dropzone bovenaan Gmail om mail te bewaren.** Begin je een conversatie uit
  je berichtenlijst te slepen, dan verschijnt er bovenin een balk. Laat je 'm
  daar los, dan slaat de app elk bericht uit die conversatie op als `.eml` —
  het echte origineel, met alle headers — in een eigen mapje per conversatie.
  Heb je meerdere gesprekken aangevinkt, dan gaan ze allemaal mee.
  Daarnaast komt er per bericht een regel in `log.jsonl`: tijdstip, account,
  afzender, ontvangers, onderwerp, datum, bestandspad en de body als platte
  tekst. De balk meldt daarna hoeveel berichten er zijn opgeslagen, of wat er
  misging. De map kies je bij Instellingen → Algemeen; standaard is dat
  `Documenten\Gmail Desktop\Mail`.
- **Een heel label slepen.** Sleep een label uit de linkernavigatie naar de balk,
  dan komt alle mail uit dat label in één map te staan. Het opzoeken gebeurt in
  een verborgen venster, dus je postvak blijft staan waar het stond. Bij meer dan
  200 gesprekken stopt hij, en dat staat dan in het overzicht en in het log —
  niet stil afkappen.
- **Na een sleep verschijnt een venster** met wat er is opgeslagen, over Gmail
  heen zodat je postvak zichtbaar blijft.
- **Ctrl+Shift+I** opent de devtools van het venster waar je in werkt.
- **Gesleepte mail naar een ander account kopiëren.** Na een sleep kies je in het
  venster naar welke labels de mail toe moet, in elk gekoppeld account. Staat een
  bericht daar al, dan wordt er niets geschreven en vraagt de app eerst wat je
  wilt: alleen de nieuwe erbij, alles erbij, of niets. Herkenning gaat op de
  Message-ID uit de header, dus per label — staat een mail al in "Klanten" maar
  nog niet in "Offertes", dan komt hij alleen in die tweede terecht.
- **Meldingen en de ongelezen-teller komen van Gmail zelf** in plaats van uit de
  pagina te worden gelezen. Gmail meldt een wijziging, de app haalt op wat er
  veranderd is en telt de ongelezen gesprekken bij de bron. Dit vraagt eenmalige
  instelling (een eigen relay en een Pub/Sub-topic) en één keer opnieuw
  toestemming geven per account. Accounts waarvoor dat niet is ingesteld — en
  gedelegeerde postvakken, die geen eigen koppeling hebben — werken precies zoals
  eerst.
- **De accountbalk staat nu bovenaan** in plaats van in een kolom links, en is
  tegelijk de bovenrand van het venster. Elk account is een tabblad met zijn naam,
  het aantal ongelezen en een streepje in zijn eigen kleur. Rechtsklik op een
  tabblad voor de agenda en de andere Google-apps van dát account. De "+" staat
  achter het laatste tabblad, het tandwiel rechts.
- **Instellingen opnieuw ingedeeld:** vier onderdelen naast een navigatiekolom in
  plaats van vijf blokken onder elkaar. Welke meldingen je per account wilt staat
  nu bij Meldingen — daar zie je in één tabel welk account waarvoor piept, in
  plaats van vijf schakelaars per account. Accounts gaat over wie er meedoet: de
  naam, de kleur, en weghalen.

- **Elk account laadt zijn postvak bij het opstarten.** Je hoefde de tabbladen
  één voor één aan te klikken voordat de mail er stond. Nu laadt elk account bij
  het opstarten eenmalig zijn postvak op de achtergrond in, buiten beeld, zodat
  een tabblad er meteen staat als je het aanklikt. Daarna mag de weergave weer
  rusten, dus het kost geen geheugen dat de hele dag warm blijft — een tabblad dat
  je na lange tijd aanklikt kan zichzelf nog even bijwerken.
- **Eigen meldingen in plaats van Windows-meldingen.** Meldingen verschijnen nu
  rechtsonder in een eigen venster en stapelen wél: tot vijf kaartjes onder elkaar,
  en komt er een zesde bij, dan maakt de app er één melding van met het totaal
  erop. Ze blijven staan tot je ze wegklikt — dat deed Windows nooit, hoe vaak je
  het ook vroeg. Per account kun je dat uitzetten bij Instellingen → Meldingen;
  die meldingen verdwijnen dan na een paar tellen, en blijven staan zolang je
  muis erop staat. Beweeg je over een mailmelding, dan verschijnen Archiveren en
  Gelezen, zodat je een bericht kunt wegwerken zonder de app te openen.

### Gewijzigd
- **Nieuwe meldingsgeluiden.** De vijf geluidjes die de app zelf in elkaar zette met
  de Web Audio API zijn vervangen door vier echte geluidsbestanden: Melding 1 tot
  Melding 4, met Melding 1 als standaard. Had je Belsignaal, Ping, Arpeggio, Klop of
  Tik gekozen, dan bestaat dat geluid niet meer en valt je melding terug op het
  standaardgeluid — je hoort dus wel iets, maar iets anders dan eerst. Bij
  Instellingen → Meldingen kies je opnieuw, met de knop ernaast om te proefhoren.
- **"Altijd in een nieuw venster" gaat nu voor op een uitgesloten app.** Eerst won
  uitsluiten: een app op die lijst ging naar de browser, ook met nieuw-venster aan.
  Dat maakte de twee instellingen tegenstrijdig — je zette iets aan en de lijst
  eronder bleef doen alsof hij nog iets te zeggen had. Nu bepalen de hoofdschakelaars
  het voor alles, en heeft de uitsluitingslijst alleen iets te zeggen als ze beide uit
  staan. Had je een app uitgesloten én nieuw-venster aan, dan opent die app vanaf nu
  in de app in plaats van in je browser.
- **De instellingen hebben inhoud gekregen, tab voor tab.** Weergave (de getallen
  aan of uit, het tray-icoon, de ondergrens van het venster), Downloads (waar een
  download heen gaat, eerst vragen, map openen — de app handelde downloads tot nu
  toe helemaal niet af), Phishing Protection (de host laten zien voordat een link
  naar de browser gaat — waar de link écht heen gaat, niet de google.com-omleiding
  die Gmail om elke link zet — met een lijst die zichzelf vult als je "altijd goed"
  aanvinkt; over Google's eigen apps vraagt de app nooit, over de rest van
  google.com wel), Bijwerken, Geavanceerd
  (hardwareversnelling), Gmail (mail maken in een eigen venster en dat venster
  sluiten na verzenden), Google Apps (in de app of in de browser, per app een
  uitzondering, de naam en de kleur van het account op een appvenster), en bij
  Meldingen: afzender en onderwerp wel of niet in de melding, geluid, een testknop,
  en wat een klik op een download-melding doet.
- **Accounts is een kaart geworden.** Eén kaart per account met de naam, de pillen
  die zeggen wat je van dat account merkt, de kleuren, een potlood om de naam te
  wijzigen en een prullenbak. Je kan de kaarten slepen om de volgorde te veranderen,
  en de knop "Erbij" staat rechtsboven.
- **Saved Searches en License zijn uit de kolom.**
- **De instellingen zijn opnieuw ingericht.** Een kolom met negentien secties in
  drie groepen — wat je hebt gehaald, de voorkeuren zelf, en wat er over de app te
  lezen valt — naast één wit vlak met de sectie erin. De Bewaren-knop is weg: elke
  instelling legt zichzelf al meteen vast, dus de knop deed niets. Sluiten staat nu
  in de hoek van het vlak, met Esc eronder, en Esc werkt ook echt. De aan/uit-
  vakjes zijn schakelaars geworden.
- **Instellingen staan waar je ze zoekt.** Het thema staat bij Weergave, de map
  voor gesleepte mail bij Downloads, en wat een klik op een melding doet bij
  Meldingen in plaats van bij Algemeen. Bijwerken en "Wat is er nieuw" zijn eigen
  secties in plaats van blokken onder Over — het puntje dat zegt dat er een update
  klaarstaat, staat nu bij Bijwerken.
- **De standaard-mailclient is een schakelaar en geen knop.** Je kan hem nu ook
  weer uitzetten. Daarvoor claimde de app de mailto:-standaard bij elke start
  opnieuw, waardoor uitzetten geen zin had; dat doet hij niet meer. Wie de
  standaard al is blijft het — er wordt bij het opstarten niets weggehaald.
- **Nieuw: geminimaliseerd starten.** Bij Algemeen → Opstarten. De app komt dan op
  in de taakbalk in plaats van in beeld. Staat los van zelf opstarten, dus het
  werkt ook als je hem met de hand start.
- **Blocker en Unified Inbox zijn er weer uit**, nadat ze gebouwd waren: op verzoek
  volledig verwijderd, inclusief voorkeuren, kanalen en tests. Uit de Gmail-tab zijn
  het verbergen van het logo, de afwezigheidsbalk en de opslagknop ook weggehaald.
- **Verification Codes werkt, met één beperking.** De code wordt gelezen via de
  Gmail-API, dus alleen bij accounts die daarvoor gekoppeld zijn. Het naar de
  prullenbak verplaatsen en op gelezen zetten vraagt het recht `gmail.modify`, dat nu
  in de scopes staat — daardoor moet elk account eenmalig opnieuw toestemming geven.

### Opgelost
- **De lijst met uitgesloten Google-apps bleef aanklikbaar terwijl hij niets deed.**
  Beide hoofdschakelaars beslissen het al voor élke app: staat "Open in de app" uit,
  dan gaat alles naar je browser, en staat "Altijd in een nieuw venster" aan, dan
  krijgt alles zijn eigen venster in de app. In beide gevallen verandert het aanvinken
  van een app daar niets aan — dubbel werk dus. Die lijst is nu uitgeschakeld zolang
  één van de twee zo staat, met een regel erbij die zegt welke schakelaar het bepaalt.
  Je vinkjes blijven bewaard en gaan weer meedoen zodra beide schakelaars uit zijn.
- **Mail door deze app laten gaan werkte niet.** De schakelaar bij Instellingen →
  Algemeen kon de standaard helemaal niet zetten, en de app stond niet eens tussen
  de standaard-apps van Windows — daar was hij dus ook niet met de hand te kiezen.
  Windows bepaalt sinds versie 8 zelf welke app een mail-adres opent, en zet daar
  een ondertekend stempel op; geen enkele app kan daar omheen. De app meldt zich nu
  bij het opstarten aan als mailprogramma, zodat hij in de lijst van Windows
  verschijnt, en de schakelaar is een knop geworden die je rechtstreeks naar die
  lijst brengt. Eronder staat wat Windows er op dit moment van gemaakt heeft.
- **Hetzelfde label twee keer slepen lukte niet.** Na de eerste sleep bleef de
  labelnaam geselecteerd, en dan begon Chromium bij de volgende poging zijn eigen
  sleep van die selectie — waardoor de balk nooit verscheen. Alleen bij dat ene
  label, wat het extra verwarrend maakte.
- **Het "+"-menu liet Gmail verdwijnen.** Het menu werd in de app zelf getekend en
  moest daarvoor de mailweergave wegduwen. Het is nu een gewoon menu van Windows,
  dat er bovenop past, dus je postvak blijft staan.
- **Een label slepen duurde minuten.** De app bladerde daarvoor door Gmail's
  lijstweergave; nu vraagt hij het rechtstreeks op, vijf gesprekken tegelijk.

### Voor ontwikkelaars
- **Het commentaar in de code is teruggebracht van ruim 20% van alle regels naar
  3,8%.** De afspraak is nu: bovenaan een bestand staat één blok dat zegt waar het
  bestand voor is en welke valkuil er geldt, en daaronder staat geen enkele losse
  opmerking meer. Wat echt dragend is — Electron staat één webRequest-luisteraar per
  sessie toe, `getStartTime()` is secondes en geen milliseconden, Tailwind 3 heeft
  haakjes nodig bij een fractie-opacity — is naar die kop verhuisd in plaats van
  weggegooid. Alle koppen zijn Engels; `STRINGS_RENE` blijft Nederlands, want dat is
  de taal van de app in de Rene-stand en geen vergeten vertaling.
  Eén ding is er bij verloren: achter elk kanaal in `ipc.ts` stond een korte
  signatuur (`invoke()` met de vorm van het antwoord). Die staat nergens meer.
  De commit `f24dec1` heet "refactor(tests): enhance test descriptions" maar bevat
  in werkelijkheid deze hele opruiming over `electron/`, `renderer/` en `tests/`.
- `npm run dev` start alles met hot reload: wijzigingen in de zijbalk of de modal
  zijn direct zichtbaar, een nieuwe preload herlaadt alleen de Gmail-views, en
  alleen een wijziging in het main-proces herstart de app (automatisch).
- Push vraagt twee regels in `google-oauth.json` (`relayUrl`, `pushTopic`) en de
  relay uit `gmail-push-relay`. Zonder die regels blijft push uit en verandert er
  niets. `GMAIL_PUSH_RELAY_URL` en `GMAIL_PUSH_TOPIC` gaan voor, om tegen een
  lokale relay te testen.

### Added
- **A drop zone at the top of Gmail for keeping mail.** Start dragging a
  conversation out of your message list and a bar appears at the top. Drop it
  there and the app saves every message in that conversation as an `.eml` — the
  real original, headers and all — in its own folder per conversation. If you have
  several conversations ticked, they all come along. Each message also gets a line
  in `log.jsonl`: time, account, sender, recipients, subject, date, file path and
  the body as plain text. The bar then tells you how many messages were saved, or
  what went wrong. You pick the folder under Settings → General; the default is
  `Documents\Gmail Desktop\Mail`.
- **Dragging a whole label.** Drag a label from the left-hand navigation onto the
  bar and all the mail in it lands in one folder. At more than 200 conversations it
  stops, and says so in the summary and the log rather than truncating quietly.
- **After a drop a window appears** showing what was saved, over Gmail so your
  mailbox stays visible.
- **Ctrl+Shift+I** opens the devtools for the window you are working in.
- **Copying dragged mail to another account.** After a drop, pick which labels in
  which connected accounts the mail should go to. If a message is already there,
  nothing is written and the app asks first: add only the new ones, add everything,
  or nothing. Recognition uses the Message-ID from the header, so it works per
  label — if a mail is already in "Clients" but not in "Quotes", it lands only in
  the second.
- **Notifications and the unread count now come from Gmail itself** instead of
  being read off the page. Gmail reports a change, the app fetches what changed and
  counts unread conversations at the source. This needs one-time setup (your own
  relay and a Pub/Sub topic) and one re-authorisation per account. Accounts without
  that setup — and delegated mailboxes, which have no connection of their own —
  work exactly as before.
- **The account bar is now along the top** instead of in a column on the left, and
  doubles as the window's top edge. Each account is a tab with its name, its unread
  count and a line in its own colour. Right-click a tab for that account's calendar
  and other Google apps. The "+" sits after the last tab, the gear on the right.
- **Settings rearranged:** four parts beside a navigation column instead of five
  blocks stacked up. Which notifications you want per account now lives under
  Notifications, where one table shows you which account sounds off for what,
  instead of five switches per account. Accounts is about who takes part: the name,
  the colour, and removing one.

- **Every account loads its mailbox at startup.** You used to have to click the
  tabs one by one before the mail was there. Each account now loads its mailbox
  once at startup, in the background and off screen, so a tab is ready the moment
  you click it. The view is then allowed to rest again, so nothing stays warm all
  day taking up memory — a tab you click after a long while may still bring itself
  up to date.

### Changed
- **The settings tabs got their content, tab by tab.** Appearance (unread counts on
  or off, the tray icon, the window's minimum size), Downloads (where a download
  goes, ask first, open the folder — the app did not handle downloads at all until
  now), Phishing Protection (see the host before a link opens in your browser — where
  the link really goes, not the google.com redirect Gmail wraps around every link —
  with a trusted list that fills itself when you tick "always allow"; Google's own apps
  are never asked about, the rest of google.com is), Updates, Advanced (hardware
  acceleration), Gmail (compose in
  its own window, and closing that window after sending), Google Apps (in the app or
  in the browser, a per-app exception, the account's name and colour on an app
  window), and under Notifications: sender and subject in a notification or not,
  sound, a test button, and what clicking a download notification does.
- **Accounts is a card now.** One card per account with the name, chips saying what
  you notice from that account, the colours, a pencil to rename and a bin to remove.
  Cards can be dragged to reorder, and "Add" sits at the top right.
- **Saved Searches and License are gone from the column.**
- **Settings have been laid out again.** A column of nineteen sections in three
  groups — what you have downloaded, the preferences themselves, and what there is
  to read about the app — beside a single white surface holding the section. The
  Save button is gone: every setting already writes itself the moment you change it,
  so the button did nothing. Closing now sits in the corner of that surface with Esc
  under it, and Esc really does close it. The on/off boxes are switches now.
- **Settings sit where you look for them.** The theme is under Appearance, the
  folder for dragged mail under Downloads, and what a click on a notification does
  under Notifications instead of General. Updates and What's New are their own
  sections rather than blocks under About — the dot that says an update is waiting
  now sits on Updates.
- **The default mail client is a switch, not a button.** You can turn it back off
  now. The app used to reclaim the mailto: default on every start, which made
  turning it off pointless; it no longer does. If you already are the default you
  stay it — nothing is removed at startup.
- **New: launch minimized.** Under General → Startup. The app comes up in the
  taskbar instead of on screen. Independent of launching at login, so it works when
  you start it by hand too.
- **Eleven sections are there but do nothing yet** (Download History, Blocker,
  Gmail, Google Apps, Languages, Phishing Protection, Saved Searches, Unified Inbox,
  Verification Codes, License, Advanced). They say there is nothing to set rather
  than pretending otherwise.

### Fixed
- **Dragging the same label twice did not work.** After the first drag the label's
  name stayed selected, so on the next attempt Chromium started its own drag of
  that selection and the bar never appeared. Only for that one label, which made it
  all the more puzzling.
- **The "+" menu made Gmail disappear.** The menu was drawn inside the app, which
  meant pushing the mail view out of the way first. It is now an ordinary Windows
  menu that sits on top, so your mailbox stays put.
- **Dragging a label took minutes.** The app used to page through Gmail's list
  view; it now asks for the mail directly, five conversations at a time.

## [0.2.9] — 2026-07-29

### Toegevoegd
- **Rechtermuisknop-menu voor kopiëren en plakken.** Selecteer je tekst en klik
  je met de rechtermuisknop, dan krijg je nu een menu met Kopiëren en "Zoek … op
  Google". In een invulveld (bijvoorbeeld het opstelvenster of de zoekbalk van
  Gmail) staan ook Ongedaan maken, Opnieuw, Knippen, Plakken en Plakken zonder
  opmaak. Op een link kun je de koppeling kopiëren of in je browser openen, en op
  een afbeelding kun je de afbeelding of de koppeling ervan kopiëren. Werkt in de
  hele app: de zijbalk, Gmail, Agenda en losse venstertjes.

### Opgelost
- **Een bijlage in een nieuw venster openen verving je postvak.** Koos je bij een
  pdf (of een ander bestand) "openen in een nieuw venster", dan werd de bijlage
  in het bestaande postvak geladen: je inbox verdween en er was geen weg terug.
  Bijlagen openen nu in je standaardbrowser, buiten de app.

### Added
- **Right-click menu for copying and pasting.** Select text and right-click to
  get a menu with Copy and "Search Google for …". In an editable field (Gmail's
  compose window or search box, for instance) it also offers Undo, Redo, Cut,
  Paste and Paste without formatting. On a link you can copy the address or open
  it in your browser, and on an image you can copy the image or its address.
  Works throughout the app: the sidebar, Gmail, Calendar and pop-out windows.

### Fixed
- **Opening an attachment in a new window replaced your mailbox.** Choosing
  "open in a new window" for a PDF (or any other file) loaded the attachment into
  the existing mail view: the inbox disappeared with no way back. Attachments now
  open in your default browser, outside the app.

## [0.2.8] — 2026-07-15

### Toegevoegd
- **Meldingsgeluid per account aan/uit.** In Instellingen → Accounts heeft elke
  postbus nu een "Geluid"-vinkje. Zet je het uit, dan blijven de meldingen van
  die postbus gewoon zichtbaar op je bureaublad, maar zonder geluid. Handig voor
  bijvoorbeeld een gedeelde (gedelegeerde) postbus waarvan je de meldingen wel
  wilt zien maar niet wilt horen. Staat standaard aan, en werkt los van het
  cijfer op de taakbalk en van "Niet storen".

### Added
- **Per-account notification sound on/off.** In Settings → Accounts each mailbox
  now has a "Sound" checkbox. Turn it off and that mailbox's notifications still
  appear on your desktop, just without a sound. Handy for, say, a shared
  (delegated) mailbox whose notifications you want to see but not hear. On by
  default, and independent of the taskbar badge and of Do Not Disturb.

## [0.2.7] — 2026-07-15

### Opgelost
- **Het taakbalk-cijfer bleef hangen.** Het aantal ongelezen berichten op het
  app-icoon bleef soms op een oud getal staan, ook nadat alles gelezen was —
  bijvoorbeeld na het vernieuwen van een gedeelde postbus. Het cijfer klopt nu
  weer en verdwijnt zodra er niets ongelezen is.
- **Inloggen of verifiëren opende geen venster.** In plaats van een
  inlogvenster verscheen soms een Windows-melding ("Download een app om deze
  koppeling te openen"). Het inlogvenster opent nu gewoon, zodat je kunt
  inloggen en verifiëren.

### Fixed
- **The taskbar badge count got stuck.** The unread count on the app icon
  sometimes stayed on an old number even after everything was read — for
  example after a shared mailbox refreshed. The count is now correct again and
  clears as soon as nothing is unread.
- **Logging in or verifying opened no window.** Instead of a login window, a
  Windows dialog sometimes appeared ("Download an app to open this link"). The
  login window now opens as expected, so you can log in and verify.

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
