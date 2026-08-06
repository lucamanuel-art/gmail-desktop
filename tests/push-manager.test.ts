import { describe, it, expect } from 'vitest';
import { startPushManager, FATAL_CLOSE_CODES } from '../electron/push-manager';
import type { PushSocket } from '../electron/push-transport';

// Nep-socket: we sturen de gebeurtenissen zelf, zodat de test over de
// toestandsmachine gaat en niet over ws.
class FakeSocket implements PushSocket {
  sent: string[] = [];
  closed = false;
  private open?: () => void;
  private message?: (d: string) => void;
  private ping?: () => void;
  private close_?: (code: number) => void;
  private error?: (e: unknown) => void;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    // Echte ws vuurt ook een close-event als je zelf close() aanroept — dat
    // is precies wat Critical 1 blootlegde: de manager moet zo'n zelf
    // veroorzaakte sluiting net zo goed herkennen als een sluiting door de
    // server. Eenmalig, zoals een echte socket ook maar één keer sluit.
    if (this.closed) return;
    this.closed = true;
    this.close_?.(1000);
  }
  onOpen(cb: () => void): void {
    this.open = cb;
  }
  onMessage(cb: (d: string) => void): void {
    this.message = cb;
  }
  onPing(cb: () => void): void {
    this.ping = cb;
  }
  onClose(cb: (code: number) => void): void {
    this.close_ = cb;
  }
  onError(cb: (e: unknown) => void): void {
    this.error = cb;
  }

  fireOpen(): void {
    this.open?.();
  }
  fireMessage(d: string): void {
    this.message?.(d);
  }
  // De hartslag zoals de relay hem stuurt: een protocol-ping, geen frame met
  // inhoud. Op een stil postvak is dit het enige dat er binnenkomt.
  firePing(): void {
    this.ping?.();
  }
  fireClose(code = 1006): void {
    this.close_?.(code);
  }
  fireError(e: unknown): void {
    this.error?.(e);
  }
}

// Nep-klok: we onthouden de geplande callbacks en vuren ze met de hand. Er zit
// ook een echte klok in (`advance`), want sommige gevallen gaan juist over de
// volgorde in de tijd: een hartslag die elke 30 seconden komt mag een deadline op
// 90 seconden nooit laten verstrijken, en dat is met losse timers niet te zien.
function fakeTimers() {
  let now = 0;
  const pending: Array<{ ms: number; due: number; fn: () => void; cleared: boolean }> = [];
  const setTimer = (fn: () => void, ms: number) => {
    const entry = { ms, due: now + ms, fn, cleared: false };
    pending.push(entry);
    return { clear: () => (entry.cleared = true) };
  };
  // Vuurt de eerste nog niet afgezegde timer met deze wachttijd.
  const fire = (ms: number): boolean => {
    const entry = pending.find((p) => p.ms === ms && !p.cleared);
    if (!entry) return false;
    entry.cleared = true;
    entry.fn();
    return true;
  };
  // Laat de klok lopen en vuurt onderweg alles wat aan de beurt is, op tijd en op
  // volgorde — ook timers die tijdens het lopen bijgezet worden.
  const advance = (ms: number): void => {
    const target = now + ms;
    for (;;) {
      const due = pending
        .filter((p) => !p.cleared && p.due <= target)
        .sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      due.cleared = true;
      now = due.due;
      due.fn();
    }
    now = target;
  };
  const live = () => pending.filter((p) => !p.cleared).map((p) => p.ms);
  // Hoeveel timers met deze wachttijd er in totaal zijn gezet, afgezegde
  // meegerekend. Nodig om te zien dat een deadline opnieuw is gezet: alleen naar
  // de lopende timers kijken kan dat niet, want dan is er zowel vóór als ná het
  // opschuiven precies één.
  const armed = (ms: number) => pending.filter((p) => p.ms === ms).length;
  return { setTimer, fire, advance, live, armed };
}

