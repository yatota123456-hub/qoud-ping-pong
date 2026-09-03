import { Client } from '@colyseus/sdk';

export type Player = {
  id: number | string;
  name: string;
  color: string;
  side: 'top' | 'right' | 'bottom' | 'left';
  computer: boolean;
  socketId?: string;
};

export type RoomData = {
  code: string;
  players: Player[];
  maxPlayers: number;
  status: 'waiting' | 'playing';
  createdAt?: number;
  hostName?: string;
  hostSocketId?: string;
  settings?: Record<string, unknown>;
};

type SocketListener = (...args: any[]) => void;

class ColyseusBridge {
  room: any = null;
  private listeners = new Map<string, Set<SocketListener>>();

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
  attach(room: any) {
    this.room = room;
    for (const messageType of ['room-update', 'game-started', 'goal-scored', 'match-finished', 'host-left', 'game-state', 'paddle-input']) {
      room.onMessage(messageType, (payload: unknown) => this.dispatch(messageType, payload));
    }
    room.onStateChange((state: any) => this.dispatch('room-update', this.roomData(state)));
    room.onError?.((code: number, message: string) => this.dispatch('error', message || `Connection error (${code})`));
    room.onLeave?.((code: number) => {
      if (this.room === room) this.dispatch('connection-lost', code);
    });
    if (room.state) this.dispatch('room-update', this.roomData(room.state));
  }
  async leave() {
    const room = this.room;
    this.room = null;
    if (room) await room.leave(true);
  }
  private dispatch(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
  private roomData(state: any): RoomData {
    const players = state?.players ? Array.from(state.players.values()).map((player: any) => ({
      id: player.id, name: player.name, color: player.color, side: player.side,
      computer: Boolean(player.computer), socketId: player.id,
    })) : [];
    let settings: Record<string, unknown> | undefined;
    try { settings = state?.settingsJson ? JSON.parse(state.settingsJson) : undefined; } catch {}
    return {
      code: state?.code ?? '',
      status: state?.status ?? 'waiting',
      maxPlayers: Number(state?.maxPlayers ?? players.length),
      hostSocketId: state?.hostSessionId,
      hostName: players.find((player: Player) => player.id === state?.hostSessionId)?.name,
      players,
      settings,
    };
  }
}

// Single shared instance used by App.tsx and GameScreen3D.tsx so both
// the 2D and 3D game screens see the same connection / session id.
export const socket = new ColyseusBridge();
export const colyseus = new Client(window.location.origin);