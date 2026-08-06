import { app, BrowserWindow, protocol, net, ipcMain, session, Menu, screen, dialog, shell, Notification, nativeTheme } from 'electron';
import { join } from 'node:path';
import { readFileSync, mkdirSync, writeFileSync, watch } from 'node:fs';
import { release } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Tray } from 'electron';
import { parseChangelog, type ChangelogVersion } from './changelog';
import { ProfileViewManager, type Profile, type Surface } from './profile-view-manager';
import { SURFACES, surfacesForRef } from '../renderer/lib/surfaces';
import { accountCountVisible } from '../renderer/lib/badge-visibility';
import { accountKey, parseAccountKey, type AccountRef } from './account-ref';
import { DelegatedStore, type StoredDelegate } from './delegated-store';
import {
  AccountCacheStore,
  seedable,
  rememberedOrder,
  type CachedAccount,
} from './account-cache';
import { SWITCHER_SCRAPE_JS, parseDelegatedEntries } from './delegation';
import { planDelegated } from './delegation-planner';
import { ColorStore } from './color-store';
import { RemovedStore } from './removed-store';
import { PrefsStore } from './prefs-store';
import { clampBoundsToDisplays } from './window-bounds';
import { colorForIndex } from './palette';
import { planNext } from './detection-planner';
import { WarmupTracker } from './view-warmup';
import { addAccountUrl } from './google-urls';
import { popupNativeMenu } from './native-menu';
import type { NativeMenuItem } from '../renderer/lib/native-menu';
import { applyBadge } from './badge-controller';
import { UnreadStore } from './unread-store';
import { shouldNotifyUpdate } from './update-notifier';
import {
  IPC,
  type MailDropPayload,
  type MailDropPreviewItem,
  type MailDropCopyTarget,
  type MailDropCopyAccountResult,
  type MailDropCopyResult,
  type MailDropCopyDuplicate,
} from './ipc';
import {
  normalizeTargets,
  copyTotal,
  groupDuplicates,
  duplicateIndex,
  labelsStillNeeded,
  newMessageCount,
  type DuplicateHit,
  type CopyMode,
} from './mail-copy';
import { parseHeaders, extractPlainText, htmlToText } from './eml';
import { writeThread, writeLabel, appendLog, displayName, type LogRecord, type SavedMessage } from './mail-archive';
import {
  labelListUrl,
  mergeThreads,
  LABEL_SCRAPE_JS,
  MAX_PAGES,
  MAX_THREADS,
  PAGE_SIZE,
  type LabelThread,
} from './label-drop';
import { fetchThreadEmls } from './mail-fetch';
import { NO_SUBJECT } from './dropzone';
import { shouldHideOnClose, createTray, updateTrayMenu, type TrayState, type TrayUpdateStatus } from './tray-controller';
import { autoUpdater } from 'electron-updater';
import { resolveShortcut, type KeyInput } from './shortcuts';
import { openCompose, openFullThreadWindow } from './compose-window';
import { parseMailto, extractMailtoFromArgv } from './mailto';
import { sortByOrder } from './account-order';
import {
  notificationsAllowed,
  notificationSilent,
  notificationPersist,
  wantsCalendarView,
  mergeNotificationsFromPanel,
} from './notification-policy';
import { updateCheckPopup } from './update-popup';
import { RENE_ZOOM_FACTOR, RENE_ZOOM_LEVEL } from './rene';
import { attachContextMenu, LABELS_NORMAL, LABELS_RENE } from './context-menu';
import { overlayOptions, supportsOverlay, supportsOverlayUpdate, windowBackground } from './titlebar';
import { OverlayView } from './overlay-view';
import { accountsNeedingReconnect, bannerBounds, type ReconnectAccount } from './oauth-health';
import {
  fetchLabels,
  fetchLabelId,
  listLabelThreadIds,
  fetchThreadRaw,
  insertMessage,
  messageExistsInLabel,
  watchMailbox,
  stopWatch,
  fetchProfileHistoryId,
  fetchHistoryPage,
  fetchMessageMeta,
  fetchInboxUnread,
  GmailHttpError,
  type AccountLabels,
  type MessageMeta,
} from './gmail-api';
import { mapLimit } from './concurrency';
import { OAuthStore } from './oauth-store';
import { connectAccount, accessTokenFor, forceRefresh } from './oauth-flow';
import { hasScopes, type OAuthConfig } from './google-oauth';
import { parsePushConfig, type PushConfig } from './push-config';
import { parseDelegatedConfig, type DelegatedConfig } from './delegated-config';
import { DelegatedTokenSource } from './delegated-token';
import { ownerFor } from './delegated-owner';
import { PushCoverage } from './push-coverage';
import { HistoryStore } from './history-store';
import { startPushManager } from './push-manager';
import { createSyncRunner } from './push-sync';

// WSL/WSLg has no usable GPU stack: Electron's GPU process fails to initialize
// and WSLg falls back to RDP "copy mode", leaving a black/degraded window. Force
// software rendering there so the dev window actually shows. Must be called
// before app 'ready'. No effect on the shipped Windows/macOS build.
if (process.platform === 'linux' && /microsoft|WSL/i.test(release())) {
  app.disableHardwareAcceleration();
}

const RENDERER_DIST = join(__dirname, '..', 'renderer', 'out');
const CHANGELOG_PATH = join(__dirname, '..', 'CHANGELOG.md');

// Read + parse the shipped CHANGELOG.md on demand. Returns [] if it's missing
// or unreadable so the "What's new" section simply hides rather than erroring.
function loadChangelog(): ChangelogVersion[] {
  try {
    return parseChangelog(readFileSync(CHANGELOG_PATH, 'utf8'));
  } catch {
    return [];
  }
}
const PRELOAD_PATH = join(__dirname, 'preload.js');
const SIDEBAR_PRELOAD_PATH = join(__dirname, 'sidebar-preload.js');
// Bundled app icon. Resolves to <project>/assets/icon.png in dev and to
// app.asar/assets/icon.png when packaged (assets/** is in electron-builder files).
const ICON_PATH = join(app.getAppPath(), 'assets', 'icon.png');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const OAUTH_CONFIG_PATH = join(app.getPath('userData'), 'google-oauth.json');
const PROBE_TIMEOUT_MS = 16000; // > preload identity poll window (~15s) so slow accounts aren't missed

let mainWindow: BrowserWindow | null = null;
let manager: ProfileViewManager | null = null;
let colors: ColorStore | null = null;
let removed: RemovedStore | null = null;
let delegated: DelegatedStore | null = null;
let prefs: PrefsStore | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let settingsPanelOpen = false;
let dropOverlay: OverlayView | null = null; // eigen view waarin de kopieermodal leeft
let lastDropPreview: MailDropPreviewItem[] = []; // laatste drop, zodat de modal het ook kan ophalen
// Eén weggeschreven bericht uit de laatste sleep. Het pad, want het kopiëren
// leest de bytes daarvandaan terug in plaats van ze in het geheugen te houden:
// een labelsleep van tweehonderd gesprekken met bijlagen is zo honderden
// megabytes. De Message-ID om te herkennen of hij aan de andere kant al staat,
// het onderwerp om dat te kunnen melden.
interface SavedRef {
  file: string;
  messageId: string;
  subject: string;
}
let lastDropSaved: SavedRef[] = [];
// Het account waaruit gesleept is. Dat account als kopieerdoel aanbieden zou
// alleen maar een duplicaat in hetzelfde postvak opleveren.
let lastDropSource = '';
let oauthTokens: OAuthStore | null = null;
let history: HistoryStore | null = null;
const coverage = new PushCoverage();
let pushManager: { stop(): void; refresh(): void } | null = null;
// Eén runner per account: die coalesceert samenvallende syncs voor dat account.
const syncRunners = new Map<string, { run(): Promise<void> }>();
let reconnectBanner: OverlayView | null = null; // blijvende melding voor accounts zonder werkende koppeling
let reconnectAccounts: ReconnectAccount[] = [];
let updateRequested = false; // user pressed "Update now" → auto-install once downloaded
let pendingTrayUpdateCheck = false; // a check started from the tray → announce the result in a popup
let lastUpdateStatus: Record<string, unknown> = { state: 'idle' };
let notifiedUpdateVersion: string | null = null; // last version we showed a notification for this session
let lastCheckBackground = false; // was the in-flight update check a background one?
let pendingMailto: string | null = null; // a mailto arrived before an inbox was live

const SESSION_PARTITION = 'persist:google';

const profiles: Profile[] = [];
const seenEmails = new Set<string>();
const unread = new UnreadStore(); // per-account unread counts, keyed by accountKey
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probingIndex: number | null = null;
// Index of a *visible* probe (the "+ add account" flow) awaiting identity, vs
// the hidden auto-detect probes. Lets us keep a freshly added account on screen
// and restore a real view if the add is cancelled/duplicate.
let visibleProbe: number | null = null;
let detectionStarted = false;
// De laatst bekende eigen accounts (accounts.json). Alleen om de balk meteen te
// kunnen tekenen: zolang een adres hierin staat en detectie het niet heeft
// teruggevonden, is het een herinnering en geen account. Een adres verdwijnt uit
// deze lijst zodra het bevestigd is (dan staat er een echt tabblad) of zodra
// detectie is uitgelopen (dan bestaat het niet meer).
let cachedAccounts: CachedAccount[] = [];
let accountCache: AccountCacheStore | null = null;
let accountCacheLoaded = false;
// De plek die elk onthouden adres in de balk had. Anders dan `cachedAccounts`
// blijft dit de hele sessie staan, ook na het uitlopen van detectie: het bevestigde
// account erft de plek van de tab die het vervangt, dus staat de balk vanaf het
// eerste beeld goed en verschuift er niets meer.
let seedOrder = new Map<string, number>();
// Voorvoegsel voor de sleutel van een voorlopige tab. Bewust anders dan `u<n>` en
// `d:<adres>`: zo kan een verborgen detectieprobe (die wél op `u<n>` meldt) nooit
// zijn ongelezen-teller of melding op een onthouden tab afleveren.
const SEED_KEY_PREFIX = 'seed:';
const seedKey = (email: string): string => `${SEED_KEY_PREFIX}${email}`;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return net.fetch(pathToFileURL(join(RENDERER_DIST, rel)).toString());
  });
}

// --- account identity helpers ---
// The view layer and IPC now route by accountKey; the authuser detection state
// machine and the (unchanged) renderer still speak integer index. All accounts
// are authuser today — delegated mailboxes arrive with the later tasks and
// carry their own ref — so index <-> key is a clean bijection here.
const authRef = (index: number): AccountRef => ({ kind: 'authuser', index });
const keyOf = (p: Profile): string => accountKey(p.ref);
const keyOfIndex = (index: number): string => accountKey(authRef(index));
const authIdx = (p: Profile): number => (p.ref.kind === 'authuser' ? p.ref.index : -1);
const idxOfKey = (key: string): number | null => {
  const parsed = parseAccountKey(key);
  return parsed.kind === 'authuser' ? parsed.index : null;
};

// Stable-ish color for a delegated mailbox (no authuser index to key off).
function colorForEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  return colorForIndex(Math.abs(h));
}

function delegatedProfileFor(d: StoredDelegate): Profile {
  const ref: AccountRef = {
    kind: 'delegated',
    email: d.email,
    mailUrl: d.mailUrl,
    calendarUrl: d.calendarUrl,
  };
  return {
    ref,
    kind: 'delegated',
    email: d.email,
    name: d.email, // no reliable display name from the switcher; email is honest
    avatarUrl: '',
    color: colors?.get(d.email) ?? colorForEmail(d.email),
  };
}

// Add sidebar profiles for every persisted delegated mailbox not already present
// (and not user-removed). Idempotent: skips emails already held as a profile.
function loadDelegatedProfiles(): void {
  if (!delegated) return;
  const fresh: Profile[] = [];
  for (const d of delegated.list()) {
    const email = d.email.toLowerCase();
    if (removed?.has(email)) continue;
    if (profiles.some((p) => p.email.toLowerCase() === email)) continue;
    const profile = delegatedProfileFor({ ...d, email });
    profiles.push(profile);
    fresh.push(profile);
  }
  if (fresh.length > 0) {
    pushProfiles();
    syncCalendarViews();
    // Ook een gedelegeerd postvak hoort er te staan zonder eerst een klik.
    for (const profile of fresh) warmAccount(profile);
  }
}

// Scan the /u/0 account switcher (hidden view) for delegated mailboxes.
// Best-effort (scrapes Google's ogs widget) — returns [] on any failure.
async function scanSwitcherEntries(): Promise<Array<{ email: string; mailUrl: string }>> {
  if (!manager) return [];
  const raw = await manager.scrapeSwitcher(keyOfIndex(0), SWITCHER_SCRAPE_JS).catch(() => []);
  return parseDelegatedEntries(raw).map((e) => ({ email: e.email, mailUrl: e.mailUrl }));
}

// New delegates from the switcher not already owned, removed, or present.
function suggestableDelegates(
  entries: Array<{ email: string; mailUrl: string }>,
  respectRemoved: boolean,
): Array<{ email: string; mailUrl: string }> {
  // Launch auto-suggest respects removals (don't nag); on-demand add does not,
  // so a previously-removed delegate can be re-added (which clears its removal).
  const removedKeys = respectRemoved ? (removed?.list().map((e) => `d:${e.toLowerCase()}`) ?? []) : [];
  return planDelegated(entries, [...seenEmails], removedKeys)
    .filter((e) => !profiles.some((p) => p.email.toLowerCase() === e.email))
    .map((e) => ({ email: e.email, mailUrl: e.mailUrl }));
}

async function scanDelegatedSuggestions(): Promise<Array<{ email: string; mailUrl: string }>> {
  // On-demand add: show all discoverable delegates, including previously removed.
  return suggestableDelegates(await scanSwitcherEntries(), false);
}

