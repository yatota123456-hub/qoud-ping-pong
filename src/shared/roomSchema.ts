import { schema, t } from "@colyseus/schema";

export type PlayerSide = 'top' | 'right' | 'bottom' | 'left';

export const BallState = schema({
  x: t.number(),
  y: t.number(),
  vx: t.number(),
  vy: t.number(),
  visible: t.boolean(),
});

export const PaddleState = schema({
  x: t.number(),
  y: t.number(),
});

export const PlayerState = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  side: t.string(),
  computer: t.boolean(),
});

export const QoudRoomState = schema({
  code: t.string(),
  status: t.string(),
  hostSessionId: t.string(),
  settingsJson: t.string(),
  scores: t.map("number"),
  players: t.map(PlayerState),
  
  worldW: t.number(),
  worldH: t.number(),
  maxPlayers: t.number(),
  
  ball: BallState,
  paddles: t.map(PaddleState),
  
  countdown: t.number(),
  countdownSide: t.string(),
  rally: t.number(),
  timeLeft: t.number(),

  currentRound: t.number(),
  totalRounds: t.number(),
  seriesType: t.string(),
  seriesWins: t.map("number"),
  roundHistoryJson: t.string(),
});

export const QoudState = QoudRoomState;
export { QoudRoomState as QoudStateClass };

export type ArenaSize = 'small' | 'medium' | 'large' | 'xlarge';
export const ARENA_SCALES: Record<ArenaSize, number> = { small: 0.85, medium: 1.0, large: 1.35, xlarge: 1.65 };
export const RECTANGULAR_WORLD = { w: 700, h: 1050 };
export const SQUARE_WORLD = { w: 1000, h: 1000 };
export const BALL_RADIUS = 14;
export const PADDLE_RADIUS = 28;
export const BORDER_THICKNESS = 28;

export function getArenaWorld(playersCount: number, arenaSize: ArenaSize = 'medium') {
  const baseWorld = playersCount >= 3 ? SQUARE_WORLD : RECTANGULAR_WORLD;
  const scale = ARENA_SCALES[arenaSize] || 1.0;
  return {
    w: Math.round(baseWorld.w * scale),
    h: Math.round(baseWorld.h * scale),
  };
}

export function clampPaddlePosition(
  side: PlayerSide,
  x: number,
  y: number,
  worldW: number,
  worldH: number,
  isMultiplayer4: boolean
): { x: number; y: number } {
  const pad = BORDER_THICKNESS + PADDLE_RADIUS;
  if (!isMultiplayer4) {
    if (side === 'top') {
      return {
        x: Math.max(pad, Math.min(worldW - pad, x)),
        y: Math.max(pad, Math.min(worldH * 0.40, y)),
      };
    }
    return {
      x: Math.max(pad, Math.min(worldW - pad, x)),
      y: Math.max(worldH * 0.60, Math.min(worldH - pad, y)),
    };
  } else {
    if (side === 'top') {
      return {
        x: Math.max(pad, Math.min(worldW - pad, x)),
        y: Math.max(pad, Math.min(worldH * 0.35, y)),
      };
    }
    if (side === 'bottom') {
      return {
        x: Math.max(pad, Math.min(worldW - pad, x)),
        y: Math.max(worldH * 0.65, Math.min(worldH - pad, y)),
      };
    }
    if (side === 'left') {
      return {
        x: Math.max(pad, Math.min(worldW * 0.35, x)),
        y: Math.max(pad, Math.min(worldH - pad, y)),
      };
    }
    return {
      x: Math.max(worldW * 0.65, Math.min(worldW - pad, x)),
      y: Math.max(pad, Math.min(worldH - pad, y)),
    };
  }
}

