import { schema, t, type SchemaType } from '@colyseus/schema';

export type PlayerSide = 'top' | 'right' | 'bottom' | 'left';

export const PlayerState = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  side: t.string(),
  computer: t.boolean(),
}, 'PlayerState');

export type PlayerState = SchemaType<typeof PlayerState>;

export const QoudRoomState = schema({
  code: t.string(),
  status: t.string(),
  maxPlayers: t.number(),
  hostSessionId: t.string(),
  settingsJson: t.string(),
  players: t.map(PlayerState),
  scores: t.map('number'),
}, 'QoudRoomState');

export type QoudRoomState = SchemaType<typeof QoudRoomState>;