function pushDelegatedSuggestions(suggestions: Array<{ email: string; mailUrl: string }>): void {
  mainWindow?.webContents.send(IPC.DELEGATED_SUGGESTIONS, { suggestions });
}

// On launch: re-scan the switcher (hidden), refresh persisted /d/ URLs whose
// opaque token rotated (so stored mailboxes keep opening), and offer any newly
// discovered delegates as suggestions. Health check: a scan that finds fewer
// than we already hold is treated as "scrape probably broke" — we keep the
// store intact and skip refresh/suggestions rather than act on the emptiness.
let delegatedScanStarted = false;
async function refreshAndSuggestDelegated(): Promise<void> {
  if (!delegated || !manager) return;
  const entries = await scanSwitcherEntries();
  const stored = delegated.list();
  if (entries.length < stored.length) return; // likely broken scrape — don't touch anything
  const freshByEmail = new Map(entries.map((e) => [e.email.toLowerCase(), e.mailUrl]));
  let changed = false;
  for (const d of stored) {
    const fresh = freshByEmail.get(d.email.toLowerCase());
    if (!fresh || fresh === d.mailUrl) continue;
    delegated.upsert({ ...d, mailUrl: fresh }); // refresh the rotated token
    const p = profiles.find((x) => x.kind === 'delegated' && x.email.toLowerCase() === d.email.toLowerCase());
    if (p && p.ref.kind === 'delegated') {
      for (const s of SURFACES) manager.discardView(keyOf(p), s); // drop stale views; reload fresh on next show
      p.ref = { ...p.ref, mailUrl: fresh };
      changed = true;
    }
  }
  if (changed) pushProfiles();
  if (entries.length > 0) pushDelegatedSuggestions(suggestableDelegates(entries, true));
}

// Register a delegated mailbox (from click-through pick or an accepted
// suggestion): persist it, clear any prior removal, surface it, and show it.
function addDelegatedMailbox(email: string, mailUrl: string): void {
  if (!delegated) return;
  const e = email.trim().toLowerCase();
  if (!e || !mailUrl) return;
  if (profiles.some((p) => p.email.toLowerCase() === e)) return; // already have it
  removed?.remove(e); // an explicit add un-hides a previously removed mailbox
  const entry: StoredDelegate = { email: e, mailUrl, calendarUrl: null }; // calendar probe: Task 9
  delegated.upsert(entry);
  loadDelegatedProfiles(); // adds the profile + pushes to the sidebar
  showAccount({ kind: 'delegated', email: e, mailUrl, calendarUrl: null }, 'mail');
}

// Eén rij in de tabbalk. Dit is wat er over IPC.PROFILES_CHANGED gaat: de stabiele
// `key` waarop de zijbalk routeert, de `kind`, of er een agenda-surface is, de
// voorkeuren per account, en een afgeleide `index` (authuser-slot, -1 als er geen
// is) die index-gebaseerde helpers als het opstelvenster nog gebruiken.
interface TabRow {
  key: string;
  kind: AccountRef['kind'];
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  hasCalendar: boolean;
  order?: number;
  label?: string;
  // Gezet op een tab die uit accounts.json komt en door detectie nog niet is
  // bevestigd. Main opent er niets mee en rekent er niets aan toe; het staat mee
  // in de payload zodat de zijbalk hem desgewenst apart kan tonen.
  provisional?: boolean;
}

function decorate(list: Profile[]): TabRow[] {
  const confirmed: TabRow[] = list.map((p) => {
    const ap = prefs?.getAccount(p.email) ?? {};
    return {
      key: keyOf(p),
      kind: p.ref.kind,
      index: authIdx(p),
      email: p.email,
      name: p.name,
      avatarUrl: p.avatarUrl,
      color: p.color,
      hasCalendar: surfacesForRef(p.ref).includes('calendar'),
      // Een bevestigd account erft de plek die zijn voorlopige tab had, zodat de
      // balk niet verschuift op het moment dat detectie landt. Staat het adres niet
      // in de onthouden balk (een gedelegeerd postvak, of een nieuw account), dan
      // valt sortByOrder terug op de index zoals altijd.
      order: ap.order ?? seedOrder.get(p.email.toLowerCase()),
      label: ap.label,
    };
  });
  const seeds: TabRow[] = seedable(cachedAccounts, {
    confirmed: profiles.map((p) => p.email),
    removed: removed?.list() ?? [],
  }).map((c) => {
    const ap = prefs?.getAccount(c.email) ?? {};
    return {
      // Een sleutel die nergens anders kan voorkomen: geen view, teller, melding
      // of kopieerdoel kan er per ongeluk op uitkomen, want al die paden lopen
      // langs `profiles` en daar staat een voorlopig account niet in.
      key: seedKey(c.email),
      kind: 'authuser',
      index: -1, // geen sessieslot: dat is niet bewaard en wordt niet gegokt
      email: c.email,
      name: c.name,
      avatarUrl: c.avatarUrl,
      color: colors?.get(c.email) ?? c.color,
      hasCalendar: false, // zonder bevestigde identiteit is er geen surface om te openen
      order: ap.order ?? seedOrder.get(c.email),
      label: ap.label,
      provisional: true,
    };
  });
  return sortByOrder([...confirmed, ...seeds]);
}
function pushProfiles(): void {
  const rows = decorate([...profiles]);
  // Voorlopige tabs gaan mee: de balk staat daardoor vanaf het eerste beeld
  // compleet. De zijbalk mag er niets mee opstarten — zie `provisional` daar.
  mainWindow?.webContents.send(IPC.PROFILES_CHANGED, rows);
  saveAccountCache(rows);
  // De lijst is veranderd: opnieuw kijken of elk eigen account nog gekoppeld is.
  // Dit is ook de eerste controle na het opstarten — er valt niets te controleren
  // zolang er nog geen account bekend is.
  scheduleOAuthHealthCheck();
}
function pushUnread(): void {
  mainWindow?.webContents.send(IPC.UNREAD_CHANGED, unread.snapshot());
}
// De cache is precies wat de balk aan eigen accounts laat zien, in die volgorde:
// dan staat de balk bij de volgende start meteen goed. Gedelegeerde postbussen
// gaan niet mee — die hebben hun eigen bestand, met een echte URL erin.
function saveAccountCache(rows: TabRow[]): void {
  if (!accountCache) return;
  const own = rows.filter((r) => r.kind === 'authuser');
  // Nooit een lege lijst wegschrijven. Leeg betekent hier bijna altijd "detectie
  // heeft nog niets bevestigd" (opstarten, of uitgelogd bij Google), en dan zou dit
  // precies het bestand wissen dat de balk de volgende keer moet vullen. Het enige
  // geval waarin de lijst écht leeg hoort te zijn — de gebruiker haalt zijn laatste
  // account weg — gaat via removeAccount, dat het adres gericht verwijdert.
  if (own.length === 0) return;
  accountCache.save(
    own.map((r) => ({ email: r.email, name: r.name, avatarUrl: r.avatarUrl, color: r.color })),
  );
}
// Detectie is uitgelopen: verder zoeken levert niets meer op. Alles wat we uit de
// cache tekenden en niet is bevestigd, bestaat in deze sessie niet — weghalen, en
// het bestand gelijktrekken met wat er werkelijk staat. Zonder dit zou een account
// dat de gebruiker elders heeft uitgelogd bij elke start terugkomen.
function settleDetection(): void {
  probingIndex = null;
  cachedAccounts = [];
  pushProfiles();
}
// Accounts the user has opted out of the taskbar badge — any account (owned or
// delegated) whose badgeCount pref is off. accountCountVisible is the same
// predicate the account tab reads (renderer/lib/badge-visibility.ts), so the
// tab and the taskbar total can never disagree about which accounts count.
function excludedBadgeKeys(): Set<string> {
  const keys = new Set<string>();
  for (const p of profiles) {
    if (!accountCountVisible(prefs?.getAccount(p.email).badgeCount)) {
      keys.add(keyOf(p));
    }
  }
  return keys;
}
// Reflect the current unread total on the OS badge. On Windows the taskbar overlay
// icon is cleared explicitly when nothing is unread, since app.setBadgeCount's own
// 0-clear doesn't stick if the window was hidden to the tray when unread dropped —
// leaving a stale number until the next visible update.
function refreshBadge(): void {
  applyBadge(unread.snapshot(), (n) => app.setBadgeCount(n), excludedBadgeKeys(), () => {
    if (process.platform === 'win32') mainWindow?.setOverlayIcon(null, '');
  });
}
function pushPrefs(): void {
  if (prefs) mainWindow?.webContents.send(IPC.PREFS_CHANGED, prefs.getAll());
}
function pushDefaultMailStatus(): void {
  mainWindow?.webContents.send(IPC.MAIL_DEFAULT_STATUS, app.isDefaultProtocolClient('mailto'));
}

function clearProbeTimer(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
}

function probe(index: number): void {
  probingIndex = index;
  manager?.ensureView(authRef(index), 'mail', false); // hidden probe; identity arrives via onIdentity
  clearProbeTimer();
  // Never auto-discard index 0: it is the visible primary/login view and may take
  // arbitrarily long to sign in. Only forward probes (1+) get the discard timeout.
  if (index > 0) {
    probeTimer = setTimeout(() => {
      // No identity within the timeout: no account at this index. Discard and stop.
      manager?.discardView(keyOfIndex(index), 'mail');
      probeTimer = null;
      settleDetection(); // hier eindigt de reeks: wat nog voorlopig is, bestaat niet
    }, PROBE_TIMEOUT_MS);
  }
}