function harness(over: Partial<Parameters<typeof startPushManager>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const timers = fakeTimers();
  const events: string[] = [];
  let watchOk = true;
  const manager = startPushManager({
    config: { relayUrl: 'ws://localhost:8099', pushTopic: 'projects/p/topics/gmail-push' },
    accounts: () => ['a@x.nl'],
    accessToken: async () => 'token-1',
    armWatch: async (email) => {
      events.push(`watch:${email}`);
      return watchOk;
    },
    onSync: (email) => events.push(`sync:${email}`),
    onCoverage: (email, covered) => events.push(`cover:${email}:${covered}`),
    onFatal: (email, code) => events.push(`fatal:${email}:${code}`),
    transport: {
      connect: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    },
    setTimer: timers.setTimer,
    ...over,
  });
  return { manager, sockets, timers, events, setWatchOk: (v: boolean) => (watchOk = v) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('startPushManager', () => {
  it('authenticates, arms the watch, then catches up', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    expect(JSON.parse(h.sockets[0].sent[0])).toEqual({ type: 'auth', accessToken: 'token-1' });
    // Volgorde telt: pas als de watch staat is het account gedekt, en pas dan
    // mag de catch-up melden.
    expect(h.events).toEqual(['watch:a@x.nl', 'cover:a@x.nl:true', 'sync:a@x.nl']);
    h.manager.stop();
  });

  it('syncs on every sync frame', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage(JSON.stringify({ type: 'sync', historyId: '5000' }));
    expect(h.events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(2);
    h.manager.stop();
  });

  it('ignores a frame it does not understand instead of throwing', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage('dit is geen json');
    h.sockets[0].fireMessage(JSON.stringify({ type: 'ready' }));
    expect(h.events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(1);
    h.manager.stop();
  });

  it('does not cover the account when the watch fails', async () => {
    const h = harness();
    h.setWatchOk(false);
    h.sockets[0].fireOpen();
    await settle();
    expect(h.events).toEqual(['watch:a@x.nl']);
    expect(h.events).not.toContain('cover:a@x.nl:true');
    h.manager.stop();
  });

  it('does not send an auth frame without a token', async () => {
    const h = harness({ accessToken: async () => null });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.sockets[0].sent).toEqual([]);
    expect(h.events).toEqual([]);
    h.manager.stop();
  });

  it('reconnects with a growing wait after an unexpected close', async () => {
    const h = harness({ backoffMs: (attempt) => 100 * 2 ** attempt });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    expect(h.timers.live()).toContain(100);
    h.timers.fire(100);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].fireClose(1006);
    expect(h.timers.live()).toContain(200);
    h.manager.stop();
  });

  it('resets the wait once a connection sticks', async () => {
    const h = harness({ backoffMs: (attempt) => 100 * 2 ** attempt });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    h.timers.fire(100);
    h.sockets[1].fireOpen();
    await settle();
    h.sockets[1].fireClose(1006);
    expect(h.timers.live()).toContain(100); // weer vanaf het begin
    h.manager.stop();
  });

  it('hands coverage back once push has been away too long', async () => {
    const h = harness({ graceMs: 120_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    // Nog niet: een blip mag niets omschakelen.
    expect(h.events).not.toContain('cover:a@x.nl:false');
    h.timers.fire(120_000);
    expect(h.events).toContain('cover:a@x.nl:false');
    h.manager.stop();
  });

  it('keeps coverage when it reconnects inside the grace window', async () => {
    const h = harness({ graceMs: 120_000, backoffMs: () => 100 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(1006);
    h.timers.fire(100);
    h.sockets[1].fireOpen();
    await settle();
    expect(h.events).not.toContain('cover:a@x.nl:false');
    // Niet alleen geen omschakeling: de nog lopende afvaltimer moet ook echt
    // afgezegd zijn. Zonder die annulering zou deze test ook slagen als de
    // `state.grace?.clear()`-regel werd weggehaald — pas deze assertie merkt
    // dat de timer nog steeds klaarstaat om dekking alsnog terug te trekken.
    expect(h.timers.live()).not.toContain(120_000);
    h.manager.stop();
  });

  it('gives up and hands coverage back on a refusal it cannot fix', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403); // adres niet in ALLOWED_EMAILS van de relay
    expect(h.events).toContain('cover:a@x.nl:false');
    expect(h.events).toContain('fatal:a@x.nl:4403');
    expect(h.timers.live()).toEqual([]); // geen herverbinding meer
    h.manager.stop();
  });

  it('names the codes that are not worth retrying', () => {
    expect(FATAL_CLOSE_CODES).toEqual([4400, 4401, 4403]);
  });

  // Important 2, eerste helft. Een 4401 zegt "Google keurde dit token af", en dat
  // kan ook een hik in de tokencontrole van de relay zijn. Meteen definitief zijn
  // betekent dat één zo'n hik push voor élk account uitzet tot de app herstart.
  it('gives a first 4401 one more try with a genuinely fresh token', async () => {
    const refreshed: string[] = [];
    const h = harness({
      refreshToken: async (email) => {
        refreshed.push(email);
        return 'token-2';
      },
    });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    expect(refreshed).toEqual(['a@x.nl']); // en wel een échte verversing
    expect(h.sockets).toHaveLength(2); // meteen opnieuw, niet dood
    expect(h.events).not.toContain('fatal:a@x.nl:4401');
    h.sockets[1].fireOpen();
    await settle();
    expect(h.events).toContain('cover:a@x.nl:true');
    h.manager.stop();
  });

  // Important 2, tweede helft. Blijft het na die verversing, dan is het
  // definitief — en moet de aanroeper het horen, want alleen die kan de gebruiker
  // om nieuwe toestemming vragen.
  it('gives up after the second 4401 and says so', async () => {
    let n = 0;
    const h = harness({ refreshToken: async () => `token-${++n}` });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    h.sockets[1].fireClose(4401); // ook het verse token wordt geweigerd
    await settle();
    expect(n).toBe(1); // niet nóg een verversing
    expect(h.sockets).toHaveLength(2); // en geen derde poging
    expect(h.events).toContain('fatal:a@x.nl:4401');
    expect(h.events).toContain('cover:a@x.nl:false');
    expect(h.timers.live()).toEqual([]);
    h.manager.stop();
  });

  it('is final right away when there is no fresh token to be had', async () => {
    const h = harness({ refreshToken: async () => null });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    expect(h.sockets).toHaveLength(1);
    expect(h.events).toContain('fatal:a@x.nl:4401');
    h.manager.stop();
  });

  // De herkansing hoort bij de weigering, niet bij de levensduur van de app: een
  // relay die ons geaccepteerd heeft ({type:'ready'}) en dagen later een verlopen
  // token weigert, verdient weer één verversing.
  it('earns a new retry once the relay has actually accepted the token', async () => {
    let n = 0;
    const h = harness({ refreshToken: async () => `token-${++n}` });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    h.sockets[1].fireOpen();
    await settle();
    h.sockets[1].fireMessage(JSON.stringify({ type: 'ready' })); // de relay accepteerde ons
    h.sockets[1].fireClose(4401);
    await settle();
    expect(n).toBe(2); // opnieuw één verversing, geen definitieve weigering
    expect(h.events).not.toContain('fatal:a@x.nl:4401');
    expect(h.sockets).toHaveLength(3);
    h.manager.stop();
  });

  // De keerzijde daarvan, en de reden dat het bewijs uit {type:'ready'} moet komen
  // en niet uit onze eigen handdruk: users.watch lukt prima met een token dat de
  // e-mailscope mist (dat is een geldig Gmail-token), dus "watch gelukt" zegt
  // niets over wat de relay ervan vindt. Zou de herkansing daarop terugkomen, dan
  // ververst zo'n token eeuwig door: elke ronde een verversing plus een echte
  // users.watch, voor een verbinding die nooit gaat lukken.
  it('does not hand out a new retry just because our own handshake succeeded', async () => {
    let n = 0;
    const h = harness({ refreshToken: async () => `token-${++n}` });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4401);
    await settle();
    h.sockets[1].fireOpen(); // watch lukt, want het token is voor Gmail geldig
    await settle();
    h.sockets[1].fireClose(4401); // maar de relay weigert hem nog steeds
    await settle();
    expect(n).toBe(1);
    expect(h.events).toContain('fatal:a@x.nl:4401');
    expect(h.sockets).toHaveLength(2);
    h.manager.stop();
  });

  it('still refuses a 4403 on the spot: a fresh token changes nothing there', async () => {
    const refreshed: string[] = [];
    const h = harness({
      refreshToken: async (email) => {
        refreshed.push(email);
        return 'token-2';
      },
    });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403); // adres niet in ALLOWED_EMAILS van de relay
    await settle();
    expect(refreshed).toEqual([]);
    expect(h.events).toContain('fatal:a@x.nl:4403');
    h.manager.stop();
  });

  it('renews the watch on its own clock', async () => {
    const h = harness({ renewMs: 86_400_000 });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.timers.fire(86_400_000)).toBe(true);
    await settle();
    expect(h.events.filter((e) => e === 'watch:a@x.nl')).toHaveLength(2);
    // En hij plant zichzelf opnieuw in.
    expect(h.timers.live()).toContain(86_400_000);
    h.manager.stop();
  });

  it('reconnects when the socket goes silent', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.timers.advance(90_000); // negentig seconden werkelijk niets
    expect(h.sockets[0].closed).toBe(true);
    h.manager.stop();
  });

  // Critical 1. De hartslag van de relay is een protocol-ping (`ws.ping()`, elke
  // 30 seconden), geen frame met inhoud: `ws` levert die af als een
  // 'ping'-gebeurtenis en nooit als 'message'. Werd die niet gezien, dan verliep
  // de stilte-deadline op élk stil postvak — en dan brak de manager elke 91
  // seconden een gezonde verbinding af, registreerde opnieuw een watch en deed een
  // volledige catch-up: precies de pollende achtervang die de spec uitsluit.
  it('takes the relay heartbeat ping as a sign of life', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.timers.armed(90_000)).toBe(1); // de handdruk zette de eerste deadline
    h.sockets[0].firePing();
    // Opnieuw gezet: de oude deadline is afgezegd, er staat een nieuwe.
    expect(h.timers.armed(90_000)).toBe(2);
    expect(h.timers.live().filter((ms) => ms === 90_000)).toHaveLength(1);
    h.manager.stop();
  });

  it('keeps a quiet mailbox connected on nothing but pings', async () => {
    const h = harness({ staleMs: 90_000, renewMs: 86_400_000 });
    h.sockets[0].fireOpen();
    await settle();
    // Een uur zoals de relay het echt doet: elke 30 seconden een ping en verder
    // niets, want er komt geen mail binnen.
    for (let i = 0; i < 120; i++) {
      h.timers.advance(30_000);
      h.sockets[0].firePing();
    }
    expect(h.sockets[0].closed).toBe(false);
    expect(h.sockets).toHaveLength(1); // geen enkele herverbinding
    expect(h.events.filter((e) => e === 'watch:a@x.nl')).toHaveLength(1); // één watch
    expect(h.events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(1); // alleen de catch-up
    expect(h.events).not.toContain('cover:a@x.nl:false');
    h.manager.stop();
  });

  it('pushes the silence deadline back on an application frame too', async () => {
    const h = harness({ staleMs: 90_000 });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireMessage(JSON.stringify({ type: 'ready' }));
    expect(h.timers.armed(90_000)).toBe(2);
    expect(h.timers.live().filter((ms) => ms === 90_000)).toHaveLength(1);
    h.manager.stop();
  });

  it('cleans everything up on stop', async () => {
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.manager.stop();
    expect(h.sockets[0].closed).toBe(true);
    expect(h.timers.live()).toEqual([]);
    h.sockets[0].fireClose(1006);
    expect(h.sockets).toHaveLength(1); // geen herverbinding na stop
  });

  it('connects an account that appears later and drops one that goes away', async () => {
    let list = ['a@x.nl'];
    const h = harness({ accounts: () => list });
    h.sockets[0].fireOpen();
    await settle();
    list = ['a@x.nl', 'b@x.nl'];
    h.manager.refresh();
    expect(h.sockets).toHaveLength(2);
    list = ['b@x.nl'];
    h.manager.refresh();
    expect(h.sockets[0].closed).toBe(true);
    expect(h.events).toContain('cover:a@x.nl:false');
    // Het lokaal sluiten van de socket vuurt zelf een close-event (zoals een
    // echte ws-verbinding ook doet). Dat mag het verwijderde account niet via
    // de normale herverbindingslogica laten herleven: geen nieuwe socket, geen
    // reconnect-timer.
    expect(h.sockets).toHaveLength(2);
    expect(h.timers.live()).toEqual([]);
    h.manager.stop();
  });

  it('ignores a stale handshake once stop() has already run', async () => {
    // Simuleert de race uit Critical 2: de open-handler hangt nog op een
    // token terwijl de manager al gestopt is. Zonder de leefbaarheidscheck zou
    // hij na het alsnog binnenkomen van het token nog een auth-frame sturen.
    let resolveToken: (t: string | null) => void = () => {};
    const tokenPromise = new Promise<string | null>((res) => {
      resolveToken = res;
    });
    const h = harness({ accessToken: async () => tokenPromise });
    h.sockets[0].fireOpen();
    h.manager.stop();
    resolveToken('token-1');
    await settle();
    expect(h.sockets[0].sent).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('ignores a stale handshake once a fatal refusal already handled the close', async () => {
    // Zelfde race, maar dan met een 4403 die tussentijds binnenkomt terwijl de
    // watch-aanroep nog hangt. Zonder de leefbaarheidscheck zou de trage watch
    // de permanente afwijzing ongedaan maken: dekking weer aan en een catch-up
    // melden voor een account dat net geweigerd is.
    const sockets: FakeSocket[] = [];
    const events: string[] = [];
    let resolveWatch: (ok: boolean) => void = () => {};
    const watchPromise = new Promise<boolean>((res) => {
      resolveWatch = res;
    });
    const manager = startPushManager({
      config: { relayUrl: 'ws://localhost:8099', pushTopic: 'projects/p/topics/gmail-push' },
      accounts: () => ['a@x.nl'],
      accessToken: async () => 'token-1',
      armWatch: async (email) => {
        events.push(`watch:${email}`);
        return watchPromise; // blijft hangen tot de test hem lost
      },
      onSync: (email) => events.push(`sync:${email}`),
      onCoverage: (email, covered) => events.push(`cover:${email}:${covered}`),
      onFatal: (email, code) => events.push(`fatal:${email}:${code}`),
      transport: {
        connect: () => {
          const s = new FakeSocket();
          sockets.push(s);
          return s;
        },
      },
      setTimer: fakeTimers().setTimer,
    });
    sockets[0].fireOpen();
    await settle();
    sockets[0].fireClose(4403); // adres niet in ALLOWED_EMAILS van de relay
    expect(events).toContain('fatal:a@x.nl:4403');
    resolveWatch(true); // de trage aanroep komt alsnog terug, te laat om nog te tellen
    await settle();
    expect(events).not.toContain('cover:a@x.nl:true');
    expect(events.filter((e) => e === 'sync:a@x.nl')).toHaveLength(0);
    manager.stop();
  });

  it('ignores a non-fatal close that lands while the watch is still pending', async () => {
    // Residual 1: generatie en kaart-identiteit blijven allebei ongewijzigd
    // tijdens een niet-fatale sluiting die vóór de reconnect-timer afgaat, dus
    // die twee checks alleen zien deze sluiting niet. Zonder de socket-check
    // erbij zou de trage watch-aanroep alsnog dekking aanzetten, de
    // hartslag/vernieuwingstimers zetten, én de backoff-teller resetten — dus
    // een sluiting die zich blijft herhalen zou nooit verder dan de basiswacht
    // komen en de relay met een vaste tussenpoos blijven bestoken.
    let resolveWatch: (ok: boolean) => void = () => {};
    const watchPromise = new Promise<boolean>((res) => {
      resolveWatch = res;
    });
    const h = harness({
      armWatch: async () => watchPromise, // blijft hangen tot de test hem lost
      backoffMs: (attempt) => 100 * 2 ** attempt,
      staleMs: 90_000,
      renewMs: 86_400_000,
    });
    h.sockets[0].fireOpen();
    await settle(); // token verstuurd, watch hangt nog
    h.sockets[0].fireClose(1006); // niet-fatale sluiting tussendoor
    expect(h.timers.live()).toContain(100); // backoff voor poging 0, meteen bij de sluiting
    resolveWatch(true); // de trage watch komt alsnog terug, te laat
    await settle();
    // De socket is al weg: geen dekking, geen hartslag- of vernieuwingstimer.
    expect(h.events).not.toContain('cover:a@x.nl:true');
    expect(h.timers.live()).not.toContain(90_000);
    expect(h.timers.live()).not.toContain(86_400_000);
    // En de backoff-teller is niet stiekem gereset: de volgende sluiting
    // escaleert door in plaats van terug te vallen op de basiswacht.
    h.timers.fire(100);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].fireClose(1006);
    expect(h.timers.live()).toContain(200); // niet terug naar 100
    h.manager.stop();
  });

  it('reconnects after a failed watch renewal instead of waiting a full day', async () => {
    // Residual 2: dezelfde soort mislukking als een mislukte eerste watch
    // (Important 3), en dus dezelfde oplossing — socket dicht, bestaande
    // backoff regelt de volgende poging — in plaats van 24 uur te wachten op
    // de volgende geplande vernieuwing terwijl er niets aan gedaan wordt.
    const h = harness({ renewMs: 86_400_000, backoffMs: () => 50 });
    h.sockets[0].fireOpen();
    await settle();
    h.setWatchOk(false); // de volgende watch-aanroep — de vernieuwing — mislukt
    h.timers.fire(86_400_000);
    await settle();
    expect(h.events).toContain('cover:a@x.nl:false');
    expect(h.sockets[0].closed).toBe(true);
    // Geen tweede wachttijd van 24 uur: de gewone backoff regelt de volgende
    // poging, niet een nieuwe vernieuwingscyclus.
    expect(h.timers.live()).toContain(50);
    expect(h.timers.live()).not.toContain(86_400_000);
    h.manager.stop();
  });

  it('revives a permanently refused account once refresh() runs again', async () => {
    // Finding A: refresh() betekent "de wereld is veranderd, kijk opnieuw".
    // Zonder herleving blijft een eerder geweigerd account dood totdat de app
    // herstart, ook nadat de gebruiker opnieuw toestemming heeft gegeven.
    const h = harness();
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403); // adres niet in ALLOWED_EMAILS van de relay
    expect(h.events).toContain('fatal:a@x.nl:4403');
    h.manager.refresh(); // de aanroeper belt dit aan zodra hertoestemming binnen is
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].fireOpen();
    await settle();
    expect(h.events).toContain('cover:a@x.nl:true');
    h.manager.stop();
  });
});

