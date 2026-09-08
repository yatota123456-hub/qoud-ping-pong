import { Client } from '@colyseus/sdk';

export type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string; };
export type RoomData = { code: string; players: Player[]; maxPlayers: number; status: 'waiting' | 'playing'; hostName?: string; hostSocketId?: string; settings?: Record<string, unknown>; };
type SocketListener = (...args: any[]) => void;

class ColyseusBridge {
  room: any = null;
  private listeners = new Map<string, Set<SocketListener>>();
  private lastPaddleEmit = 0;

  get connected() { return Boolean(this.room); }
  get id() { return this.room?.sessionId ?? ''; }
  get state() { return this.room?.state; } // ← الآن تقرأ مباشرة من room.state (ball, paddles, scores, etc)

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

  emit(event: string, payload?: any) {
    if (!this.room) return false;
    this.room.send(event, payload);
    return true;
  }

  // ← الطريقة الجديدة: أرسل موضع المضرب فقط بمعدل منخفض (30Hz)
  sendPaddleTarget(x: number, y: number) {
    if (!this.room) return;
    const now = Date.now();
    if (now - this.lastPaddleEmit < 33) return; // ~30Hz
    this.lastPaddleEmit = now;
    this.room.send('paddle-target', { x, y });
  }

  attach(room: any) {
    this.room = room;
    // تسمع على الأحداث فقط (مو على game-state بعد - لأنها Schema الآن)
    for (const messageType of ['room-update', 'game-started', 'goal-scored', 'match-finished', 'host-left', 'hit-effect']) {
      room.onMessage(messageType, (payload: unknown) => this.dispatch(messageType, payload));
    }
    room.onStateChange((state: any) => this.dispatch('room-update', this.roomData(state)));
    room.onError?.((code: number, message: string) => this.dispatch('error', message || `Connection error (${code})`));
    room.onLeave?.((code: number) => { if (this.room === room) this.dispatch('connection-lost', code); });
    if (room.state) this.dispatch('room-update', this.roomData(room.state));
  }

  async leave() { const room = this.room; this.room = null; if (room) await room.leave(true); }
  private dispatch(event: string, ...args: any[]) { this.listeners.get(event)?.forEach((l) => l(...args)); }
  private roomData(state: any): RoomData {
    const players = state?.players ? Array.from(state.players.values()).map((p: any) => ({
      id: p.id, name: p.name, color: p.color, side: p.side, computer: Boolean(p.computer), socketId: p.id,
    })) : [];
    let settings: Record<string, unknown> | undefined;
    try { settings = state?.settingsJson ? JSON.parse(state.settingsJson) : undefined; } catch {}
    return { code: state?.code ?? '', status: state?.status ?? 'waiting', maxPlayers: Number(state?.maxPlayers ?? players.length), hostSocketId: state?.hostSessionId, hostName: players.find((p: Player) => p.id === state?.hostSessionId)?.name, players, settings };
  }
}
export const socket = new ColyseusBridge();
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string) || window.location.origin;
export const colyseus = new Client(SERVER_URL);