function onIdentity(index: number, identity: { email: string; name: string; avatarUrl: string }): void {
  // Ignore re-fired identity for an already-registered index: Gmail's SPA re-runs the
  // preload identity poll on full navigations, which would otherwise abort an in-flight
  // probe timer and spuriously advance/leak views.
  if (profiles.some((p) => authIdx(p) === index)) return;

  const email = identity?.email;
  const isVisibleAdd = visibleProbe === index;

  // Explicit "+"-add of a previously removed account un-hides it again.
  if (isVisibleAdd && email && removed!.has(email)) removed!.remove(email);

  // A hidden detect/redetect probe that lands on a removed account: skip it but
  // keep scanning later indexes (authuser indexes are contiguous).
  if (!isVisibleAdd && email && removed!.has(email)) {
    clearProbeTimer();
    probingIndex = null;
    manager?.discardView(keyOfIndex(index), 'mail');
    if (manager?.activeKey() == null && profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    probe(index + 1);
    return;
  }

  const decision = planNext([...seenEmails], index, identity);
  clearProbeTimer();
  probingIndex = null;
  if (decision.register && identity.email) {
    // Toevoegen via de "+" gaat alleen door als de Gmail-koppeling lukt, dus
    // vóór het registreren — anders zou het account er al staan en weer
    // weggehaald moeten worden. Delegated mailboxen komen hier niet langs; die
    // worden apart geregistreerd en hebben geen koppeling nodig.
    if (isVisibleAdd) {
      visibleProbe = null;
      void addAccountAfterConsent(index, identity, decision.stop);
      return;
    }
    registerAccount(index, identity);
    if (manager?.activeKey() == null) {
      // Nothing visible yet (e.g. the primary account was removed/skipped):
      // surface the first account we successfully register.
      switchSurface(index, 'mail');
    }
  } else if (index > 0) {
    manager?.discardView(keyOfIndex(index), 'mail'); // duplicate/empty probe view
    if (isVisibleAdd) {
      // Add cancelled or a duplicate account: fall back to a real view so the
      // user isn't left staring at a torn-down blank surface.
      visibleProbe = null;
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    }
  }
  if (!decision.stop) probe(index + 1);
  // Stoppen ná een leesbaar adres betekent: de reeks is uit (dubbel account of de
  // bovengrens), en dan heeft detectie alles gezien. Stoppen zonder adres betekent
  // alleen dat we déze pagina niet konden lezen; dat zegt niets over wat er verder
  // staat en mag dus niet gelden als "detectie is langsgeweest".
  else if (identity?.email) settleDetection();
}

// Zet een gedetecteerd authuser-account in de zijbalk.
function registerAccount(
  index: number,
  identity: { email: string; name: string; avatarUrl: string },
): void {
  seenEmails.add(identity.email);
  // If this same mailbox was showing as a delegated entry, the owned authuser
  // account supersedes it (same inbox) — drop the delegated duplicate.
  const dup = profiles.findIndex(
    (p) => p.kind === 'delegated' && p.email.toLowerCase() === identity.email.toLowerCase(),
  );
  if (dup !== -1) {
    for (const surface of SURFACES) manager?.discardView(keyOf(profiles[dup]), surface);
    profiles.splice(dup, 1);
  }
  const color = colors!.get(identity.email) ?? colorForIndex(index);
  const profile: Profile = {
    ref: authRef(index),
    kind: 'authuser',
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    color,
  };
  profiles.push(profile);
  profiles.sort((a, b) => authIdx(a) - authIdx(b));
  pushProfiles();
  refreshNotifyAllowed();
  startPush();
  syncCalendarViews();
  // Detectie heeft de view al aangemaakt, maar bedekt: laat hem zijn postvak
  // opbouwen zodat dit tabblad er straks meteen staat.
  warmAccount(profile);
}

// Een account dat met de "+" is toegevoegd komt er alleen in als de koppeling
// met de Gmail API lukt: zonder token kan het straks geen mail ontvangen uit een
// ander postvak, en dan is het account in deze app niets waard.
//
// Uitzondering: staat er geen client-id/secret in userData, dan is de koppeling
// helemaal niet ingesteld en zou blokkeren betekenen dat je geen enkel account
// meer kunt toevoegen. Dan gaat het toevoegen gewoon door.
async function addAccountAfterConsent(
  index: number,
  identity: { email: string; name: string; avatarUrl: string },
  stopProbing: boolean,
): Promise<void> {
  const email = identity.email;
  const cfg = oauthConfig();
  const needsConsent =
    cfg !== null && oauthTokens !== null && !oauthTokens.get(email) && !!mainWindow && !mainWindow.isDestroyed();

  if (needsConsent) {
    const result = await connectAccount(mainWindow!, SESSION_PARTITION, cfg!, oauthTokens!, email);
    if (!result.ok) {
      // Niet toevoegen: view weg, terug naar een bestaand account.
      manager?.discardView(keyOfIndex(index), 'mail');
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
      if (Notification.isSupported()) {
        new Notification({
          title: 'Account niet toegevoegd',
          body: `${email} is niet gekoppeld aan Gmail, dus het account is niet toegevoegd. ${result.error}`,
        }).show();
      }
      if (!stopProbing) probe(index + 1);
      else settleDetection();
      return;
    }
  }

  registerAccount(index, identity);
  switchSurface(index, 'mail');
  if (!stopProbing) probe(index + 1);
  else settleDetection();
}

function removeAccount(email: string): void {
  removed!.add(email); // persist so detection skips it from now on
  // Ook uit de onthouden balk, anders staat de tab bij de volgende start weer even
  // op het scherm voordat `removed` hem eruit filtert.
  accountCache?.remove(email);
  // Netjes afmelden, anders blijft Gmail nog tot een week publiceren voor een
  // client die er niet meer is. Bewust het opgeslagen access token en géén
  // accessTokenFor: die zou een verlopen token verlengen, en verlengen is precies
  // wat je niet wil voor een postvak dat de gebruiker net weggooide. Is het token
  // verlopen, dan mislukt dit en verloopt de watch binnen een week zelf — dat is
  // goedkoper dan een nieuwe token voor een verwijderd account.
  const stopToken = oauthTokens?.get(email)?.accessToken;
  if (stopToken) void stopWatch(stopToken).catch(() => undefined);
  history?.remove(email);
  coverage.forget(email);
  syncRunners.delete(email);
  // Het account gaat eruit, dus de API-toegang ook: een token laten staan voor
  // een postvak dat je niet meer in de app hebt is een geheim zonder doel.
  oauthTokens?.remove(email);
  const profile = profiles.find((p) => p.email === email);
  if (!profile) {
    // Geen profiel betekent: de gebruiker sloot een voorlopige tab. Er is niets af
    // te breken, maar de balk moet wel opnieuw — `removed` filtert hem nu weg.
    pushProfiles();
    return;
  }
  if (profile.kind === 'delegated') delegated?.remove(email); // stop persisting it
  const wasActive = manager?.activeKey() === keyOf(profile);
  profiles.splice(profiles.indexOf(profile), 1);
  seenEmails.delete(email);
  unread.forget(keyOf(profile));
  for (const surface of SURFACES) manager?.discardView(keyOf(profile), surface);
  pushProfiles();
  pushUnread();
  refreshBadge();
  // Nu het token weg is en het account uit de lijst: de verbinding voor dit adres
  // moet dicht, anders blijft de relay pushen voor een account dat de gebruiker
  // net verwijderd heeft. Hierna, want refresh() leest de lijst opnieuw.
  startPush();
  if (wasActive && profiles[0]) showAccount(profiles[0].ref, 'mail');
}

// Show an account's surface (creates the view lazily) and re-gate notifications.
function showAccount(ref: AccountRef, surface: Surface): void {
  manager?.show(ref, surface);
  // A first switch to an app surface just created its view; gate it right away
  // (the app surfaces never notify in v1) instead of on the next 60s tick.
  refreshNotifyAllowed();
  // Bewust géén startPush(): van view wisselen verandert de accountlijst niet.
  // Het kostte een synchrone readFileSync + JSON.parse bij elke wisseling, ook
  // voor iedereen zonder push, en een eerder definitief geweigerd account opende
  // bij elke wisseling opnieuw een relay-socket met een echte users.watch erachter.
  // De plekken waar de lijst wél verandert (registreren, verwijderen,
  // hertoestemming, voorkeuren) roepen het zelf aan.
  flushPendingMailto(); // an inbox is now live — run any queued mailto
}

// Welke view op dit moment de zichtbare is. Voor een tussendoortje dat zelf even
// een andere view nodig heeft (de scan van de accountwisselaar hieronder), zodat
// het de gebruiker daarna terugzet waar hij was. De manager houdt de actieve
// surface niet als los gegeven bij, dus vragen we het hem per surface.
function activeView(): { ref: AccountRef; surface: Surface } | null {
  const m = manager;
  const key = m?.activeKey();
  if (!m || !key) return null;
  const p = profiles.find((x) => keyOf(x) === key);
  const surface = SURFACES.find((s) => m.isShowing(key, s));
  return p && surface ? { ref: p.ref, surface } : null;
}

// Picks the authuser index to compose from for an incoming mailto. One account →
// that account; several → a native chooser (labels from prefs/name/email); none
// or cancelled → null.
function chooseComposeAccount(): number | null {
  const authusers = profiles.filter((p) => p.ref.kind === 'authuser');
  if (authusers.length === 0) return null;
  if (authusers.length === 1) return authIdx(authusers[0]);
  const labels = authusers.map((p) => prefs?.getAccount(p.email).label ?? p.name ?? p.email);
  const cancelId = labels.length;
  const chosen = dialog.showMessageBoxSync(mainWindow!, {
    type: 'question',
    title: 'New message',
    message: 'Send from which account?',
    buttons: [...labels, 'Cancel'],
    cancelId,
    defaultId: 0,
  });
  return chosen === cancelId ? null : authIdx(authusers[chosen]);
}

// Focuses the window, then composes from the chosen account. If no account/mail
// view is ready yet (e.g. cold start still logging in), queues until one is.
function dispatchMailto(mailtoUrl: string): void {
  const fields = parseMailto(mailtoUrl);
  if (!fields) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  const ready = manager?.activeKey() != null && profiles.some((p) => p.ref.kind === 'authuser');
  if (!ready) {
    pendingMailto = mailtoUrl;
    return;
  }
  const index = chooseComposeAccount();
  if (index == null) return;
  openCompose(index, fields);
}

function flushPendingMailto(): void {
  if (!pendingMailto) return;
  if (manager?.activeKey() == null) return; // still not ready
  const url = pendingMailto;
  pendingMailto = null;
  dispatchMailto(url);
}
// Authuser convenience used by the index-based detection state machine.
function switchSurface(index: number, surface: Surface): void {
  showAccount(authRef(index), surface);
}

function startDetection(): void {
  switchSurface(0, 'mail'); // visible; user logs in; onIdentity(0,...) drives the rest
}

function redetect(): void {
  clearProbeTimer();
  // Tear down a probe view still in flight so repeated re-detects don't orphan hidden views.
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  probingIndex = null;
  const maxIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) : -1;
  probe(maxIndex + 1);
}

function addAccount(): void {
  // Unlike redetect (hidden probe), open Google's add-session flow in a *visible*
  // view so the user can sign into a brand-new account. onIdentity registers it
  // once Gmail loads. No discard timer here — signing in can take a while.
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  const nextIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) + 1 : 0;
  probingIndex = nextIndex;
  visibleProbe = nextIndex;
  manager?.ensureView(authRef(nextIndex), 'mail', true, addAccountUrl());
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !prefs) return;
  const maximized = mainWindow.isMaximized();
  const b = mainWindow.getNormalBounds();
  prefs.setWindow({ width: b.width, height: b.height, x: b.x, y: b.y, maximized });
}
function scheduleSaveBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowBounds, 400);
}

// The shortcut always acts on the currently active view (queried from the
// manager), so the originating account identity isn't needed here.
function handleInput(input: KeyInput): void {
  const action = resolveShortcut(input);
  if (!action) return;
  if (action.type === 'devtools') {
    manager?.toggleDevTools();
  } else if (action.type === 'switch') {
    const ordered = [...profiles].sort((a, b) => (a.order ?? authIdx(a)) - (b.order ?? authIdx(b)));
    const target = ordered[action.n - 1];
    if (target) showAccount(target.ref, 'mail');
  } else if (action.type === 'compose') {
    const activeKey = manager?.activeKey();
    const active = activeKey ? idxOfKey(activeKey) : null;
    if (active != null) openCompose(active);
  } else if (action.type === 'zoom') {
    if (prefs?.getAll().reneMode) return; // Rene mode pins everything at 200%
    const activeKey = manager?.activeKey();
    if (activeKey == null) return;
    const current = manager!.getActiveZoomLevel();
    const level = action.dir === 'reset' ? 0 : current + (action.dir === 'in' ? 0.5 : -0.5);
    const clamped = Math.max(-3, Math.min(3, level));
    manager!.setZoomForKey(activeKey, clamped);
    const email = profiles.find((p) => keyOf(p) === activeKey)?.email;
    if (email) prefs!.setAccount(email, { zoom: clamped });
  }
}

// De overlay met de echte vensterknoppen moet meelopen met het thema en met de
// zoom van Rene-modus. Anders staan de knoppen donker-op-donker na een
// themawissel, of 40px hoog in een balk van 80px. Een andere guard dan bij het
// aanmaken van het venster: bijwerken kan alleen op Windows.
function applyTitleBarOverlay(): void {
  if (!prefs || !mainWindow || mainWindow.isDestroyed()) return;
  if (!supportsOverlayUpdate(process.platform)) return;
  const p = prefs.getAll();
  mainWindow.setTitleBarOverlay(
    overlayOptions(p.theme, nativeTheme.shouldUseDarkColors, p.reneMode),
  );
}

// Rene mode: zoom the topbar renderer and every Gmail/Calendar view to 200%
// (or restore factor 1 and each account's own stored zoom), then relayout so
// the content view clears the now-taller topbar.
function applyReneZoom(): void {
  if (!prefs || !mainWindow || mainWindow.isDestroyed()) return;
  const on = prefs.getAll().reneMode;
  mainWindow.webContents.setZoomFactor(on ? RENE_ZOOM_FACTOR : 1);
  applyTitleBarOverlay();
  for (const p of profiles) {
    manager?.setZoomForKey(keyOf(p), on ? RENE_ZOOM_LEVEL : prefs.getAccount(p.email).zoom ?? 0);
  }
  manager?.relayout();
}

let notifyTimer: ReturnType<typeof setInterval> | null = null;
function refreshNotifyAllowed(): void {
  if (!prefs) return;
  let p = prefs.getAll();
  const now = new Date();
  // Auto-expire a timed snooze on the minute tick so the gate reopens and the
  // tray label/checkbox don't keep showing a time that's already passed.
  if (p.notifications.dndUntil && now.getTime() >= p.notifications.dndUntil) {
    prefs.setNotifications({ ...p.notifications, dndUntil: undefined });
    p = prefs.getAll();
    pushPrefs();
    refreshTray();
  }
  for (const profile of profiles) {
    for (const surface of SURFACES) {
      manager?.pushNotifyAllowed(keyOf(profile), surface, {
        show: notificationsAllowed(p, profile.email, now, surface, coverage.has(profile.email)),
        silent: notificationSilent(p, profile.email, surface),
        persist: notificationPersist(p, profile.email),
      });
    }
  }
}

// De teller zoals de API hem geeft. Null betekent: onbekend gebleven, dan blijft
// staan wat er stond.
function reportApiUnread(email: string, count: number | null): void {
  if (count === null) return;
  // Spiegelbeeld van de guard in de webview-callback: viel de dekking weg tussen het
  // opvragen en het terugkomen van dit getal, dan is de paginatitel weer eigenaar en
  // zou dit een seconden oud getal over een verser zetten.
  if (!coverage.has(email)) return;
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return;
  unread.report(keyOf(profile), count);
  pushUnread();
  refreshBadge();
}

function startNotifyTimer(): void {
  if (notifyTimer) return;
  // Quiet-hours boundaries only change on the minute; re-evaluate each minute.
  notifyTimer = setInterval(refreshNotifyAllowed, 60_000);
}

// Bij het opstarten hoefde je vroeger elk account één keer aan te klikken voordat
// het postvak inlaadde: de mailview bestond al (detectie maakt hem aan), maar stond
// op setVisible(false) en gold daarmee als bedekt, en dan bouwt Gmail zijn
// berichtenlijst niet op. Elk account krijgt daarom eenmalig een warmloop buiten
// het venster, waarna de view weer koelt — zie view-warmup.ts en warm()/cool().
const warmup = new WarmupTracker();
let warmupTimer: ReturnType<typeof setInterval> | null = null;

function warmAccount(profile: Profile): void {
  if (!manager) return;
  const key = keyOf(profile);
  // Het actieve account laadt al in beeld; daar is niets voor te laden.
  if (manager.isShowing(key, 'mail')) return;
  if (!warmup.begin(key, Date.now())) return; // al bezig of al geweest
  manager.warm(profile.ref, 'mail');
  if (!warmupTimer) warmupTimer = setInterval(tickWarmup, 1000);
}

// Leest per lopende warmloop de paginatitel uit — het enige signaal dat zegt of
// het postvak echt staat — en koelt wat klaar is of zijn bovengrens haalt.
function tickWarmup(): void {
  const now = Date.now();
  for (const key of warmup.pending()) {
    // Geen manager meer (venster afgebroken): dan komt er ook geen titel, en loopt
    // elke warmloop op zijn bovengrens af. Zo stopt deze timer altijd zichzelf.
    if (warmup.verdict(key, manager?.titleOf(key, 'mail') ?? null, now) !== 'cool') continue;
    manager?.cool(key, 'mail');
    warmup.finish(key);
  }
  if (warmup.pending().length === 0 && warmupTimer) {
    clearInterval(warmupTimer);
    warmupTimer = null;
  }
}

