import { Client } from '@colyseus/sdk';

type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string };
type RoomData = { code: string; players: Player[]; maxPlayers: number; status: 'waiting' | 'playing'; createdAt?: number; hostName?: string; hostSocketId?: string; settings?: any; series?: any };

type SocketListener = (...args: any[]) => void;

class ColyseusBridge {
  room: any = null;
  listeners = new Map<string, Set<SocketListener>>();
  private lastPaddleEmit = 0;
  private lastPaddlePos = { x: 0, y: 0 };

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
  sendPaddleTarget(x: number, y: number) {
    const now = performance.now();
    const dx = x - this.lastPaddlePos.x;
    const dy = y - this.lastPaddlePos.y;
    const distSq = dx*dx + dy*dy;
    if (distSq < 4 && now - this.lastPaddleEmit < 32) return;
    if (now - this.lastPaddleEmit < 16) return;
    this.lastPaddleEmit = now;
    this.lastPaddlePos = { x, y };
    this.emit('paddle-target', { x: Math.round(x), y: Math.round(y) });
  }
  attach(room: any) {
    this.room = room;
    const messageTypes = [
      'room-update', 'game-started', 'goal-scored', 
      'round-finished', 'next-round', 'series-started', 
      'match-finished', 'host-left', 'hit-effect', 
      'countdown', 'game-state', 'paddle-input'
    ];
    for (const messageType of messageTypes) {
      room.onMessage(messageType, (payload: unknown) => this.dispatch(messageType, payload));
    }
    room.onStateChange((state: any) => this.dispatch('room-update', this.roomData(state)));
    room.onError?.((code: number, message: string) => this.dispatch('error', message || `Connection error (${code})`));
    room.onLeave?.((code: number) => { if (this.room === room) this.dispatch('connection-lost', code); });
    if (room.state) this.dispatch('room-update', this.roomData(room.state));
  }
  async leave() {
    const room = this.room;
    this.room = null;
    if (room) { try { await room.leave(true); } catch {} }
  }
  private dispatch(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((l) => { try { l(...args); } catch {} });
  }
  private roomData(state: any): RoomData {
    const players = state?.players ? Array.from(state.players.values()).map((p: any) => ({
      id: p.id, name: p.name, color: p.color, side: p.side, computer: Boolean(p.computer), socketId: p.id,
    })) : [];
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
    return {
      code: state?.code ?? '', status: state?.status ?? 'waiting',
      maxPlayers: Number(state?.maxPlayers ?? players.length),
      hostSocketId: state?.hostSessionId,
      hostName: players.find((p: Player) => p.id === state?.hostSessionId)?.name,
      players, settings, series,
    };
  }
}

function getColyseusEndpoint() {
  // الرابط الجديد الصحيح الذي ظهر في الـ Terminal الخاص بك
  const FLY_URL = 'wss://qoud-ping-pong-tqk-6q.fly.dev';
  
  const envUrl = (import.meta as any).env?.VITE_COLYSEUS_URL;
  if (envUrl) return envUrl;
  
  // إذا كنا في بيئة الإنتاج، نستخدم الرابط الصحيح
  if (window.location.hostname !== 'localhost') {
    return FLY_URL;
  }
  
  // للبيئة المحلية
  return `ws://${window.location.hostname}:2567`;
}



export const colyseus = new Client(getColyseusEndpoint());
export const socket = new ColyseusBridge();
