import { wsTransport, type PushSocket, type PushTransport } from './push-transport';
import type { PushConfig } from './push-config';

// Eén verbinding per account naar de relay. Dat moet per account, want de relay
// authenticeert met één token per verbinding en routeert op het adres daaruit.
//
// Overgezet uit gmail-native (src/main/push/manager.ts). Wat er hier bij komt:
// dekkingsmeldingen (zodat de webview weet of hij moet zwijgen), het herkennen
// van sluitcodes waar opnieuw proberen zinloos is, en een hartslagtimer voor een
// socket die doodgaat zonder afscheid.

// Codes waar de relay mee zegt dat er iets structureel mis is: 4400 een kapot
// frame van ons, 4401 een token dat Google afkeurt, 4403 een adres dat niet in
// ALLOWED_EMAILS staat. Blijven proberen lost geen van de drie op.
export const FATAL_CLOSE_CODES = [4400, 4401, 4403];

export interface Timer {
  clear(): void;
}

export interface PushManagerDeps {
  config: PushConfig;
  accounts(): string[];
  accessToken(email: string): Promise<string | null>;
  // Een 4401 zegt: Google wil dit token niet. Soms is dat een token dat net
  // verlopen is of dat de relay niet kon controleren, en dan lukt het met een
  // gegarandeerd vers token wél. Deze dep vraagt daarom om een échte verversing
  // (niet "geef me een token dat volgens onze klok nog geldig is"), en wordt
  // precies één keer per weigering gebruikt. Null betekent: er komt geen vers
  // token, dus de weigering is definitief. Ontbreekt de dep, dan is de eerste
  // 4401 meteen definitief.
  refreshToken?(email: string): Promise<string | null>;
  // True als de watch staat. Zonder watch stuurt Gmail niets en is het account
  // dus niet gedekt, hoe goed de socket het ook doet.
  armWatch(email: string): Promise<boolean>;
  // Voor een gemachtigd postvak: het adres waarop deze verbinding moet luisteren.
  // De socket logt in met het token van de eigenaar — een gemint token draagt
  // geen e-mailscope en zou door de relay geweigerd worden — en vraagt daarna om
  // omgelegd te worden. Null voor een eigen account: die luistert op zichzelf.
  subscribeAs?(email: string): string | null;
  onSync(email: string): void;
  onCoverage(email: string, covered: boolean): void;
  onFatal?(email: string, code: number): void;
  transport?: PushTransport;
  backoffMs?(attempt: number): number;
  setTimer?(fn: () => void, ms: number): Timer;
  renewMs?: number;
  staleMs?: number;
  graceMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 90_000; // de relay klopt elke 30s aan; drie keer niets is dood
const GRACE_MS = 120_000; // zie de spec: kort genoeg om niet blind te zitten

interface ConnState {
  sock?: PushSocket;
  attempt: number;
  covered: boolean;
  reconnect?: Timer;
  renew?: Timer;
  stale?: Timer;
  grace?: Timer;
  dead: boolean; // definitief geweigerd: niet meer proberen
  // Of deze weigeringsepisode zijn ene verversing al heeft gehad. Gaat weer uit
  // zodra een verbinding staat, zodat een 4401 volgende week (een token dat dan
  // écht verlopen is) opnieuw één kans krijgt.
  retriedAuth: boolean;
  // Nummer van de lopende poging. Traag werk (token ophalen, watch zetten,
  // vernieuwen) neemt dit nummer mee en checkt het na elke await: als het niet
  // meer overeenkomt is deze poging overtroffen door een nieuwe verbinding,
  // is het account verwijderd, of is de manager gestopt — en mag hij niets
  // meer aan de gedeelde toestand doen.
  generation: number;
}

export function startPushManager(deps: PushManagerDeps): { stop(): void; refresh(): void } {
  const transport = deps.transport ?? wsTransport;
  const backoffMs = deps.backoffMs ?? ((attempt) => Math.min(30_000, 1000 * 2 ** attempt));
  const renewMs = deps.renewMs ?? DAY_MS;
  const staleMs = deps.staleMs ?? STALE_MS;
  const graceMs = deps.graceMs ?? GRACE_MS;
  const setTimer =
    deps.setTimer ??
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      return { clear: () => clearTimeout(t) };
    });

  let stopped = false;
  const conns = new Map<string, ConnState>();

  const setCovered = (email: string, state: ConnState, covered: boolean): void => {
    if (state.covered === covered) return;
    state.covered = covered;
    deps.onCoverage(email, covered);
  };

  const clearTimers = (state: ConnState): void => {
    state.reconnect?.clear();
    state.renew?.clear();
    state.stale?.clear();
    state.grace?.clear();
    state.reconnect = undefined;
    state.renew = undefined;
    state.stale = undefined;
    state.grace = undefined;
  };

  // De ene vraag die "mag deze poging nog iets veranderen?" beantwoordt: niet
  // gestopt, niet definitief afgewezen, en dit account verwijst nog naar
  // precies déze toestand onder precies dit pogingnummer. Elke asynchrone
  // vervolgstap (na een await, of in een losse timer-callback) checkt dit
  // vóórdat hij de socket aanraakt of dekking meldt.
  //
  // De socket zelf is optioneel: vernieuwen is bewust socket-onafhankelijk (de
  // watch is een gewone HTTPS-aanroep die ook lukt terwijl de verbinding even
  // weg is), maar alles wat ÉCHT bij één specifieke socket hoort — de handdruk,
  // een binnenkomend frame, het sluiten zelf — moet ook checken dat die socket
  // nog steeds de huidige is. Zonder die check overleeft een niet-fatale
  // sluiting tijdens een hangende watch-aanroep de sluiting: de handdruk komt
  // alsnog terug, zet dekking aan en reset de backoff-teller voor een
  // verbinding die er niet meer is.
  const isLive = (email: string, state: ConnState, gen: number, sock?: PushSocket): boolean =>
    !stopped &&
    !state.dead &&
    conns.get(email) === state &&
    state.generation === gen &&
    (sock === undefined || state.sock === sock);

  // Elke vernieuwing plant de volgende zelf in, en hangt aan het account en niet
  // aan één socket: de watch is een gewone HTTPS-aanroep en kan dus ook slagen
  // terwijl de verbinding even weg is.
  const scheduleRenew = (email: string, state: ConnState, gen: number): void => {
    state.renew?.clear();
    state.renew = setTimer(() => {
      if (!isLive(email, state, gen)) return;
      void deps
        .armWatch(email)
        .then((ok) => {
          if (!isLive(email, state, gen)) return;
          if (ok) {
            scheduleRenew(email, state, gen); // gelukt: volgende cyclus plannen
            return;
          }
          // Mislukte vernieuwing is hetzelfde soort mislukking als een
          // mislukte eerste watch (Important 3): geen tweede retrymechanisme
          // naast backoff. Socket dicht laat de bestaande herverbinding het
          // opnieuw proberen; de nieuwe verbinding zet zijn eigen
          // vernieuwingscyclus weer op zodra de watch daar lukt. Zonder dit
          // zou het account 24 uur lang — tot de volgende geplande vernieuwing
          // — ongedekt blijven zonder dat er iets aan gedaan wordt.
          setCovered(email, state, false);
          state.sock?.close();
        })
        .catch(() => {
          if (!isLive(email, state, gen)) return;
          setCovered(email, state, false);
          state.sock?.close();
        });
    }, renewMs);
  };

  // Een socket die stilvalt zonder close-event zou de manager voor altijd laten
  // denken dat hij verbonden is. Elke frame — ook een ping — schuift dit op.
  const armStale = (email: string, state: ConnState, gen: number): void => {
    state.stale?.clear();
    state.stale = setTimer(() => {
      if (!isLive(email, state, gen)) return;
      state.sock?.close(); // het close-event hierna regelt de herverbinding
    }, staleMs);
  };

  // Definitief. Dekking terug naar de webview en de aanroeper laten weten
  // waarom, zodat die om hertoestemming kan vragen — anders valt push stil
  // zonder dat iemand het merkt.
  const giveUp = (email: string, state: ConnState, code: number): void => {
    state.dead = true;
    setCovered(email, state, false);
    clearTimers(state);
    deps.onFatal?.(email, code);
  };

  const connect = (email: string): void => {
    if (stopped) return;
    const state =
      conns.get(email) ??
      { attempt: 0, covered: false, dead: false, retriedAuth: false, generation: 0 };
    conns.set(email, state);
    if (state.dead) return;

    // Nieuw nummer voor deze poging. Zolang niemand anders het account opnieuw
    // verbindt, blijft dit hét geldende nummer voor alle timers en callbacks
    // die deze socket hieronder opzet.
    const myGen = ++state.generation;

    let sock: PushSocket;
    try {
      sock = transport.connect(deps.config.relayUrl);
    } catch (e) {
      console.warn(`[push] verbinden mislukte meteen voor ${email}:`, e);
      state.reconnect = setTimer(() => connect(email), backoffMs(state.attempt++));
      return;
    }
    state.sock = sock;

    sock.onOpen(() => {
      void (async () => {
        try {
          const token = await deps.accessToken(email);
          if (!isLive(email, state, myGen, sock)) return;
          if (!token) {
            // Geen token: de relay zou ons toch weigeren. Socket dicht en de
            // gewone sluitpad regelt de herverbinding met backoff — geen tweede
            // "dood spoor" naast de bestaande reconnectlogica.
            console.warn(`[push] geen token voor ${email}`);
            sock.close();
            return;
          }
          sock.send(JSON.stringify({ type: 'auth', accessToken: token }));
          // Een gemachtigd postvak: deze verbinding omleggen. De relay
          // controleert de machtiging en antwoordt met {type:'subscribed'};
          // weigert hij, dan sluit hij met 4403 en dat is al fataal.
          const mailbox = deps.subscribeAs?.(email) ?? null;
          if (mailbox) sock.send(JSON.stringify({ type: 'subscribe', mailbox }));
          const armed = await deps.armWatch(email);
          if (!isLive(email, state, myGen, sock)) return;
          if (!armed) {
            console.warn(`[push] watch mislukte voor ${email}; webview blijft melden`);
            sock.close(); // idem: laat de gewone sluitpad opnieuw proberen
            return;
          }
          state.attempt = 0;
          state.grace?.clear();
          state.grace = undefined;
          armStale(email, state, myGen);
          scheduleRenew(email, state, myGen);
          // Dekking vóór de catch-up: de meldingsregel meet vanaf dit moment, en
          // mail die daarvoor kwam heeft de webview al gemeld.
          //
          // Bij een omgelegde verbinding wachten we daar juist mee tot de relay
          // bevestigt: dekking zet de webview-teller uit, en die uitzetten voor
          // een postvak waar niets naartoe routeert zou hem stil laten vallen.
          if (!mailbox) {
            setCovered(email, state, true);
            deps.onSync(email);
          }
        } catch (e) {
          console.warn(`[push] handdruk mislukte voor ${email}:`, e);
          if (isLive(email, state, myGen, sock)) sock.close();
        }
      })();
    });

    sock.onMessage((data) => {
      if (!isLive(email, state, myGen, sock)) return;
      armStale(email, state, myGen);
      let msg: { type?: string };
      try {
        msg = JSON.parse(data) as { type?: string };
      } catch {
        return; // onleesbaar frame: negeren, niet omvallen
      }
      // {type:'ready'} stuurt de relay alleen ná een geslaagde controle van het
      // token. Dat is het énige harde bewijs dat dit token geaccepteerd is, en
      // dus de enige plek waar de ene herkansing na een 4401 terug mag. Een
      // geslaagde handdruk aan onze kant zegt daar niets over — users.watch lukt
      // prima met een token dat precies de scope mist waar de relay op afkeurt —
      // en terugzetten op dát moment zou een token zonder e-mailscope eeuwig
      // laten verversen en herverbinden.
      if (msg.type === 'ready') state.retriedAuth = false;
      // De relay heeft de machtiging gecontroleerd en deze verbinding omgelegd.
      // Pas nu is dit postvak echt gedekt.
      if (msg.type === 'subscribed') {
        setCovered(email, state, true);
        deps.onSync(email);
      }
      if (msg.type === 'sync') deps.onSync(email);
    });

    // De hartslag van de relay is een protocol-ping, en op een stil postvak is
    // dat het énige dat er de hele dag binnenkomt: applicatieframes zijn er maar
    // twee ({type:'ready'} bij het inloggen en een sync als er mail is). Zonder
    // deze draad verloopt de staleness-timer dus altijd, breekt de manager een
    // gezonde verbinding elke 90 seconden af, en registreert hij bij elke
    // herverbinding opnieuw een watch met een volledige catch-up-sync erachter —
    // de pollende achtervang die de spec expliciet niet wil.
    sock.onPing(() => {
      if (!isLive(email, state, myGen, sock)) return;
      armStale(email, state, myGen);
    });

    sock.onError((e) => console.warn(`[push] socketfout voor ${email}:`, e));

    sock.onClose((code) => {
      state.stale?.clear();
      state.stale = undefined;
      state.renew?.clear();
      state.renew = undefined;
      // Niet meer de geldende poging — overtroffen, verwijderd door refresh(),
      // of de manager is gestopt. Dan is dit sluitgebeuren oud nieuws en mag
      // het geen dekking of herverbinding meer in beweging zetten.
      if (!isLive(email, state, myGen, sock)) return;

      // Deze socket is nu weg. Los meteen maken, zodat een handdruk die nog op
      // het token of de watch wacht (zelfde generatie, zelfde kaartregel, dus
      // isLive() zonder deze regel nog steeds "true") zichzelf via de
      // socket-check hierboven als achterhaald herkent — anders zou hij na het
      // alsnog binnenkomen van het antwoord dekking aanzetten en de
      // backoff-teller resetten voor een verbinding die niet meer bestaat.
      state.sock = undefined;

      // 4401 is de enige weigering waar iets aan te doen valt: Google keurde
      // dít token af. Eén keer met een gegarandeerd vers token opnieuw (zie de
      // spec), en blijft het dan nog, dan is het definitief. Zonder deze kans is
      // één hik bij de tokencontrole van de relay genoeg om push voor élk account
      // uit te zetten tot de app herstart.
      if (code === 4401 && !state.retriedAuth && deps.refreshToken) {
        state.retriedAuth = true;
        setCovered(email, state, false); // tot de nieuwe verbinding staat is er geen dekking
        state.grace?.clear(); // dekking is al terug; een afvaltimer heeft niets meer te doen
        state.grace = undefined;
        void deps
          .refreshToken(email)
          .then((fresh) => {
            if (!isLive(email, state, myGen)) return;
            if (fresh) {
              // Het verse token staat opgeslagen; de nieuwe handdruk haalt het
              // via de gewone weg op. Meteen opnieuw en niet via de backoff: dit
              // is geen storing maar een reparatie.
              connect(email);
              return;
            }
            giveUp(email, state, code);
          })
          .catch(() => {
            if (isLive(email, state, myGen)) giveUp(email, state, code);
          });
        return;
      }

      if (FATAL_CLOSE_CODES.includes(code)) {
        giveUp(email, state, code);
        return;
      }

      // Een blip mag niets omschakelen; een storing van minuten wel, anders zit
      // je zonder meldingen te wachten op iets dat te laat komt.
      if (state.covered && !state.grace) {
        state.grace = setTimer(() => setCovered(email, state, false), graceMs);
      }
      state.reconnect = setTimer(() => connect(email), backoffMs(state.attempt++));
    });
  };

  const refresh = (): void => {
    if (stopped) return;
    const wanted = new Set(deps.accounts());
    for (const [email, state] of conns) {
      if (wanted.has(email)) continue;
      // Eerst uit de kaart, dán pas sluiten: het sluiten vuurt zelf een
      // close-event (net als een echte ws-verbinding), en dat event moet dit
      // account niet meer "in leven" aantreffen — anders herrijst een
      // verwijderd account via de gewone herverbindingslogica (isLive() kijkt
      // immers of conns.get(email) nog naar déze state verwijst).
      conns.delete(email);
      clearTimers(state);
      setCovered(email, state, false);
      state.sock?.close();
    }
    for (const email of wanted) {
      const state = conns.get(email);
      if (!state) {
        connect(email);
      } else if (state.dead) {
        // refresh() betekent "de wereld is veranderd, kijk opnieuw" — en dat is
        // precies het signaal dat een eerder definitieve afwijzing niet meer
        // definitief hoeft te zijn. De aanroeper roept dit typisch aan nadat de
        // gebruiker opnieuw toestemming heeft gegeven (nieuwe scope, nieuw
        // token); zonder deze herleving blijft het account dood tot de app
        // herstart, ook al is precies gerepareerd wat de weigering veroorzaakte.
        state.dead = false;
        state.attempt = 0;
        state.retriedAuth = false; // nieuwe wereld, dus ook weer één verversingskans
        connect(email);
      }
    }
  };

  refresh();

  return {
    stop(): void {
      stopped = true;
      for (const state of conns.values()) {
        clearTimers(state);
        state.sock?.close();
      }
      conns.clear();
    },
    refresh,
  };
}