// Keep a hidden calendar view alive for each account with calendar reminders
// enabled, so Google Calendar fires its native reminders in the background.
// Views for disabled accounts are torn down (unless currently shown) to free memory.
function syncCalendarViews(): void {
  if (!prefs || !manager) return;
  for (const profile of profiles) {
    const enabled = wantsCalendarView(prefs.getAll(), profile.email, profile.ref);
    if (enabled) {
      manager.ensureView(profile.ref, 'calendar', false);
    } else if (!manager.isShowing(keyOf(profile), 'calendar')) {
      manager.discardView(keyOf(profile), 'calendar');
    }
  }
  refreshNotifyAllowed(); // push flags to any newly created calendar views
}

// Lege pref = de standaardmap. PrefsStore kent `app` niet, dus dat wordt hier
// opgelost.
function mailDropFolder(): string {
  return prefs?.getAll().mailDrop.folder || join(app.getPath('documents'), 'Gmail Desktop', 'Mail');
}

// Een mail is naar de dropzone gesleept: haal via Gmail's eigen
// "origineel weergeven"-pagina de RFC822-bron van elk bericht in de
// conversatie op, schrijf die weg als .eml en log er een regel bij.
// Slaat één conversatie op. Geeft terug hoeveel berichten er gevonden zijn
// (`total`), hoeveel er daadwerkelijk zijn weggeschreven (`count`) en wat er
// terechtkwam (`saved` — daar leest het kopiëren uit terug), plus een reden als
// er niets van terechtkwam. Logregels schrijft hij zelf.
async function saveOneThread(
  ts: string,
  account: string,
  root: string,
  threadId: string,
  authuser: string,
  ik: string,
): Promise<{ count: number; total: number; error?: string; saved: SavedRef[] }> {
  const failed = (error: string, total = 0) => {
    // Het log is best-effort: is de map onschrijfbaar, dan blijft alleen de
    // melding in de strip over.
    try {
      appendLog(root, [{ ts, account, threadId, error }]);
    } catch {
      /* map niet schrijfbaar */
    }
    return { count: 0, total, error, saved: [] };
  };

  let result;
  try {
    result = await fetchThreadEmls(session.fromPartition('persist:google'), { threadId, authuser, ik });
  } catch (e) {
    return failed(`Ophalen mislukt (${(e as Error).message})`);
  }
  const fetched = result.messages;
  if (fetched.length === 0) {
    // Geen enkele download-link in Gmail's origineel-weergeven-pagina. Meestal
    // omdat Gmail het bericht daar niet kent (een concept bijvoorbeeld) en de
    // pagina in plaats daarvan een uitleg toont — die uitleg is een betere
    // foutmelding dan wat wij zelf kunnen verzinnen, en staat al in de taal van
    // de gebruiker.
    const uitleg = htmlToText(result.page.html).replace(/\s+/g, ' ').trim();
    // Een échte om-pagina zonder herkende link is een heel ander geval: dan is
    // de tekst lang en zegt hij niets. Bewaar die pagina om te onderzoeken.
    const kortEnDuidelijk = uitleg.length > 0 && uitleg.length <= 300;
    if (!kortEnDuidelijk) {
      const dump = join(root, `diagnose-om-${threadId}.html`);
      try {
        mkdirSync(root, { recursive: true });
        writeFileSync(dump, result.page.html, 'utf8');
      } catch {
        /* map niet schrijfbaar */
      }
      return failed(
        `Geen origineel gevonden (HTTP ${result.page.status}, ${result.page.html.length} tekens — pagina bewaard als ${dump})`,
      );
    }
    return failed(`Gmail: ${uitleg}`);
  }

  const ok: SavedMessage[] = [];
  const failedRecords: LogRecord[] = [];
  for (const f of fetched) {
    if (f.raw) ok.push({ raw: f.raw, headers: parseHeaders(f.raw.toString('utf8')) });
    else failedRecords.push({ ts, account, threadId, error: f.error ?? 'onbekende fout' });
  }
  if (ok.length === 0) return failed(fetched[0]?.error ?? 'Geen bericht opgehaald', fetched.length);

  let files: string[];
  try {
    files = writeThread(root, ts, ok);
  } catch {
    return failed(`Kan niet schrijven naar ${root}`, fetched.length);
  }

  const records: LogRecord[] = ok.map((m, i) => ({
    ts,
    account,
    threadId,
    messageId: m.headers.messageId,
    from: m.headers.from,
    to: m.headers.to,
    cc: m.headers.cc,
    subject: m.headers.subject,
    date: m.headers.date,
    file: files[i],
    bytes: m.raw.length,
    body: extractPlainText(m.raw.toString('utf8')),
  }));
  try {
    appendLog(root, [...records, ...failedRecords]);
  } catch {
    /* map niet schrijfbaar; de bestanden staan er wel */
  }
  return {
    count: ok.length,
    total: fetched.length,
    saved: savedRefs(root, files, ok),
  };
}

// writeThread/writeLabel geven de paden in dezelfde volgorde terug als de
// berichten die ze kregen, dus die twee zijn per index aan elkaar te knopen.
function savedRefs(root: string, files: string[], messages: SavedMessage[]): SavedRef[] {
  return messages.map((m, i) => ({
    file: join(root, files[i]),
    messageId: m.headers.messageId,
    subject: m.headers.subject || NO_SUBJECT,
  }));
}

// Hoeveel duplicaatcontroles tegelijk. Zoeken kost Gmail vijf eenheden per
// verzoek; bij een labelsleep zijn dit er honderden en achter elkaar duurt dat
// te lang om voor een ja-of-nee-vraag op te wachten.
const DUPLICATE_CHECK_LIMIT = 8;

// Welke berichten al in een doellabel staan. Herkenning op de Message-ID uit de
// header: dezelfde mail heeft in elk postvak een ander Gmail-id, maar dezelfde
// Message-ID.
//
// Een mislukte controle telt als "geen duplicaat": de vraag stellen op grond van
// een verzoek dat niet doorkwam is erger dan hem niet stellen, en het kopiëren
// erna meldt een echte storing alsnog.
async function findDuplicates(
  cfg: OAuthConfig,
  targets: MailDropCopyTarget[],
  saved: SavedRef[],
  // Het eigen totaal, niet dat van het kopiëren: controleren is één verzoek per
  // label, kopiëren één per account. Die twee tellingen lopen uiteen zodra er
  // meer dan één label per account is aangevinkt.
  onProgress: (done: number, total: number, email: string) => void,
): Promise<DuplicateHit[]> {
  if (!oauthTokens) return [];
  const tokens = new Map<string, string>();
  for (const t of targets) {
    const token = await accessTokenFor(cfg, oauthTokens, t.email);
    if (token) tokens.set(t.email, token);
  }

  const checks: Array<{ email: string; labelId: string; ref: SavedRef }> = [];
  for (const t of targets) {
    if (!tokens.has(t.email)) continue; // geen token: het kopiëren meldt dat zo meteen
    for (const labelId of t.labelIds) {
      // Alleen berichten met een Message-ID; zonder valt niets te vergelijken.
      for (const ref of saved) if (ref.messageId.trim()) checks.push({ email: t.email, labelId, ref });
    }
  }

  let done = 0;
  const hits = await mapLimit(checks, DUPLICATE_CHECK_LIMIT, async (c) => {
    let exists = false;
    try {
      exists = await messageExistsInLabel(tokens.get(c.email)!, c.ref.messageId, c.labelId);
    } catch {
      // Zie boven: bij twijfel niet vragen.
    }
    onProgress((done += 1), checks.length, c.email);
    return exists
      ? {
          email: c.email,
          labelId: c.labelId,
          messageId: c.ref.messageId,
          subject: c.ref.subject,
        }
      : null;
  });
  return hits.filter((h) => h !== null);
}

// De uitslag van de laatste controle, zodat "Alleen nieuwe kopiëren" niet
// dezelfde honderden zoekopdrachten nog eens doet. Hoort bij één sleep en één
// set doelen; verandert er iets, dan is de sleutel anders en zoeken we opnieuw.
let lastScan: { key: string; hits: DuplicateHit[] } | null = null;
let dropSerial = 0;

function scanKey(targets: MailDropCopyTarget[]): string {
  return `${dropSerial}|${JSON.stringify(targets)}`;
}

// Toont de modal in een eigen view bovenóp Gmail. Die view is precies zo groot
// als het modalvenster, dus Gmail blijft eromheen zichtbaar en de Gmail-views
// worden nooit verborgen. Zie overlay-view.ts.
function openDropPreview(items: MailDropPreviewItem[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!dropOverlay) {
    dropOverlay = new OverlayView(
      mainWindow,
      SIDEBAR_PRELOAD_PATH,
      DEV_URL ? `${DEV_URL}/maildrop` : 'app://bundle/maildrop.html',
      IPC.MAIL_DROP_PREVIEW,
    );
  }
  lastDropPreview = items;
  dropOverlay.open({ items });
}

// Client-id en -secret staan in userData, niet in de repo: de repo is publiek en
// dit hoort daar niet in te belanden. Bij elke aanroep opnieuw gelezen, zodat je
// het bestand kunt neerzetten zonder de app te herstarten.
function oauthConfig(): OAuthConfig | null {
  try {
    const raw = JSON.parse(readFileSync(OAUTH_CONFIG_PATH, 'utf8'));
    if (typeof raw?.clientId === 'string' && typeof raw?.clientSecret === 'string') {
      return { clientId: raw.clientId, clientSecret: raw.clientSecret };
    }
  } catch {
    // Bestand ontbreekt of is onleesbaar: dan is de koppeling simpelweg niet
    // ingesteld, en dan blokkeert het toevoegen van een account niet.
  }
  return null;
}

// Uit hetzelfde bestand als de client-id, en net als daar bij elke aanroep
// opnieuw gelezen: zo kun je de relay-regels neerzetten zonder te herstarten.
function pushConfig(): PushConfig | null {
  try {
    return parsePushConfig(JSON.parse(readFileSync(OAUTH_CONFIG_PATH, 'utf8')), process.env);
  } catch {
    // Bestand ontbreekt of is onleesbaar: dan is push simpelweg niet ingesteld.
    return parsePushConfig(null, process.env);
  }
}

// Same file as the client id, and re-read per call for the same reason as
// pushConfig above: you can add the line without restarting the app.
function delegatedConfig(): DelegatedConfig | null {
  try {
    return parseDelegatedConfig(JSON.parse(readFileSync(OAUTH_CONFIG_PATH, 'utf8')), process.env);
  } catch {
    // File missing or unreadable: then this is simply not configured.
    return parseDelegatedConfig(null, process.env);
  }
}

function isDelegatedAccount(email: string): boolean {
  return profiles.some(
    (p) => p.kind === 'delegated' && p.email.toLowerCase() === email.toLowerCase(),
  );
}

// The relay checks whether the *requester* is a delegate of the mailbox, so the
// request has to go out as the account that actually holds the delegation.
// Google's own url says which one that is; if it cannot be resolved, try the
// connected accounts, because a wrong guess earns a clean 403 and nothing worse.
async function ownerTokenFor(mailbox: string): Promise<string | null> {
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  const p = profiles.find(
    (x) => x.kind === 'delegated' && x.email.toLowerCase() === mailbox.toLowerCase(),
  );
  const authusers = profiles
    .filter((x) => x.ref.kind === 'authuser')
    .map((x) => ({ index: x.ref.kind === 'authuser' ? x.ref.index : -1, email: x.email }));
  const owner = p && p.ref.kind === 'delegated' ? ownerFor(p.ref.mailUrl, authusers) : null;
  for (const email of owner ? [owner] : authusers.map((a) => a.email)) {
    const token = await accessTokenFor(cfg, oauthTokens, email);
    if (token) return token;
  }
  return null;
}

// Tokens for delegated mailboxes, minted by the relay. Null when nothing is
// configured — then delegated mailboxes have no labels and cannot be copied to,
// exactly as before. Rebuilt when the url changes, which also empties the token
// cache: pointing the app at another relay must not reuse the old one's tokens.
let delegatedTokens: DelegatedTokenSource | null = null;
let delegatedTokenUrl = '';

function delegatedSource(): DelegatedTokenSource | null {
  const cfg = delegatedConfig();
  if (!cfg) {
    delegatedTokens = null;
    delegatedTokenUrl = '';
    return null;
  }
  if (!delegatedTokens || delegatedTokenUrl !== cfg.tokenUrl) {
    delegatedTokenUrl = cfg.tokenUrl;
    delegatedTokens = new DelegatedTokenSource({
      tokenUrl: cfg.tokenUrl,
      ownerToken: ownerTokenFor,
      log: (msg) => console.log(msg),
    });
  }
  return delegatedTokens;
}

// One place that decides where an account's token comes from: OAuth for your own
// accounts, the relay for delegated mailboxes. Every call site that used to call
// accessTokenFor directly goes through here, so none of them needs to know which
// kind of account it is holding.
async function tokenForAccount(email: string): Promise<string | null> {
  if (isDelegatedAccount(email)) {
    const src = delegatedSource();
    return src ? src.get(email) : null;
  }
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  return accessTokenFor(cfg, oauthTokens, email);
}

// What to do when Google answers 401. For a delegated mailbox that means "mint
// again" — there is no refresh token in an impersonation flow — and for your own
// accounts it means the refresh we already did.
async function renewTokenFor(email: string): Promise<string | null> {
  if (isDelegatedAccount(email)) {
    const src = delegatedSource();
    return src ? src.forceMint(email) : null;
  }
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  return forceRefresh(cfg, oauthTokens, email);
}

// De controle hangt aan wijzigingen in de accountlijst: zo loopt hij zodra het
// eerste account bekend is, in plaats van na een vaste wachttijd. Tijdens de
// detectie registreren accounts één voor één, dus even wachten tot het stil is —
// anders gaat hij vier keer achter elkaar langs dezelfde lijst.
let healthTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleOAuthHealthCheck(): void {
  if (healthTimer) clearTimeout(healthTimer);
  healthTimer = setTimeout(() => void checkOAuthHealth(), 1500);
}

