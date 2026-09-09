import { schema, t } from "@colyseus/schema";

export type PlayerSide = 'top' | 'right' | 'bottom' | 'left';

export const PlayerState = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  side: t.string(),
  computer: t.boolean(),
});

export const QoudState = schema({
  code: t.string(),
  status: t.string(),
  hostSessionId: t.string(),
  settingsJson: t.string(),
  scores: t.map("number"),
  players: t.map(PlayerState),
  worldW: t.number(),
  worldH: t.number(),
  maxPlayers: t.number(),
});

export const QoudRoomState = QoudState;
export { QoudState as QoudStateClass };