describe('gemachtigde postvakken', () => {
  it('logt in als de eigenaar en vraagt daarna om omgelegd te worden', async () => {
    const h = harness({
      accounts: () => ['bart@x.nl'],
      accessToken: async () => 'owner-token',
      subscribeAs: (email: string) => email,
    });
    h.sockets[0].fireOpen();
    await settle();
    expect(JSON.parse(h.sockets[0].sent[0])).toEqual({ type: 'auth', accessToken: 'owner-token' });
    expect(JSON.parse(h.sockets[0].sent[1])).toEqual({ type: 'subscribe', mailbox: 'bart@x.nl' });
    h.manager.stop();
  });

  it('claimt geen dekking tot de relay de omlegging bevestigt', async () => {
    const h = harness({
      accounts: () => ['bart@x.nl'],
      subscribeAs: (email: string) => email,
    });
    h.sockets[0].fireOpen();
    await settle();
    // De watch staat, maar er routeert hier nog niets heen — dus de webview moet
    // de teller houden. Dekking aanzetten zou hem juist het zwijgen opleggen.
    expect(h.events).toEqual(['watch:bart@x.nl']);

    h.sockets[0].fireMessage(JSON.stringify({ type: 'subscribed', mailbox: 'bart@x.nl' }));
    expect(h.events).toEqual(['watch:bart@x.nl', 'cover:bart@x.nl:true', 'sync:bart@x.nl']);
    h.manager.stop();
  });

  it('laat een eigen account precies zoals het was', async () => {
    const h = harness({ subscribeAs: () => null });
    h.sockets[0].fireOpen();
    await settle();
    expect(h.sockets[0].sent).toHaveLength(1); // alleen auth, geen subscribe
    expect(h.events).toEqual(['watch:a@x.nl', 'cover:a@x.nl:true', 'sync:a@x.nl']);
    h.manager.stop();
  });

  it('houdt op met proberen als de relay de omlegging weigert', async () => {
    const h = harness({
      accounts: () => ['bart@x.nl'],
      subscribeAs: (email: string) => email,
    });
    h.sockets[0].fireOpen();
    await settle();
    h.sockets[0].fireClose(4403);
    expect(h.events).toContain('fatal:bart@x.nl:4403');
    h.manager.stop();
  });
});