// Accounts waarvan het verversen van het token is mislukt. Alleen zo weten we of
// een koppeling echt weg is: dat blijkt pas als Google het refresh token weigert
// (in testmodus na zeven dagen).
const refreshFailures = new Set<string>();

// Accounts waarvan de relay het token definitief heeft geweigerd (4401, ook na
// een verse verversing). Push staat voor die accounts uit tot er nieuwe
// toestemming is, en de melding is het enige dat dat vertelt. Weer leeg zodra
// hertoestemming binnen is.
const pushRefusals = new Set<string>();

// Kijkt van elk eigen account of de koppeling nog werkt, en toont of verbergt de
// melding. Draait bij het opstarten en daarna periodiek; een geldig token wordt
// alleen aangeraakt als het bijna verlopen is.
async function checkOAuthHealth(): Promise<void> {
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens || !mainWindow || mainWindow.isDestroyed()) return;

  const ownEmails = profiles.filter((p) => p.kind === 'authuser').map((p) => p.email);
  for (const email of ownEmails) {
    const token = oauthTokens.get(email);
    if (!token) continue; // heeft geen token: telt hieronder al mee
    // Alleen echt verversen als het nodig is; accessTokenFor doet dat zelf en
    // geeft null terug als het mislukt.
    const fresh = await accessTokenFor(cfg, oauthTokens, email);
    if (fresh) refreshFailures.delete(email);
    else refreshFailures.add(email);
  }

  const needing = accountsNeedingReconnect({
    ownEmails,
    hasToken: (e) => oauthTokens!.get(e) !== undefined,
    refreshFailed: (e) => refreshFailures.has(e),
    // Een ontbrekende scope is alleen een probleem voor push. Staat push niet
    // ingesteld, dan werkt de app precies zoals eerst en is er niets om over te
    // melden — anders kreeg iedereen na deze update een blijvende melding over
    // iets dat op zijn machine helemaal niet bestaat.
    pushConfigured: pushConfig() !== null,
    missingScopes: (e) => {
      const token = oauthTokens!.get(e);
      return token !== undefined && !hasScopes(token);
    },
    pushRefused: (e) => pushRefusals.has(e),
  });
  showReconnectBanner(needing);
}

// De melding blijft staan tot elk account weer verbonden is: er zit geen
// sluitknop op. Verdwijnt van zelf zodra de lijst leeg is.
function showReconnectBanner(accounts: ReconnectAccount[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (accounts.length === 0) {
    reconnectBanner?.close();
    reconnectAccounts = [];
    return;
  }
  reconnectAccounts = accounts;
  if (!reconnectBanner) {
    reconnectBanner = new OverlayView(
      mainWindow,
      SIDEBAR_PRELOAD_PATH,
      DEV_URL ? `${DEV_URL}/reconnect` : 'app://bundle/reconnect.html',
      IPC.OAUTH_RECONNECT_LIST,
      bannerBounds,
    );
  }
  if (reconnectBanner.isOpen()) reconnectBanner.update({ accounts }, accounts.length);
  else reconnectBanner.open({ accounts }, accounts.length);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Somt de conversaties in een label op door Gmail's eigen lijstweergave te
// bladeren in een verborgen view. Er is geen API voor: dit leest dezelfde
// onderwerp-spans als de losse sleep. Stopt zodra een pagina niets nieuws meer
// oplevert (Gmail toont bij een te hoog paginanummer de laatste pagina opnieuw)
// of bij MAX_THREADS.
async function collectLabelThreads(
  ref: AccountRef,
  authuser: string,
  label: string,
): Promise<{ threads: LabelThread[]; capped: boolean }> {
  const threads: LabelThread[] = [];
  let capped = false;
  if (!manager) return { threads, capped };

  await manager.withHiddenView(labelListUrl(authuser, label, 1), async (wc) => {
    let firstOfPrevious = '';
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) {
        const hash = new URL(labelListUrl(authuser, label, page)).hash;
        await wc.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => null);
      }
      // Wachten tot de lijst er staat — en bij het bladeren tot hij écht is
      // verwisseld, anders lezen we de vorige pagina nog een keer.
      let pageThreads: LabelThread[] = [];
      for (let tries = 0; tries < 25; tries++) {
        await delay(400);
        pageThreads = (await wc.executeJavaScript(LABEL_SCRAPE_JS).catch(() => [])) as LabelThread[];
        if (pageThreads.length > 0 && pageThreads[0].threadId !== firstOfPrevious) break;
      }
      if (pageThreads.length === 0) break;
      firstOfPrevious = pageThreads[0].threadId;

      const { added, total } = mergeThreads(threads, pageThreads);
      if (total >= MAX_THREADS) {
        capped = pageThreads.length >= PAGE_SIZE;
        break;
      }
      if (added === 0) break;
    }
  });
  return { threads, capped };
}

// Eén gesprek uit een labelsleep, met wat eruit kwam of waarom niet.
interface CollectedThread {
  thread: LabelThread;
  messages: SavedMessage[];
  error?: string;
}

// Hoeveel gesprekken tegelijk bij de API. Gmail rekent threads.get als tien
// eenheden en staat er 250 per seconde toe, dus vijf tegelijk zit daar ruim
// onder terwijl het wel het verschil maakt tussen tien seconden en een minuut.
const THREAD_FETCH_LIMIT = 5;

// De gesprekken van een label via de Gmail API. Null betekent: hier niet te
// doen — geen koppeling, token afgekeurd, of dit label bestaat niet onder deze
// naam. Dan blijft het bladeren door Gmail's eigen lijstweergave over.
async function collectLabelViaApi(
  account: string,
  label: string,
): Promise<{ collected: CollectedThread[]; capped: boolean } | null> {
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens || !account) return null;
  const first = await accessTokenFor(cfg, oauthTokens, account);
  if (!first) return null;
  let token: string = first;

  // Eén keer verversen als Google het token alsnog afkeurt; daarna is opnieuw
  // toestemming geven het enige dat rest en gaan we terug naar de oude weg.
  let mayRefresh = true;
  const refreshed = async (e: unknown): Promise<boolean> => {
    if (!mayRefresh || !(e instanceof GmailHttpError) || e.status !== 401) return false;
    mayRefresh = false;
    const fresh = await forceRefresh(cfg, oauthTokens!, account);
    if (!fresh) {
      refreshFailures.add(account);
      scheduleOAuthHealthCheck();
      return false;
    }
    token = fresh;
    refreshFailures.delete(account);
    return true;
  };

  let list: { threadIds: string[]; capped: boolean };
  try {
    let labelId = await fetchLabelId(token, label).catch(async (e) => {
      if (!(await refreshed(e))) throw e;
      return fetchLabelId(token, label);
    });
    if (!labelId) return null;
    list = await listLabelThreadIds(token, labelId, MAX_THREADS);
  } catch {
    return null;
  }

  const collected = await mapLimit(list.threadIds, THREAD_FETCH_LIMIT, async (threadId) => {
    const read = async (): Promise<CollectedThread> => {
      const raws = await fetchThreadRaw(token, threadId);
      const messages: SavedMessage[] = raws.map((raw) => ({
        raw,
        headers: parseHeaders(raw.toString('utf8')),
      }));
      return {
        // Het onderwerp komt uit het bericht zelf en niet uit de lijst, dus het
        // klopt ook als Gmail de rij inmiddels anders toont.
        thread: { threadId, subject: messages[0]?.headers.subject || NO_SUBJECT },
        messages,
        error: messages.length === 0 ? 'Geen bericht in dit gesprek' : undefined,
      };
    };
    try {
      return await read();
    } catch (e) {
      if (await refreshed(e)) {
        try {
          return await read();
        } catch (e2) {
          e = e2;
        }
      }
      return {
        thread: { threadId, subject: '' },
        messages: [],
        error: `Ophalen mislukt (${(e as Error).message})`,
      };
    }
  });
  return { collected, capped: list.capped };
}

// Een hele labelsleep: alle gesprekken ophalen en in één map wegschrijven.
async function saveLabel(
  ts: string,
  account: string,
  root: string,
  ref: AccountRef,
  label: string,
  authuser: string,
  ik: string,
): Promise<{ items: MailDropPreviewItem[]; saved: SavedRef[] }> {
  const empty = () => {
    const error = `Geen mail gevonden in label "${label}"`;
    try {
      appendLog(root, [{ ts, account, threadId: '', label, error }]);
    } catch {
      /* map niet schrijfbaar */
    }
    return { items: [{ threadId: '', subject: label, saved: 0, error }], saved: [] };
  };

  // Liefst via de API: dat is één verzoek per gesprek in plaats van seconden
  // wachten per pagina tot Gmail's lijstweergave is omgeklapt. Lukt dat niet
  // (geen koppeling, gedelegeerd postvak), dan de oude weg.
  const viaApi = await collectLabelViaApi(account, label);
  let collected: CollectedThread[];
  let capped: boolean;

  if (viaApi) {
    if (viaApi.collected.length === 0) return empty();
    collected = viaApi.collected;
    capped = viaApi.capped;
  } else {
    const scraped = await collectLabelThreads(ref, authuser, label);
    if (scraped.threads.length === 0) return empty();
    capped = scraped.capped;

    // Alles eerst ophalen, dan in één keer wegschrijven: writeLabel maakt één map
    // en nummert de bestanden over de gesprekken heen door.
    collected = [];
    for (const thread of scraped.threads) {
      try {
        const result = await fetchThreadEmls(session.fromPartition(SESSION_PARTITION), {
          threadId: thread.threadId,
          authuser,
          ik,
        });
        const messages: SavedMessage[] = [];
        for (const f of result.messages) {
          if (f.raw) messages.push({ raw: f.raw, headers: parseHeaders(f.raw.toString('utf8')) });
        }
        if (messages.length === 0) {
          const uitleg = htmlToText(result.page.html).replace(/\s+/g, ' ').trim();
          collected.push({
            thread,
            messages: [],
            error: uitleg && uitleg.length <= 300 ? `Gmail: ${uitleg}` : 'Geen origineel gevonden',
          });
        } else {
          collected.push({ thread, messages });
        }
      } catch (e) {
        collected.push({ thread, messages: [], error: `Ophalen mislukt (${(e as Error).message})` });
      }
    }
  }

  const flat = collected.flatMap((c) => c.messages);
  let files: string[] = [];
  try {
    files = writeLabel(root, ts, label, flat);
  } catch {
    const error = `Kan niet schrijven naar ${root}`;
    return {
      items: collected.map((c) => ({
        threadId: c.thread.threadId,
        subject: c.thread.subject,
        saved: 0,
        error,
      })),
      saved: [],
    };
  }

  // Logregels in dezelfde volgorde als de weggeschreven bestanden.
  const records: LogRecord[] = [];
  let fileIndex = 0;
  for (const c of collected) {
    if (c.messages.length === 0) {
      records.push({ ts, account, threadId: c.thread.threadId, label, error: c.error });
      continue;
    }
    for (const m of c.messages) {
      records.push({
        ts,
        account,
        threadId: c.thread.threadId,
        label,
        messageId: m.headers.messageId,
        from: m.headers.from,
        to: m.headers.to,
        cc: m.headers.cc,
        subject: m.headers.subject,
        date: m.headers.date,
        file: files[fileIndex++],
        bytes: m.raw.length,
        body: extractPlainText(m.raw.toString('utf8')),
      });
    }
  }
  if (capped) {
    records.push({
      ts,
      account,
      threadId: '',
      label,
      error: `Afgekapt op ${MAX_THREADS} gesprekken; het label bevat er meer`,
    });
  }
  try {
    appendLog(root, records);
  } catch {
    /* map niet schrijfbaar; de bestanden staan er wel */
  }

  const items = collected.map((c) => ({
    threadId: c.thread.threadId,
    subject: c.thread.subject,
    saved: c.messages.length,
    error: c.error,
  }));
  if (capped) {
    items.push({
      threadId: '',
      subject: `Afgekapt op ${MAX_THREADS} gesprekken`,
      saved: 0,
      error: 'Het label bevat meer mail dan in één sleep wordt opgehaald',
    });
  }
  return { items, saved: savedRefs(root, files, flat) };
}

