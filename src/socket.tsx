import { Client } from '@colyseus/sdk';

type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string };
type RoomData = { code: string; players: Player[]; maxPlayers: number; status: 'waiting' | 'playing'; createdAt?: number; hostName?: string; hostSocketId?: string; settings?: any; series?: any; isPaused?: boolean; worldW?: number; worldH?: number };
type SocketListener = (...args: any[]) => void;

class ColyseusBridge {
  room: any = null;
  listeners = new Map<string, Set<SocketListener>>();
  private lastPaddleEmit = 0;
  private lastPaddlePos = { x: 0, y: 0 };
  private seq = 0;
  public inputHistory: Array<{seq:number, x:number, y:number, vx:number, vy:number, t:number}> = [];

  get connected() { return Boolean(this.room); }
  get id() { return this.room?.sessionId ?? ''; }

  on(event: string, listener: SocketListener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }
  off(event: string, listener?: SocketListener) {
    if (!listener) this.listeners.delete(event);
    else this.listeners.get(event)?.delete(listener);
    return this;
  }
  emit(event: string, payload?: unknown) {
    if (!this.room) return false;
    this.room.send(event, payload);
    return true;
  }
  sendPaddleTarget(x: number, y: number, vx?: number, vy?: number) {
    const now = performance.now();
    if (now - this.lastPaddleEmit < 16) return; // FIXED: was 5ms - 16ms = 60Hz = less lag + less bandwidth
    const dt = Math.max(0.001, (now - this.lastPaddleEmit) / 1000);
    const computedVx = vx !== undefined ? vx : (x - this.lastPaddlePos.x) / dt;
    const computedVy = vy !== undefined ? vy : (y - this.lastPaddlePos.y) / dt;
    this.lastPaddleEmit = now;
    this.lastPaddlePos = { x, y };
    this.seq++;
    this.inputHistory.push({ seq: this.seq, x, y, vx: computedVx, vy: computedVy, t: Date.now() });
    if (this.inputHistory.length > 60) this.inputHistory.shift();
    this.emit('paddle-target', { x, y, vx: computedVx, vy: computedVy, seq: this.seq, t: Date.now() });
  }
  attach(room: any) {
    this.room = room;
    const messageTypes = ['room-update', 'game-started', 'goal-scored', 'round-finished', 'next-round', 'series-started', 'match-finished', 'host-left', 'hit-effect', 'countdown', 'game-state', 'paddle-input', 'player-ready', 'all-players-ready', 'pause-update', 'game-paused', 'pause-state'];
    for (const messageType of messageTypes) {
      room.onMessage(messageType, (payload: unknown) => this.dispatch(messageType, payload));
    }
    room.onStateChange((state: any) => this.dispatch('room-update', this.roomData(state)));
    room.onError?.((code: number, message: string) => this.dispatch('error', message || `Connection error (${code})`));
    room.onLeave?.((code: number) => {
      if (this.room !== room) return;
      if (code === 1000 || (code as any) === 4000) { this.room = null; return; }
      if (this.room === room) this.dispatch('connection-lost', code);
    });
    if (room.state) this.dispatch('room-update', this.roomData(room.state));
  }
  async leave() {
    const room = this.room;
    this.room = null;
    if (room) {
      try { (room as any)._reconnectionToken = null; (room as any).connection?.close(); await room.leave(true); } catch {}
    }
  }
  private dispatch(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((l) => { try { l(...args); } catch {} });
  }
  private roomData(state: any): RoomData {
    const players = state?.players ? Array.from(state.players.values()).map((p: any) => ({ id: p.id, name: p.name, color: p.color, side: p.side, computer: Boolean(p.computer), socketId: p.id, })) : [];
    let settings: any; try { settings = state?.settingsJson ? JSON.parse(state.settingsJson) : undefined; } catch {}
    let series: any = undefined;
    try {
      series = {
        currentRound: (state as any).currentRound ?? 1,
        totalRounds: (state as any).totalRounds ?? 3,
        seriesType: (state as any).seriesType ?? 'single',
        seriesWins: state?.seriesWins ? Object.fromEntries(state.seriesWins.entries()) : {},
        roundHistory: (state as any).roundHistoryJson ? JSON.parse((state as any).roundHistoryJson) : [],
      };
    } catch {}
    return { code: state?.code ?? '', status: state?.status ?? 'waiting', maxPlayers: Number(state?.maxPlayers ?? players.length), hostSocketId: state?.hostSessionId, hostName: players.find((p: Player) => p.id === state?.hostSessionId)?.name, players, settings, series, isPaused: Boolean(state?.isPaused), worldW: state?.worldW ? Number(state.worldW) : undefined, worldH: state?.worldH ? Number(state.worldH) : undefined, };
  }
}

function getColyseusEndpoint() {
  const envUrl = (import.meta as any).env?.VITE_COLYSEUS_URL;
  if (envUrl) return envUrl;
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }
  return 'ws://localhost:3000';
}

// FIX: Lazy client to avoid TDZ H error
let _client: Client | null = null;
function getClient(): Client {
  if (!_client) {
    _client = new Client(getColyseusEndpoint());
    (_client as any).reconnectionAttempts = 1;
  }
  return _client;
}

export const colyseus: Client = new Proxy({} as any, {
  get(_t, prop) {
    const c = getClient();
    const v = (c as any)[prop];
    return typeof v === 'function' ? v.bind(c) : v;
  }
}) as any;

export const socket = new ColyseusBridge();
export type { RoomData };