async function handleMailDrop(acctKey: string, payload: MailDropPayload): Promise<void> {
  const ts = new Date().toISOString();
  const account = profiles.find((p) => keyOf(p) === acctKey)?.email ?? '';
  const root = mailDropFolder();
  const items = payload?.items ?? [];
  if (items.length === 0 && !payload?.label) return;
  // Een nieuwe sleep vervangt de vorige: de modal die zo opengaat hoort bij
  // déze mail, niet bij wat er de vorige keer is opgeslagen.
  lastDropSaved = [];
  // Andere mail, dus de uitslag van de vorige duplicaatcontrole zegt niets meer.
  dropSerial += 1;
  lastDropSource = account;
  if (!payload.ik) {
    const error = 'Kon Gmail-token niet lezen';
    try {
      appendLog(root, items.map(({ threadId }) => ({ ts, account, threadId, error })));
    } catch {
      /* map niet schrijfbaar */
    }
    manager?.sendDropResult(acctKey, { ok: false, count: 0, total: 0, error });
    openDropPreview(
      items.length > 0
        ? items.map((i) => ({ ...i, saved: 0, error }))
        : [{ threadId: '', subject: payload.label ?? '', saved: 0, error }],
    );
    return;
  }

  // Een gesleept label: main zoekt zelf op wat erin zit en zet alles in één map.
  if (payload.label) {
    const profile = profiles.find((p) => keyOf(p) === acctKey);
    if (!profile) return;
    const { items: done, saved: refs } = await saveLabel(
      ts,
      account,
      root,
      profile.ref,
      payload.label,
      payload.authuser,
      payload.ik,
    );
    lastDropSaved = refs;
    const saved = done.reduce((n, i) => n + i.saved, 0);
    manager?.sendDropResult(
      acctKey,
      saved === 0
        ? { ok: false, count: 0, total: done.length, error: done[0]?.error ?? 'Niets opgeslagen' }
        : { ok: true, count: saved, total: saved },
    );
    openDropPreview(done);
    return;
  }

  // Eén voor één: Gmail's origineel-weergeven-pagina is geen API, dus liever
  // netjes achter elkaar dan een handvol gelijktijdige requests.
  const done: MailDropPreviewItem[] = [];
  let count = 0;
  let total = 0;
  let lastError: string | undefined;
  for (const item of items) {
    const r = await saveOneThread(ts, account, root, item.threadId, payload.authuser, payload.ik);
    count += r.count;
    total += r.total;
    if (r.error) lastError = r.error;
    lastDropSaved.push(...r.saved);
    done.push({ ...item, saved: r.count, error: r.error });
  }
  manager?.sendDropResult(
    acctKey,
    count === 0
      ? { ok: false, count: 0, total, error: lastError ?? 'Niets opgeslagen' }
      : { ok: true, count, total },
  );
  // Pas nu de modal: hij toont wat er daadwerkelijk is opgeslagen, niet wat we
  // van plan waren.
  openDropPreview(done);
}

// Let op dist-electron/preload.js en herlaadt de views bij een nieuwe versie.
// esbuild schrijft het bestand soms in meerdere gebeurtenissen, dus even wachten
// tot het stil is voordat we herladen.
function watchPreloadForReload(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(PRELOAD_PATH, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => manager?.reloadAll(), 250);
    });
  } catch {
    // Bestand bestaat nog niet of het platform kan niet kijken — dan gewoon niet.
  }
}

// Wat er moet gebeuren als een melding wordt aangeklikt. Getild uit de callback
// die aan ProfileViewManager gaat, zodat de meldingen die de app zelf maakt
// (push) er precies hetzelfde in kunnen: één gedrag, één plek.
function activateNotification(accountKey: string, surface: Surface, threadId?: string): void {
  const idx = idxOfKey(accountKey);
  // The main window may have been torn down (some setups actually destroy it
  // on close rather than hiding to the tray) while hidden views still fire
  // events. Rebuild it so a notification click brings the app back instead of
  // crashing on a destroyed window. Skip while quitting (don't resurrect).
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (isQuitting) return;
    detectionStarted = false;
    createWindow();
    return;
  }
  // Een melding uit een view die bij geen enkel tabblad hoort — een verborgen
  // detectieprobe — mag geen account activeren: welk postvak op dat slot staat is
  // nog niet vastgesteld, dus zou de app een onbevestigd postvak openen onder de
  // naam die de balk daar toont.
  if (!profiles.some((p) => keyOf(p) === accountKey)) return;
  // The app opens the clicked thread itself; Gmail's own click handler may
  // fire window.open with the same thread right after — suppress that
  // (genuine pop-out windows are exempted in windowOpenAction).
  if (threadId && surface === 'mail') manager?.markNotificationClickHandled(accountKey, 'mail');
  const windowMode = prefs?.getAll().notificationOpen === 'window';
  // "Open in a new window" mode: open the thread in the mail view so Gmail's
  // own pop-out button exists, then trigger it for a focused reading window.
  // Fall back to a full thread window if the button can't be found.
  if (threadId && surface === 'mail' && windowMode) {
    manager?.openMailThread(accountKey, threadId);
    void manager?.popOutThread(accountKey).then((ok) => {
      if (!ok && idx != null) openFullThreadWindow(idx, threadId);
    });
    return;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (settingsPanelOpen) {
    settingsPanelOpen = false;
    mainWindow?.webContents.send(IPC.SETTINGS_FORCE_CLOSE);
  }
  if (idx != null) switchSurface(idx, surface);
  // "In the app" mode: also open the clicked thread in that mail view.
  if (threadId && surface === 'mail') manager?.openMailThread(accountKey, threadId);
}

// Een melding voor één nieuw bericht, langs dezelfde weg als die van de webview:
// zelfde geluid- en blijven-staan-voorkeuren, en dezelfde klikbehandeling. De
// gate zelf is hierboven al gedaan — notificationsAllowed geldt ook voor push,
// alleen dan zonder de pushCovered-vlag, want die dooft juist de webview.
function notifyNewMail(email: string, meta: MessageMeta): void {
  if (!prefs || !Notification.isSupported()) return;
  // Spiegelbeeld van de guard in reportApiUnread: viel de dekking weg tussen de
  // history-doorloop en dit moment, dan meldt de webview alweer zelf en zou dit
  // een tweede melding voor hetzelfde bericht zijn.
  if (!coverage.has(email)) return;
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return;
  const p = prefs.getAll();
  const now = new Date();
  if (!notificationsAllowed(p, email, now, 'mail')) return;
  const n = new Notification({
    title: displayName(meta.from) || email,
    body: meta.subject || NO_SUBJECT,
    silent: notificationSilent(p, email, 'mail'),
    // Blijven staan tot de gebruiker hem wegklikt, als dat aanstaat.
    timeoutType: notificationPersist(p, email) ? 'never' : 'default',
  });
  n.on('click', () => activateNotification(keyOf(profile), 'mail', meta.threadId));
  n.show();
}

// Eén runner per account, zodat samenvallende syncs voor hetzelfde account
// gecoalesceerd worden en die van verschillende accounts elkaar niet ophouden.
function syncRunnerFor(email: string): { run(): Promise<void> } | null {
  const existing = syncRunners.get(email);
  if (existing) return existing;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens || !history) return null;

  // Elke aanroep vraagt opnieuw een token: tussen twee syncs kan er een uur
  // zitten en dan is het oude verlopen.
  const withToken = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    const token = await accessTokenFor(cfg, oauthTokens!, email);
    if (!token) throw new Error('geen token');
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
      const fresh = await forceRefresh(cfg, oauthTokens!, email);
      if (!fresh) {
        refreshFailures.add(email);
        scheduleOAuthHealthCheck();
        throw e;
      }
      refreshFailures.delete(email);
      return await fn(fresh);
    }
  };

  const runner = createSyncRunner({
    client: {
      profileHistoryId: () => withToken((t) => fetchProfileHistoryId(t)),
      historyPage: (start, pageToken) => withToken((t) => fetchHistoryPage(t, start, pageToken)),
      messageMeta: (id) => withToken((t) => fetchMessageMeta(t, id)),
      inboxUnread: () => withToken((t) => fetchInboxUnread(t)),
    },
    cursor: {
      get: () => history!.get(email),
      set: (id) => history!.set(email, id),
    },
    coveredSince: () => coverage.since(email),
    isExpiredCursor: (e) => e instanceof GmailHttpError && e.status === 404,
    onOutcome: (outcome) => {
      reportApiUnread(email, outcome.unread);
      for (const meta of outcome.notify) notifyNewMail(email, meta);
    },
    onError: (e) => console.warn(`[push] sync mislukte voor ${email}:`, e),
  });
  syncRunners.set(email, runner);
  return runner;
}

// Welke accounts push kán dekken: eigen accounts met een token dat de vereiste
// scopes heeft. Een gedelegeerd postvak heeft geen eigen token en blijft dus de
// webview gebruiken.
function pushableEmails(): string[] {
  if (!oauthTokens) return [];
  return profiles
    .filter((p) => p.kind === 'authuser')
    .map((p) => p.email)
    .filter((email) => {
      const token = oauthTokens!.get(email);
      return token !== undefined && hasScopes(token);
    });
}

function startPush(): void {
  if (pushManager) {
    pushManager.refresh();
    return;
  }
  const config = pushConfig();
  if (!config) return; // niet ingesteld: alles blijft zoals het was
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return;

  pushManager = startPushManager({
    config,
    accounts: pushableEmails,
    accessToken: (email) => accessTokenFor(cfg, oauthTokens!, email),
    // Voor de ene herkansing na een 4401. Bewust forceRefresh en niet
    // accessTokenFor: die laatste geeft het opgeslagen token terug zolang onze
    // eigen klok zegt dat het nog geldig is, en dat is precies het token dat net
    // geweigerd is. Het verse token wordt opgeslagen, dus de nieuwe handdruk
    // pakt het via de gewone weg op.
    refreshToken: async (email) => {
      const fresh = await forceRefresh(cfg, oauthTokens!, email);
      if (fresh) refreshFailures.delete(email);
      else refreshFailures.add(email);
      return fresh;
    },
    armWatch: async (email) => {
      const token = await accessTokenFor(cfg, oauthTokens!, email);
      if (!token) return false;
      try {
        return (await watchMailbox(token, config.pushTopic)) !== null;
      } catch (e) {
        console.warn(`[push] watch mislukte voor ${email}:`, e);
        return false;
      }
    },
    onSync: (email) => void syncRunnerFor(email)?.run(),
    onCoverage: (email, covered) => {
      if (covered) {
        coverage.cover(email);
        // Push werkt weer voor dit account, dus een eerdere weigering is
        // geschiedenis en de melding erover moet weg. Kan ook zonder dat de
        // gebruiker op "Verbind" drukte: elke refresh() laat een geweigerd
        // account het opnieuw proberen.
        if (pushRefusals.delete(email)) scheduleOAuthHealthCheck();
      } else coverage.drop(email);
      // De webview moet meteen weten of hij mag melden, en de teller wisselt
      // van eigenaar.
      refreshNotifyAllowed();
    },
    onFatal: (email, code) => {
      console.warn(`[push] push definitief uit voor ${email} (code ${code})`);
      // 4401 betekent: Google keurde dit token af, en de manager heeft het al één
      // keer met een vers token overgedaan. Alleen nieuwe toestemming helpt nog,
      // en dus moet de gebruiker het weten: zonder deze regel valt push stil en
      // vertelt niets het, want het token bestaat, ververst prima en heeft zijn
      // scopes — de gezondheidscontrole ziet er van zichzelf niets aan.
      if (code === 4401) {
        pushRefusals.add(email);
        void checkOAuthHealth();
      }
    },
  });
}

function createWindow(): void {
  prefs = new PrefsStore(join(app.getPath('userData'), 'prefs.json'));
  const stored = prefs.getAll().window;
  const bounds = clampBoundsToDisplays(
    { width: stored.width, height: stored.height, x: stored.x, y: stored.y },
    screen.getAllDisplays().map((d) => ({ bounds: d.bounds })),
  );
  // De topbar ís de titelbalk: Electron tekent de echte vensterknoppen als
  // overlay bovenop onze balk. Alleen op Windows en macOS — op Linux houden we
  // het native frame omdat er onder WSL ontwikkeld wordt en de app daar niet mag
  // omvallen, niet omdat de overlay er zou ontbreken.
  const frameless = supportsOverlay(process.platform)
    ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: overlayOptions(
          prefs.getAll().theme,
          nativeTheme.shouldUseDarkColors,
          prefs.getAll().reneMode,
        ),
      }
    : {};
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    backgroundColor: windowBackground(prefs.getAll().theme, nativeTheme.shouldUseDarkColors),
    icon: ICON_PATH,
    // Een bodem voor de vensterbreedte. Zonder dit is het venster smaller te
    // slepen dan de balk aankan: onder ongeveer 236px klapt de reservering van de
    // tabstrook naar nul en schuift het tandwiel onder de vensterknoppen-overlay,
    // waar niets meer aan te klikken is. 800px is ruim boven die grens en is ook
    // wat Gmail zelf nodig heeft voor een bruikbare inbox.
    minWidth: 800,
    ...frameless,
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
  });
  if (stored.maximized) mainWindow.maximize();
  // Re-assert the badge when the window returns to the taskbar: an overlay clear
  // issued while hidden to the tray doesn't stick, so Windows would otherwise show
  // a stale count on restore until the next unread update.
  mainWindow.on('show', refreshBadge);
  mainWindow.on('restore', refreshBadge);
  colors = new ColorStore(join(app.getPath('userData'), 'colors.json'));
  oauthTokens = new OAuthStore(join(app.getPath('userData'), 'google-tokens.json'));
  history = new HistoryStore(join(app.getPath('userData'), 'gmail-history.json'));
  removed = new RemovedStore(join(app.getPath('userData'), 'removed.json'));
  delegated = new DelegatedStore(join(app.getPath('userData'), 'delegated.json'));
  accountCache = new AccountCacheStore(join(app.getPath('userData'), 'accounts.json'));
  // Eén keer per proces inlezen. Wordt het venster later opnieuw opgebouwd (een
  // aangeklikte melding kan dat doen), dan is detectie al langs geweest en zou
  // opnieuw inlezen accounts terugzetten die toen juist zijn afgevallen.
  if (!accountCacheLoaded) {
    accountCacheLoaded = true;
    cachedAccounts = accountCache.list();
    seedOrder = rememberedOrder(cachedAccounts);
  }
  manager = new ProfileViewManager(
    mainWindow,
    PRELOAD_PATH,
    (accountKey, count) => {
      // Eén bron per account. Is het account door push gedekt, dan komt de
      // teller uit labels.get en zou de paginatitel hem alleen overschrijven —
      // twee bronnen die om hetzelfde getal vechten laten het heen en weer
      // springen. Bij een teruggave van de dekking neemt de titel het weer over.
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      if (email && coverage.has(email)) return;
      unread.report(accountKey, count);
      pushUnread();
      refreshBadge();
    },
    (accountKey, surface, threadId) => activateNotification(accountKey, surface, threadId),
    (accountKey, identity) => {
      const idx = idxOfKey(accountKey);
      if (idx != null) onIdentity(idx, identity);
    },
    (_accountKey, input) => handleInput(input),
    (accountKey) => {
      if (prefs?.getAll().reneMode) return RENE_ZOOM_LEVEL;
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      return email ? prefs!.getAccount(email).zoom ?? 0 : 0;
    },
    (accountKey) => {
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      return email ? notificationSilent(prefs!.getAll(), email, 'mail') : false;
    },
    () => prefs?.getAll().notificationOpen ?? 'app',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
    (acctKey, payload) => void handleMailDrop(acctKey, payload),
  );

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL('app://bundle/');

  // Ontwikkelmodus: `npm run dev` bouwt de preload bij elke wijziging opnieuw.
  // Een preload wordt alleen bij een navigatie ingelezen, dus herladen we de
  // views zodra het bestand verandert. Scheelt een herstart van de hele app.
  if (DEV_URL) watchPreloadForReload();

  // De controle hangt aan de accountlijst (zie scheduleOAuthHealthCheck), dus hij
  // loopt zodra het eerste account bekend is. Daarnaast periodiek, want een
  // refresh token kan verlopen terwijl de app gewoon open staat.
  setInterval(() => void checkOAuthHealth(), 5 * 60 * 1000);

  mainWindow.webContents.on('did-finish-load', () => {
    loadDelegatedProfiles(); // surface persisted delegated mailboxes immediately
    pushProfiles(); // re-push on any (re)load so the sidebar repopulates
    pushPrefs();
    pushDefaultMailStatus();
    if (!delegatedScanStarted) {
      delegatedScanStarted = true;
      // Delay so the /u/0 mail view is loaded before we scrape its switcher.
      setTimeout(() => void refreshAndSuggestDelegated(), 7000);
    }
    applyReneZoom(); // a (re)load resets the renderer's zoom factor
    mainWindow?.webContents.send(IPC.UPDATE_STATUS, { ...lastUpdateStatus, currentVersion: app.getVersion() });
    if (!detectionStarted) {
      detectionStarted = true;
      startDetection();
    }
  });

  mainWindow.on('close', (e) => {
    if (shouldHideOnClose({ isQuitting, platform: process.platform })) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.on('close', saveWindowBounds);
  mainWindow.on('closed', () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    mainWindow = null;
  });

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    handleInput(input as unknown as KeyInput);
  });
}

function sendUpdate(status: Record<string, unknown>): void {
  lastUpdateStatus = { ...status, currentVersion: app.getVersion() };
  mainWindow?.webContents.send(IPC.UPDATE_STATUS, lastUpdateStatus);
  refreshTray(); // keep the tray's update label in sync with each status transition
  maybeShowTrayUpdatePopup();
}

// Bring the window forward and open the Settings panel (where the update section
// lives). Used by the tray "Check for updates" item.
function openSettingsPanel(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  settingsPanelOpen = true;
  manager?.hideAll();
  mainWindow.webContents.send(IPC.SETTINGS_FORCE_OPEN);
}

// Tray "Check for updates": open settings so the user sees the update section,
// then run the check and announce the terminal result in a small popup.
function checkForUpdateFromTray(): void {
  openSettingsPanel();
  pendingTrayUpdateCheck = true;
  checkForUpdate();
}

function maybeShowTrayUpdatePopup(): void {
  if (!pendingTrayUpdateCheck) return;
  const popup = updateCheckPopup(lastUpdateStatus as { state: string });
  if (!popup) return; // still checking/downloading — wait for a terminal result
  pendingTrayUpdateCheck = false;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Gmail Desktop',
      message: popup.message,
      detail: popup.detail,
      buttons: popup.buttons,
      defaultId: 0,
      cancelId: popup.buttons.length - 1,
      noLink: true,
    })
    .then((res) => {
      if (popup.downloadButtonIndex != null && res.response === popup.downloadButtonIndex) {
        downloadUpdate();
      }
    });
}

// Update / autostart / snooze actions are factored out so both the IPC handlers
// (settings UI) and the tray menu invoke the exact same logic.
function checkForUpdate(opts?: { background?: boolean }): void {
  lastCheckBackground = opts?.background === true;
  if (!app.isPackaged) return sendUpdate({ state: 'dev' });
  sendUpdate({ state: 'checking' });
  autoUpdater
    .checkForUpdates()
    .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
}
// Show a clickable OS notification for a background-discovered new version, at
// most once per version per session. Clicking it opens the Settings update
// section. Manual checks don't reach here as "background", so they stay quiet.
function maybeNotifyUpdate(version: string): void {
  if (
    !shouldNotifyUpdate({
      state: 'available',
      version,
      background: lastCheckBackground,
      notifiedVersion: notifiedUpdateVersion,
    })
  )
    return;
  if (!Notification.isSupported()) return;
  notifiedUpdateVersion = version;
  const n = new Notification({
    title: 'Update available',
    body: `Gmail Desktop ${version} is ready. Click to update.`,
  });
  n.on('click', () => openSettingsPanel());
  n.show();
}
function downloadUpdate(): void {
  updateRequested = true;
  autoUpdater
    .downloadUpdate()
    .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
}
function installUpdate(): void {
  isQuitting = true;
  autoUpdater.quitAndInstall();
}
function setAutoStart(v: boolean): void {
  prefs!.setAutoStart(v);
  app.setLoginItemSettings({ openAtLogin: v });
  pushPrefs();
  refreshTray();
}
// minutes: a positive number sets a timed snooze; null mutes indefinitely
// ("until I turn it back on"); 0 clears any active mute.
function setSnooze(minutes: number | null): void {
  if (!prefs) return;
  const n = prefs.getAll().notifications;
  if (minutes === null) prefs.setNotifications({ ...n, dnd: true, dndUntil: undefined });
  else if (minutes <= 0) prefs.setNotifications({ ...n, dnd: false, dndUntil: undefined });
  else prefs.setNotifications({ ...n, dnd: false, dndUntil: Date.now() + minutes * 60_000 });
  pushPrefs();
  refreshNotifyAllowed();
  refreshTray();
}
function clearSnooze(): void {
  setSnooze(0);
}

function getTrayState(): TrayState {
  const p = prefs?.getAll();
  return {
    onOpen: () => mainWindow?.show(),
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
    isPackaged: app.isPackaged,
    updateStatus: lastUpdateStatus as unknown as TrayUpdateStatus,
    onCheckUpdate: checkForUpdateFromTray,
    onDownloadUpdate: downloadUpdate,
    onInstallUpdate: installUpdate,
    autoStart: p?.autoStart ?? false,
    onToggleAutoStart: setAutoStart,
    dnd: p?.notifications.dnd ?? false,
    dndUntil: p?.notifications.dndUntil,
    now: Date.now(),
    onSnooze: setSnooze,
    onClearSnooze: clearSnooze,
  };
}
function refreshTray(): void {
  if (tray) updateTrayMenu(tray, getTrayState());
}

function setupUpdater(): void {
  autoUpdater.autoDownload = false; // download only when the user asks
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    sendUpdate({ state: 'available', version: info.version });
    maybeNotifyUpdate(info.version);
  });
  autoUpdater.on('update-not-available', (info) => sendUpdate({ state: 'not-available', version: info.version }));
  autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdate({ state: 'downloaded', version: info.version });
    if (updateRequested) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });
}

function setupNotifications(): void {
  // Windows shows/attributes native notifications by AppUserModelID; without it
  // Gmail's desktop notifications silently don't appear.
  if (process.platform === 'win32') app.setAppUserModelId('com.gmaildesktop.app');
  // Grant notification (and related) permissions for the shared Google session.
  // Only trusted Google domains ever load in these views, so a blanket grant is
  // safe here and is what lets Gmail's HTML5 notifications actually fire.
  const ses = session.fromPartition(SESSION_PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  ses.setPermissionCheckHandler(() => true);
}

function registerIpc(): void {
  ipcMain.on(IPC.SWITCH_SURFACE, (_e, arg: { key: string; surface: Surface }) => {
    const p = profiles.find((x) => keyOf(x) === arg.key);
    // Alleen een bevestigd account heeft een `ref` en dus een postvak om te openen.
    // Een voorlopige tab bewust niet: de sessie-index is niet bewaard, dus er is
    // geen URL die we mogen bouwen, en gokken zou het verkeerde postvak onder de
    // verkeerde naam openen. Detectie is al onderweg; zodra dit adres bevestigd is
    // staat er een echt tabblad dat wél opengaat.
    if (p) showAccount(p.ref, arg.surface);
  });
  ipcMain.on(IPC.REDETECT, () => redetect());
  ipcMain.on(IPC.ADD_ACCOUNT, () => addAccount());
  // Zoek gedelegeerde postbussen in de accountwisselaar. Het uitlezen daarvan
  // heeft de mailview van /u0 getekend nodig, dus staat die er even bij, en
  // daarna zetten we de gebruiker terug waar hij was. Vroeger eindigde dit met
  // hideAll(), zodat het uitklapmenu (nu met resultaten) vrij bleef; dat menu is
  // een OS-menu geworden en staat toch al bovenop, dus hideAll() zou hier alleen
  // een leeg venster achterlaten.
  ipcMain.on(IPC.ADD_DELEGATED, () => {
    const before = activeView();
    manager?.show(authRef(0), 'mail');
    void scanDelegatedSuggestions().then((s) => {
      // Niet terugzetten als de gebruiker er zelf iets van gemaakt heeft: een
      // tabblad aangeklikt (dan is /u0 mail niet meer de actieve view) of de
      // instellingen geopend (die verbergt de views met opzet).
      if (before && !settingsPanelOpen && manager?.isShowing(keyOfIndex(0), 'mail')) {
        showAccount(before.ref, before.surface);
      }
      pushDelegatedSuggestions(s);
    });
  });
  ipcMain.on(IPC.ADD_DELEGATED_SUGGESTION, (_e, arg: { email: string; mailUrl: string }) =>
    addDelegatedMailbox(arg.email, arg.mailUrl),
  );
  ipcMain.on(IPC.SET_COLOR, (_e, arg: { email: string; color: string }) => {
    colors!.set(arg.email, arg.color);
    const p = profiles.find((x) => x.email === arg.email);
    if (p) p.color = arg.color;
    // Ook zonder profiel pushen: een voorlopige tab leest zijn kleur uit
    // colors.json en moet de nieuwe kleur meteen laten zien.
    pushProfiles();
  });
  ipcMain.on(IPC.REMOVE_ACCOUNT, (_e, arg: { email: string }) => removeAccount(arg.email));
  ipcMain.on(IPC.UPDATE_CHECK, () => checkForUpdate());
  ipcMain.on(IPC.UPDATE_DOWNLOAD, () => downloadUpdate());
  ipcMain.on(IPC.UPDATE_INSTALL, () => installUpdate());
  ipcMain.on(IPC.SETTINGS_TOGGLE, (_e, arg: { open: boolean }) => {
    settingsPanelOpen = arg.open;
    if (arg.open) manager?.hideAll();
    else manager?.showActive();
  });
  // De uitklapmenu's van de balk ("+" en het rechtsklikmenu op een tabblad). Een
  // menu dat de balkpagina zelf tekent valt achter de Gmail-view — die is een
  // native laag erboven — dus opent main hier een echt OS-menu, dat boven alles
  // staat. De renderer stuurt de teksten mee en krijgt het gekozen id terug; er
  // valt niets weg te duwen en dus ook niets terug te zetten.
  ipcMain.handle(IPC.MENU_POPUP, (e, items: NativeMenuItem[]) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    return popupNativeMenu(win, items);
  });
  ipcMain.on(IPC.SET_AUTO_START, (_e, v: boolean) => setAutoStart(v));
  ipcMain.on(IPC.SET_DEFAULT_MAIL, () => {
    app.setAsDefaultProtocolClient('mailto');
    pushDefaultMailStatus();
  });
  // De modal-pagina kan geladen zijn nádat het main-proces de items al stuurde;
  // daarom haalt ze het bij het opstarten ook zelf op.
  ipcMain.handle(IPC.MAIL_DROP_PREVIEW_GET, () => ({ items: lastDropPreview }));
  ipcMain.on(IPC.MAIL_DROP_PREVIEW_CLOSE, () => {
    dropOverlay?.close();
  });
  // Labels van elk gekoppeld account, voor de kopieermodal. Per account apart
  // gemeld: ontbreekt er één token, dan blijven de andere kolommen bruikbaar.
  ipcMain.handle(IPC.LABELS_GET, async () => {
    const cfg = oauthConfig();
    // Het bronaccount niet aanbieden: een kopie in hetzelfde postvak is een
    // duplicaat, en verplaatsen binnen één account doet Gmail zelf al.
    // Gemachtigde postvakken horen hier ook thuis: met een token van de relay
    // zijn ze een echt kopieerdoel.
    const own = profiles.filter((p) => !lastDropSource || p.email !== lastDropSource);
    if ((!cfg || !oauthTokens) && !delegatedSource()) {
      return { accounts: own.map((p) => ({ email: p.email, labels: [], error: 'Niet gekoppeld' })) };
    }
    const accounts: AccountLabels[] = [];
    for (const p of own) {
      const token = await tokenForAccount(p.email);
      if (!token) {
        // Een gemachtigd postvak heeft geen OAuth-koppeling om te verversen:
        // of de relay is niet ingesteld, of die zegt dat dit postvak niet aan
        // ons gemachtigd is. De rij mét reden tonen is eerlijker dan weglaten —
        // in de zijbalk staat het postvak wél.
        accounts.push({
          email: p.email,
          labels: [],
          error: p.kind === 'delegated' ? 'Beheerdertoegang nodig' : 'Verbinding verlopen',
        });
        continue;
      }
      try {
        accounts.push({ email: p.email, labels: await fetchLabels(token) });
      } catch (e) {
        // 401 betekent dat Google het token afkeurt, ook als het volgens onze
        // klok nog geldig is (bijvoorbeeld ingetrokken via een andere app met
        // dezelfde client-id). Eerst verversen en het nog eens proberen; lukt dat
        // niet, dan is opnieuw toestemming geven het enige dat rest en zetten we
        // dit account in de herverbind-melding.
        const unauthorized = e instanceof GmailHttpError && e.status === 401;
        // Voor een gemachtigd postvak betekent 401 "opnieuw minten", niet
        // "verversen": een impersonatieflow heeft geen refresh token.
        const fresh = unauthorized ? await renewTokenFor(p.email) : null;
        if (fresh) {
          try {
            accounts.push({ email: p.email, labels: await fetchLabels(fresh) });
            if (p.kind !== 'delegated') refreshFailures.delete(p.email);
            continue;
          } catch (e2) {
            accounts.push({ email: p.email, labels: [], error: (e2 as Error).message });
            continue;
          }
        }
        if (unauthorized) {
          // Alleen eigen accounts staan in de herverbind-melding; een gemachtigd
          // postvak heeft daar geen koppeling voor.
          if (p.kind !== 'delegated') {
            refreshFailures.add(p.email);
            scheduleOAuthHealthCheck();
          }
          accounts.push({
            email: p.email,
            labels: [],
            error: p.kind === 'delegated' ? 'Beheerdertoegang nodig' : 'Verbinding verlopen',
          });
        } else {
          accounts.push({ email: p.email, labels: [], error: (e as Error).message });
        }
      }
    }
    return { accounts };
  });
  // Het eigenlijke kopiëren: elk .eml van de laatste sleep in het postvak van
  // elk gekozen account zetten, onder de daar aangevinkte labels. Eén insert per
  // bericht per account — de labels gaan mee in datzelfde verzoek, anders zou
  // elk label een eigen kopie opleveren.
  ipcMain.handle(
    IPC.MAIL_DROP_COPY,
    async (_e, arg: { targets: MailDropCopyTarget[]; mode?: CopyMode }) => {
    const cfg = oauthConfig();
    const targets = normalizeTargets(arg?.targets ?? []);
    const mode: CopyMode = arg?.mode ?? 'check';
    const fail = (error: string): MailDropCopyResult => ({
      ok: false,
      copied: 0,
      skipped: 0,
      total: 0,
      accounts: [],
      error,
    });
    if (!cfg || !oauthTokens) return fail('Koppeling niet ingesteld');
    if (targets.length === 0) return fail('Geen label gekozen');
    const files = lastDropSaved;
    if (files.length === 0) return fail('Geen opgeslagen berichten om te kopiëren');

    const total = copyTotal(targets, files.length);
    const ts = new Date().toISOString();
    const root = mailDropFolder();
    const records: LogRecord[] = [];
    const accounts: MailDropCopyAccountResult[] = [];
    let done = 0;
    let copied = 0;
    let skipped = 0;
    const progress = (phase: 'check' | 'copy', email: string, of = total) =>
      dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, { phase, done, total: of, email });

    // Bij 'all' gaat alles erbij en hoeft er niets opgezocht te worden. Anders
    // eerst kijken wat er al staat: bij 'check' om het te kunnen vragen, bij
    // 'new' om precies die berichten over te slaan.
    let index = new Set<string>();
    if (mode !== 'all') {
      const key = scanKey(targets);
      const hits =
        lastScan?.key === key
          ? lastScan.hits
          : await findDuplicates(cfg, targets, files, (n, of, email) => {
              done = n;
              progress('check', email, of);
            });
      lastScan = { key, hits };
      done = 0;
      index = duplicateIndex(hits);
      if (mode === 'check' && hits.length > 0) {
        return {
          ok: false,
          copied: 0,
          skipped: 0,
          total,
          accounts: [],
          needsConfirm: true,
          duplicates: groupDuplicates(hits),
          newCount: newMessageCount(index, targets, files.map((f) => f.messageId)),
        };
      }
    }

    for (const target of targets) {
      progress('copy', target.email);
      let token = await accessTokenFor(cfg, oauthTokens, target.email);
      if (!token) {
        refreshFailures.add(target.email);
        scheduleOAuthHealthCheck();
        done += files.length;
        progress('copy', target.email);
        accounts.push({
          email: target.email,
          copied: 0,
          skipped: 0,
          total: files.length,
          error: 'Verbinding verlopen',
        });
        continue;
      }

      let ok = 0;
      let over = 0;
      let lastError: string | undefined;
      for (const { file, messageId } of files) {
        // Alleen de labels waar hij nog niet staat. Bij 'all' is de index leeg,
        // dus dan blijven het gewoon alle gekozen labels.
        const labelIds = labelsStillNeeded(index, target.email, target.labelIds, messageId);
        if (labelIds.length === 0) {
          over += 1;
          done += 1;
          progress('copy', target.email);
          continue;
        }
        let raw: Buffer;
        try {
          raw = readFileSync(file);
        } catch {
          lastError = `Kan ${file} niet lezen`;
          records.push({ ts, account: target.email, threadId: '', file, error: lastError });
          done += 1;
          progress('copy', target.email);
          continue;
        }
        try {
          // Een 401 betekent dat Google het token afkeurt, ook als onze klok
          // zegt dat het nog geldig is. Eén keer verversen en opnieuw; blijft
          // het mislukken, dan is opnieuw toestemming geven het enige dat rest.
          let id: string | null;
          try {
            id = await insertMessage(token, raw, labelIds);
          } catch (e) {
            if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
            const fresh = await forceRefresh(cfg, oauthTokens, target.email);
            if (!fresh) {
              refreshFailures.add(target.email);
              scheduleOAuthHealthCheck();
              throw new Error('Verbinding verlopen');
            }
            token = fresh;
            refreshFailures.delete(target.email);
            id = await insertMessage(token, raw, labelIds);
          }
          ok += 1;
          records.push({
            ts,
            account: target.email,
            threadId: id ?? '',
            file,
            bytes: raw.length,
            copy: { to: target.email, labels: labelIds, ok: true },
          });
        } catch (e) {
          lastError = (e as Error).message;
          records.push({
            ts,
            account: target.email,
            threadId: '',
            file,
            error: lastError,
            copy: { to: target.email, labels: labelIds, ok: false, error: lastError },
          });
        }
        done += 1;
        progress('copy', target.email);
      }
      copied += ok;
      skipped += over;
      accounts.push({
        email: target.email,
        copied: ok,
        skipped: over,
        total: files.length,
        // Overgeslagen berichten zijn geen fout: de rest is af zodra alles
        // wat nog niet bestond geschreven is.
        error: ok + over < files.length ? (lastError ?? 'Niet alles gekopieerd') : undefined,
      });
    }

    try {
      appendLog(root, records);
    } catch {
      /* map niet schrijfbaar; de kopieën staan er wel */
    }
    return {
      ok: copied > 0 || skipped > 0,
      copied,
      skipped,
      total,
      accounts,
    } satisfies MailDropCopyResult;
    },
  );
  ipcMain.handle(IPC.OAUTH_RECONNECT_GET, () => ({ accounts: reconnectAccounts }));
  ipcMain.handle(IPC.OAUTH_RECONNECT, async (_e, arg: { email: string }) => {
    const cfg = oauthConfig();
    if (!cfg || !oauthTokens || !mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: 'Koppeling niet ingesteld' };
    }
    // Opnieuw toestemming vragen; het oude, geweigerde token staat de nieuwe
    // uitwisseling niet in de weg.
    const result = await connectAccount(mainWindow, SESSION_PARTITION, cfg, oauthTokens, arg.email);
    if (!result.ok) return result;
    refreshFailures.delete(arg.email);
    // Het nieuwe token is nog nergens geweigerd; blijft deze staan, dan blijft de
    // melding staan voor een probleem dat net is opgelost.
    pushRefusals.delete(arg.email);
    // Opnieuw langs de hele lijst: misschien was dit de laatste en kan de melding
    // helemaal weg.
    void checkOAuthHealth();
    // Het nieuwe token heeft de e-mailscope, dus dit account is nu pushbaar. Zonder
    // deze aanroep vraagt niemand daar opnieuw om en lijkt push pas na een herstart
    // te werken.
    startPush();
    return { ok: true };
  });
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_GET, () => mailDropFolder());
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_PICK, async () => {
    const current = mailDropFolder();
    if (!mainWindow || mainWindow.isDestroyed()) return current;
    const res = await dialog.showOpenDialog(mainWindow, {
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return current;
    prefs?.setMailDropFolder(res.filePaths[0]);
    return res.filePaths[0];
  });
  ipcMain.on(IPC.MAIL_DROP_FOLDER_OPEN, () => {
    const dir = mailDropFolder();
    // De map bestaat pas na de eerste drop; maak hem aan zodat Verkenner iets
    // te openen heeft.
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* niet aan te maken; openPath meldt het zelf */
    }
    void shell.openPath(dir);
  });
  ipcMain.on(IPC.SET_SNOOZE, (_e, minutes: number | null) => setSnooze(minutes));
  ipcMain.on(IPC.SET_ACCOUNT_PREF, (_e, arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean; notifySound?: boolean; notifyPersist?: boolean }) => {
    const patch: Record<string, unknown> = {};
    if ('label' in arg) patch.label = arg.label;
    if ('notify' in arg) patch.notify = arg.notify;
    if ('calendarNotify' in arg) patch.calendarNotify = arg.calendarNotify;
    if ('badgeCount' in arg) patch.badgeCount = arg.badgeCount;
    if ('notifySound' in arg) patch.notifySound = arg.notifySound;
    if ('notifyPersist' in arg) patch.notifyPersist = arg.notifyPersist;
    prefs!.setAccount(arg.email, patch);
    pushProfiles();
    pushPrefs(); // keep the settings UI's per-account toggles in sync with what was stored
    refreshNotifyAllowed();
    startPush();
    syncCalendarViews();
    refreshBadge(); // reflect a badgeCount change immediately
  });
  ipcMain.on(IPC.SET_ACCOUNT_ORDER, (_e, arg: { emails: string[] }) => {
    prefs!.setOrder(arg.emails);
    pushProfiles();
  });
  ipcMain.on(
    IPC.SET_NOTIFICATIONS,
    (_e, arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }) => {
      // Het paneel stuurt nooit `dndUntil` mee — dat veld is van de tray. Zonder
      // `mergeNotificationsFromPanel` overschrijft `setNotifications` de hele
      // opgeslagen waarde, en verdwijnt een lopende snooze zodra je alleen de
      // stille uren aanpast.
      prefs!.setNotifications(mergeNotificationsFromPanel(prefs!.getAll().notifications, arg));
      pushPrefs();
      refreshNotifyAllowed();
      refreshTray(); // a settings-driven DND change should re-label the tray too
    },
  );
  ipcMain.on(IPC.SET_THEME, (_e, theme: 'system' | 'light' | 'dark') => {
    prefs!.setTheme(theme);
    pushPrefs();
    applyTitleBarOverlay();
  });
  ipcMain.on(IPC.SET_NOTIFICATION_OPEN, (_e, v: 'app' | 'window') => {
    prefs!.setNotificationOpen(v);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_RENE_MODE, (_e, v: boolean) => {
    prefs!.setReneMode(v === true);
    applyReneZoom();
    pushPrefs();
  });
  ipcMain.handle(IPC.CHANGELOG_GET, () => loadChangelog());
}

// Single-instance: closing the window keeps the process alive in the tray, so a
// second launch must focus the existing window instead of starting a duplicate.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    const url = extractMailtoFromArgv(argv);
    if (url) dispatchMailto(url);
  });
}

// macOS delivers mailto: via this event (both cold and while running); register
// it before whenReady so a launch-time URL isn't missed. dispatchMailto queues
// itself if the app isn't ready yet.
app.on('open-url', (event, url) => {
  event.preventDefault();
  dispatchMailto(url);
});

app.whenReady().then(() => {
  if (!gotTheLock) return; // a primary instance is already running
  Menu.setApplicationMenu(null); // drop the default File/Edit/View… menu bar
  // One hook covers every webContents the app ever creates — sidebar, Gmail and
  // Calendar views, compose and pop-out windows — so right-click works the same
  // everywhere. Registered before createWindow so the first ones are included.
  app.on('web-contents-created', (_e, wc) => {
    attachContextMenu(wc, () => (prefs?.getAll().reneMode ? LABELS_RENE : LABELS_NORMAL));
  });
  registerAppProtocol();
  setupNotifications();
  registerIpc();
  app.setAsDefaultProtocolClient('mailto');
  // Bij thema "system" verandert de kleur zonder dat de gebruiker iets doet.
  // Hier, niet in createWindow: dat venster wordt soms opnieuw opgebouwd (na een
  // notificatieklik op een gesloten venster, of via 'activate'), en elke keer een
  // extra listener op de globale nativeTheme is een lek. Draait vóór het eerste
  // venster bestaat, wat mag: applyTitleBarOverlay doet niets zonder venster.
  nativeTheme.on('updated', () => applyTitleBarOverlay());
  createWindow();
  const initialMailto = extractMailtoFromArgv(process.argv);
  if (initialMailto) pendingMailto = initialMailto; // flushed once an inbox is live
  startNotifyTimer();
  app.setLoginItemSettings({ openAtLogin: prefs!.getAll().autoStart });
  tray = createTray(ICON_PATH, getTrayState());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Auto-update from GitHub Releases (packaged builds only; no-op in dev).
  setupUpdater();
  if (app.isPackaged) {
    checkForUpdate({ background: true });
    setInterval(() => checkForUpdate({ background: true }), 30 * 60_000);
  }
});

app.on('window-all-closed', () => {
  // Kept running in the tray; quit only via the tray menu.
});
app.on('before-quit', () => {
  isQuitting = true;
  pushManager?.stop();
});

