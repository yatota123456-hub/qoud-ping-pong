import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import * as THREE from 'three';
import { Check, ChevronLeft, ChevronRight, CircleHelp, Crown, Gauge, Gamepad2, Keyboard, LogIn, Minus, Monitor, Pause, Play, Plus, RotateCcw, Settings2, SlidersHorizontal, Sparkles, Swords, Trophy, Volume2, X, Zap, ArrowLeft, VolumeX, Timer } from 'lucide-react';
import { Client } from '@colyseus/sdk';
import { useTranslation } from 'react-i18next';
import { GameScreen3D } from './components/GameScreen3D';

type Screen = 'setup' | 'waiting' | 'game' | 'results';
type StartMode = 'paddle' | 'center';
type SpeedMode = 'gradual' | 'fixed' | 'never_reset';
type MatchMode = 'time' | 'goals';
type Difficulty = 'easy' | 'normal' | 'hard';
type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string };
type ArenaSize = 'small' | 'medium' | 'large' | 'xlarge';

type Settings = {
  players: number;
  vsComputer: boolean;
  difficulty: Difficulty;
  start: StartMode;
  mode: MatchMode;
  duration: number;
  goal: number;
  speed: SpeedMode;
  ballSpeed: number;
  sound: boolean;
  graphics: '2d' | '3d';
  arenaSize: ArenaSize;
};
type Scores = Record<string | number, number>;
type RoomData = { code: string; players: Player[]; maxPlayers: number; status: 'waiting' | 'playing'; createdAt?: number; hostName?: string; hostSocketId?: string; settings?: Partial<Settings> };
type Vec2 = { x: number; y: number };

const ARENA_SCALES: Record<ArenaSize, number> = {
  small: 0.8,
  medium: 1.0,
  large: 1.25,
  xlarge: 1.5,
};
const COLORS = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
const SIDES: Player['side'][] = ['bottom', 'top', 'right', 'left'];
const RECTANGULAR_WORLD = { w: 800, h: 1250 };
const SQUARE_WORLD = { w: 1200, h: 1200 };
const ZONE = 100;
const PADDLE_SIZE = 42;

const defaultSettings = { players: 2, vsComputer: true, difficulty: 'normal', start: 'center', mode: 'time', duration: 180, goal: 7, speed: 'never_reset', ballSpeed: 10, sound: true, graphics: '2d',arenaSize: 'medium' } as Settings;

function randomRoom(existing: string[] = []) { let c=''; do{ c=Math.random().toString(36).slice(2, 6).toUpperCase(); }while(existing.includes(c)); return c; }
function loadWins(): Record<string, number> { try { return JSON.parse(localStorage.getItem('qoud-ping-pong-wins') ?? '{}') as Record<string, number>; } catch { return {}; } }

type SocketListener = (...args: any[]) => void;
class ColyseusBridge {
  room: any = null;
  listeners = new Map<string, Set<SocketListener>>();
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
    let settings: Partial<Settings> | undefined;
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

function getArenaWorld(playersCount: number, arenaSize: ArenaSize = 'medium') {
  const baseWorld = playersCount === 4 ? SQUARE_WORLD : RECTANGULAR_WORLD;
  const scale = ARENA_SCALES[arenaSize] || 1.0;
  return {
    w: baseWorld.w * scale,
    h: baseWorld.h * scale,
  };
}
const socket = new ColyseusBridge();
const colyseus = new Client(window.location.origin);

function App() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar') ?? true;
  const [screen, setScreen] = useState<Screen>('setup');
  const [settings, setSettings] = useState<Settings>(() => {
    try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem('qoud-ping-pong-settings') ?? '{}') as Partial<Settings> }; } catch { return defaultSettings; }
  });
  const [room, setRoom] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [names, setNames] = useState(['نورا', 'سامي', 'ليان', 'كريم']);
  const [computers, setComputers] = useState<boolean[]>([false, true, true, true]);
  const [scores, setScores] = useState<Scores>({});
  const [wins, setWins] = useState<Record<string, number>>(loadWins);
  const [winner, setWinner] = useState<Player | null>(null);
  const [lastGoal, setLastGoal] = useState<string | null>(null);
  const [matchPaused, setMatchPaused] = useState(false);
  const [matchKey, setMatchKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(true);
  const [roomsCount, setRoomsCount] = useState(0);

  useEffect(() => {
    void fetch('/api/rooms')
      .then((response) => response.ok ? response.json() as Promise<{ count?: number }> : null)
      .then((data) => { if (data?.count !== undefined) setRoomsCount(data.count); })
      .catch(() => {});

    socket.on('room-created', (roomData: RoomData) => {
      setRoom(roomData.code); setPlayers(roomData.players); setIsHost(true); setError(''); setScreen('waiting');
    });
    socket.on('joined', (roomData: RoomData) => {
      setRoom(roomData.code); setPlayers(roomData.players); setIsHost(false); setError(''); setScreen('waiting');
    });
    socket.on('room-update', (roomData: RoomData) => {
      setRoom(roomData.code || room);
      setPlayers(roomData.players);
      if (roomData.settings && screen !== 'game') setSettings((current) => ({ ...current, ...roomData.settings }));
      if (roomData.hostSocketId) setIsHost(roomData.hostSocketId === socket.id);
      if (roomData.status === 'playing' && screen === 'waiting') {
        setWinner(null); setLastGoal(null); setMatchPaused(false); setMatchKey((key) => key + 1); setScreen('game');
      }
    });
    socket.on('game-started', () => {
      setWinner(null); setLastGoal(null); setMatchPaused(false); setMatchKey((key) => key + 1); setScreen('game');
    });
    socket.on('match-finished', ({ winnerId, scores: serverScores }) => {
      setScores(serverScores);
      setWinner(players.find((player) => player.id === winnerId) ?? null);
      setScreen('results');
    });
    socket.on('goal-scored', ({ scores: serverScores, missedSide }) => {
      setScores(serverScores);
      const missed = players.find((player) => player.side === missedSide);
      if (missed) {
        setLastGoal(missed.name);
        window.setTimeout(() => setLastGoal(null), 1300);
      }
    });
    socket.on('error', (msg: string) => setError(msg));
    socket.on('connection-lost', () => {
      setError(isAr ? 'انقطع الاتصال بالخادم' : 'Connection to the game server was lost');
      setScreen('setup');
      setPlayers([]);
    });
    socket.on('host-left', () => {
      setError(isAr ? 'منشئ الغرفة غادر' : 'Host left the room'); setScreen('setup');
    });

    return () => {
      socket.off('room-created'); socket.off('joined'); socket.off('room-update'); socket.off('game-started'); socket.off('match-finished'); socket.off('error'); socket.off('connection-lost'); socket.off('host-left');
    };
  }, [isAr, room, screen, players]);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (patch.vsComputer !== undefined) {
        setComputers([false, patch.vsComputer, patch.vsComputer, patch.vsComputer]);
      }
      return next;
    });
  };

  const makePlayers = useCallback(() => {
    const total = settings.players;
    return Array.from({ length: total }, (_, index) => ({
      id: String(index),
      name: names[index]?.trim() || `لاعب ${index + 1}`,
      color: COLORS[index],
      side: SIDES[index],
      computer: index === 0 ? false : computers[index],
    }));
  }, [names, settings.players, computers]);

  const enterWaiting = async () => {
    const trimmed = names.slice(0, settings.players).map(n=>n.trim());
    if (trimmed.some(n=>n.length<2)) { setError(isAr ? 'اكتب اسم كل اللاعبين حرفين على الاقل' : 'Names must be at least 2 chars'); return; }
    if (new Set(trimmed).size!== trimmed.length) { setError(isAr ? 'الاسماء لازم مختلفة' : 'Names must be unique'); return; }
    localStorage.setItem('qoud-ping-pong-settings', JSON.stringify(settings));

    const allPlayers = makePlayers();

    try {
      const roomCode = randomRoom();
      const colyseusRoom = await colyseus.create('qoud', {
        code: roomCode,
        maxPlayers: settings.players,
        settings,
        player: allPlayers[0],
        computerPlayers: allPlayers.slice(1).filter((player) => player.computer),
        name: allPlayers[0].name,
      });
      socket.attach(colyseusRoom);
      setRoom(roomCode); setIsHost(true); setError(''); setScreen('waiting');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (isAr ? 'تعذر إنشاء الغرفة' : 'Could not create room'));
    }
  };

  const joinByCode = async () => {
    const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (code.length!==4) { setError(isAr ? 'الكود 4 حروف' : 'Code must be 4 characters'); return; }
    const myName = names[0]?.trim() || `لاعب جديد`;

    try {
      const lookup = await fetch(`/api/rooms?code=${encodeURIComponent(code)}`);
      if (!lookup.ok) throw new Error(isAr ? 'الغرفة غير موجودة' : 'Room not found');
      const { roomId } = await lookup.json() as { roomId: string };
      const colyseusRoom = await colyseus.joinById(roomId, { name: myName });
      socket.attach(colyseusRoom);
      setRoom(code); setIsHost(false); setError(''); setScreen('waiting');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (isAr ? 'تعذر الانضمام للغرفة' : 'Could not join room'));
    }
  };

  const refreshRoom = useCallback(()=>{},[screen, room]);

  const leaveWaiting = () => {
    void socket.leave();
    setPlayers([]); setError(''); setScreen('setup');
  };

  useEffect(()=>{},[refreshRoom]);

  const startMatch = () => {
    if (!isHost) { setError(isAr ? 'المنشئ هو من يبدأ الجولة' : 'Only the host can start the round'); return; }
    socket.emit('start-game', { code: room });
    setScores(Object.fromEntries(players.map(p => [p.id, 0])));
    setWinner(null); setLastGoal(null); setMatchPaused(false); setMatchKey((key) => key + 1); setScreen('game');
  };

  const leaveMatch = () => { void socket.leave(); setPlayers([]); setScreen('setup'); setMatchPaused(false); };

  const finishMatch = useCallback((champion: Player) => {
    setWinner(champion);
    setWins((current) => {
      const updated = { ...current, [champion.name]: (current[champion.name] ?? 0) + 1 };
      localStorage.setItem('qoud-ping-pong-wins', JSON.stringify(updated));
      return updated;
    });
    if (isHost) socket.emit('match-finished', { code: room, winnerId: champion.id, scores });
    setScreen('results');
  }, [room, isHost, scores]);

  const goalScored = useCallback((missed: Player) => {
    if (!isHost) return; 
    setScores((current) => {
      const updated = { ...current };
      const scorer = players.length===2 ? players.find(p=>p.id!==missed.id)! : players.find((player) => player.id !== missed.id) ?? missed;
      updated[scorer.id] = (updated[scorer.id] ?? 0) + 1;

      socket.emit('goal-scored', { code: room, missedSide: missed.side, scores: updated });

      if (settings.mode==='goals' && (updated[scorer.id] ?? 0) >= settings.goal) finishMatch(scorer);
      return updated;
    });
    setLastGoal(missed.name);
    window.setTimeout(() => setLastGoal(null), 1300);
  }, [finishMatch, players, settings.goal, settings.mode, isHost, room]);

  if (screen === 'waiting') return <WaitingRoom room={room} players={players} isHost={isHost} error={error} onBack={leaveWaiting} onStart={startMatch} onRefresh={refreshRoom} />;
  if (screen === 'game') {
    if (settings.graphics === '3d') {
      return <GameScreen3D key={matchKey} roomCode={room} isHost={isHost} players={players} settings={settings} scores={scores} lastGoal={lastGoal} paused={matchPaused} onGoal={goalScored} onTimeUp={() => { const top = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0))[0]; if (top) finishMatch(top); }} onPause={() => setMatchPaused((paused) => !paused)} onExit={leaveMatch} />;
    }
    return <GameScreen key={matchKey} roomCode={room} isHost={isHost} players={players} settings={settings} scores={scores} lastGoal={lastGoal} paused={matchPaused} onGoal={goalScored} onTimeUp={() => { const top = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0))[0]; if (top) finishMatch(top); }} onPause={() => setMatchPaused((paused) => !paused)} onExit={leaveMatch} />;
  }
  if (screen === 'results') return <ResultsScreen players={players} scores={scores} winner={winner} wins={wins} onAgain={startMatch} onHome={() => { void socket.leave(); setPlayers([]); setScreen('setup'); }} />;
  return <SetupScreen settings={settings} names={names} room={room} roomsCount={roomsCount} joinCode={joinCode} showSettings={showSettings} computers={computers} error={error} onChangeName={(index, value) => setNames((current) => current.map((name, item) => item === index ? value : name))} onChangeSettings={updateSettings} onToggleComputer={(idx) => { if (idx===0) return; setComputers(prev=>prev.map((c,i)=> i===idx ? !c : c)); }} onRoomChange={setRoom} onJoinCodeChange={setJoinCode} onJoin={joinByCode} onCreate={enterWaiting} onSettings={() => setShowSettings(true)} onCloseSettings={() => setShowSettings(false)} />;
}

function Brand() {
  const { t } = useTranslation();
  return <div className="brand"><span className="brand-mark"><span/><span/><span/><span/></span><span>QOUD</span><small>{t('brand_sub')}</small></div>;
}

function SetupScreen({ settings, names, room, roomsCount, joinCode, showSettings, computers, error, onChangeName, onChangeSettings, onToggleComputer, onRoomChange, onJoinCodeChange, onJoin, onCreate, onSettings, onCloseSettings }: { settings: Settings; names: string[]; room: string; roomsCount: number; joinCode: string; showSettings: boolean; computers: boolean[]; error: string; onChangeName: (index: number, value: string) => void; onChangeSettings: (patch: Partial<Settings>) => void; onToggleComputer: (idx:number)=>void; onRoomChange: (value: string) => void; onJoinCodeChange: (value: string) => void; onJoin: () => void; onCreate: () => void; onSettings: () => void; onCloseSettings: () => void }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar') ?? true;
  return <main className="app-shell setup-shell" dir={isAr? 'rtl' : 'ltr'}>
    <header className="topbar"><Brand /><div className="topbar-actions">
      <button className="icon-btn" onClick={() => i18n.changeLanguage(isAr? 'en' : 'ar')} style={{fontWeight:900, minWidth:42, border:'1px solid #333', background:'#111', color:'#fff'}}>{isAr? 'EN' : 'AR'}</button>
      <span className="online-dot"><i /> {roomsCount} {isAr? 'غرفة متاحة الآن' : 'rooms available now'}</span>
      <button className="icon-btn" onClick={onSettings}><Settings2 size={19} /></button>
      <button className="icon-btn"><CircleHelp size={19} /></button>
    </div></header>

    <section className="setup-grid">
      <div className="setup-copy">
        <div className="eyebrow"><Zap size={14} /> {isAr? 'طاولة LED هوائية - نفس الصورة المرجعية' : 'Air LED Table - Same as reference'}</div>
        <h1>{t('title_1')} <br /><em>{t('title_2')}</em></h1>
        <p>{t('desc')}</p>
        <div className="copy-stats"><span><strong>LED</strong><small>{isAr? 'نيون حقيقي' : 'Real Neon'}</small></span><span><strong>1-20</strong><small>{isAr? 'سرعة' : 'Speed'}</small></span><span><strong>🔴</strong><small>{isAr? 'كرة حمراء' : 'Red Ball'}</small></span></div>
        {error && <div style={{background:'#ff6b8b', color:'#fff', padding:'12px', borderRadius:'10px', fontWeight:700, marginTop:'12px'}}>{error}</div>}
      </div>

      <div className="setup-card-wrap">
        <div className="setup-card">
          <div style={{background:'#0a0a0a', color:'#fff', padding:'16px', borderRadius:'14px', marginBottom:'16px', border:'2px solid #222'}}>
            <div style={{fontWeight:900, fontSize:'14px', marginBottom:'12px', display:'flex', justifyContent:'space-between'}}><span>🎮 {t('mode')}</span><span style={{color:'#00e5ff'}}>LED TABLE • 42px</span></div>
            <div style={{display:'flex', gap:'10px', marginBottom:'12px'}}>
              <button type="button" onClick={() => onChangeSettings({ graphics: '2d' })} style={{flex:1, padding:'12px', borderRadius:'10px', border: settings.graphics==='2d'? '2px solid #00e5ff' : '1px solid #333', background: settings.graphics==='2d'? '#111' : '#000', color: settings.graphics==='2d'? '#00e5ff' : '#888', fontWeight:900}}>2D LED<br/><span style={{fontSize:'10px'}}>{isAr? 'مطابق للصورة' : 'Same as image'}</span></button>
              <button type="button" onClick={() => onChangeSettings({ graphics: '3d' })} style={{flex:1, padding:'12px', borderRadius:'10px', border: settings.graphics==='3d'? '2px solid #ff4081' : '1px solid #333', background: settings.graphics==='3d'? '#111' : '#000', color: settings.graphics==='3d'? '#ff4081' : '#888', fontWeight:900}}>3D LED<br/><span style={{fontSize:'10px'}}>{isAr? 'إطار لامع' : 'Glossy Frame'}</span></button>
            </div>
            <div style={{background:'#111', padding:'10px', borderRadius:'8px'}}>
              <label style={{fontSize:'12px', display:'flex', justifyContent:'space-between'}}><span>🔴 {t('ball_speed', { speed: settings.ballSpeed })}</span><span style={{color: settings.speed==='fixed'? '#ffcf5a' : '#61e7c2'}}>{settings.speed==='fixed'? (isAr? 'ثابتة' : 'Fixed') : (isAr? 'متدرجة' : 'Gradual')}</span></label>
              <input type="range" min={1} max={20} value={settings.ballSpeed} onChange={e=>onChangeSettings({ ballSpeed: Number(e.target.value) })} style={{width:'100%'}} />
              <div style={{display:'flex', justifyContent:'space-between', fontSize:'10px', opacity:0.6}}><span>1 {isAr? 'بطيء' : 'Slow'}</span><span>20 {isAr? 'سريع جداً' : 'Very Fast'}</span></div>
            </div>
          </div>

          <div className="card-heading"><div><span className="section-kicker">{isAr? 'ابدأ الجولة' : 'Start Round'}</span><h2>{isAr? 'من حول الطاولة؟' : "Who's around?"}</h2></div><div className="room-pill"><span>{isAr? 'الغرفة' : 'Room'}</span><b>{room}</b></div></div>

          <div className="player-count"><span>{t('players_count')}</span><div className="stepper"><button onClick={() => onChangeSettings({ players: Math.max(2, settings.players - 1) })}><Minus size={15} /></button><strong>{settings.players}</strong><button onClick={() => onChangeSettings({ players: Math.min(4, settings.players + 1) })}><Plus size={15} /></button></div></div>

          <div className="name-list">{Array.from({ length: settings.players }, (_, index) => <div className="name-field" key={index} style={{display:'flex', alignItems:'center', gap:'8px'}}><span className="player-dot" style={{ background: COLORS[index] }} /> <input style={{flex:1}} value={names[index]} onChange={(event) => onChangeName(index, event.target.value)} maxLength={14} /><span className="name-side">{[isAr? 'تحت' : 'Bottom', isAr? 'فوق' : 'Top', isAr? 'يمين' : 'Right', isAr? 'يسار' : 'Left'][index]}</span>{index>0 && <button type="button" onClick={()=>onToggleComputer(index)} style={{border:'1px solid '+(computers[index]? 'rgba(155,140,255,.5)' : 'rgba(97,231,194,.5)'), background: computers[index]? 'rgba(155,140,255,.15)' : 'rgba(97,231,194,.15)', borderRadius:'8px', padding:'4px 8px', fontSize:'11px', fontWeight:700, display:'flex', alignItems:'center', gap:'4px'}}>{computers[index]? <><Monitor size={12}/> {isAr? 'كمبيوتر' : 'Computer'}</> : <><Gamepad2 size={12}/> {isAr? 'انسان' : 'Human'}</>}</button>}</div>)}</div>

          <div className="mode-switch"><button className={settings.vsComputer? 'active' : ''} onClick={() => onChangeSettings({ vsComputer: true })}><Monitor size={16} /> {t('vs_computer')}</button><button className={!settings.vsComputer? 'active' : ''} onClick={() => onChangeSettings({ vsComputer: false })}><Gamepad2 size={16} /> {t('vs_friends')}</button></div>

          {settings.vsComputer && <div className="difficulty-row"><span>{isAr? 'الصعوبة' : 'Difficulty'}</span><div className="difficulty-options">{(['easy', 'normal', 'hard'] as Difficulty[]).map((difficulty) => <button key={difficulty} className={settings.difficulty === difficulty? 'selected' : ''} onClick={() => onChangeSettings({ difficulty })}>{difficulty === 'easy'? (isAr? 'خفيف' : 'Easy') : difficulty === 'normal'? (isAr? 'متوازن' : 'Normal') : (isAr? 'شرس' : 'Hard')}</button>)}</div></div>}

          <button className="primary-cta" onClick={onCreate}><span>{t('create_room', { speed: settings.ballSpeed })}</span>{isAr ? <ChevronLeft size={19} /> : <ChevronRight size={19} />}</button>
          <div className="join-divider"><span>{isAr? 'أو انضم برمز' : 'Or join with code'}</span></div>
          <div className="join-row"><input value={joinCode} onChange={(event) => onJoinCodeChange(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} placeholder="ABCD" maxLength={4} dir="ltr" /><button onClick={onJoin} disabled={joinCode.length!== 4}><LogIn size={16} /> {isAr? 'انضم' : 'Join'}</button></div>
        </div>
      </div>
    </section>
    <footer className="setup-footer"><span>QOUD LED • {isAr? 'نسخة مطابقة للصورة المرجعية' : 'Exact replica'}</span><button onClick={onSettings}><SlidersHorizontal size={15} /> {t('settings')}</button></footer>
    {showSettings && <SettingsModal settings={settings} onChange={onChangeSettings} onClose={onCloseSettings} />}
  </main>;
}

function SettingsModal({ settings, onChange, onClose }: { settings: Settings; onChange: (patch: Partial<Settings>) => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar') ?? true;

  return <div className="modal-backdrop" dir={isAr? 'rtl' : 'ltr'}>
    <div className="settings-modal">
      <div className="modal-head"><div><span className="section-kicker">{isAr? 'ضبط الطاولة' : 'Table Setup'}</span><h2>{isAr? 'إعدادات السرعة والبداية' : 'Speed & Start Settings'}</h2></div><button className="icon-btn" onClick={onClose}><X size={19} /></button></div>

      <div className="setting-block">
        <label>🔴 {t('ball_speed', {speed: settings.ballSpeed})} <b style={{color:'#ff2233'}}>{settings.ballSpeed} / 20</b></label>
        <input className="range" type="range" min={1} max={20} step={1} value={settings.ballSpeed} onChange={(e) => onChange({ ballSpeed: Number(e.target.value) })} />
        <div className="range-labels"><span>1 {isAr? 'بطيء جداً' : 'Very Slow'}</span><span>20 {isAr? 'صاروخ' : 'Rocket'}</span></div>
        <small style={{opacity:.7, fontSize:'12px', marginTop:'6px', display:'block'}}>
          {isAr? `السرعة ${settings.ballSpeed} = ${(2 + settings.ballSpeed*0.25).toFixed(1)} وحدة. ثابتة تبقى نفسها، متدرجة تبدأ بطيئة وتزيد حتى الهدف` 
          : `Speed ${settings.ballSpeed} = ${(2 + settings.ballSpeed*0.25).toFixed(1)} units. Fixed stays same, gradual starts slow and increases`}
        </small>
      </div>
      <div className="setting-block">
        <label>
          📐 {isAr ? 'حجم ساحة اللعبة (3D)' : 'Arena Size (3D)'}
        </label>
        <div className="segmented">
          {(['small', 'medium', 'large', 'xlarge'] as ArenaSize[]).map((size) => (
            <button
              key={size}
              className={settings.arenaSize === size ? 'selected' : ''}
              onClick={() => onChange({ arenaSize: size })}
            >
              {size === 'small' && (isAr ? 'صغير' : 'Small')}
              {size === 'medium' && (isAr ? 'وسط' : 'Medium')}
              {size === 'large' && (isAr ? 'كبير' : 'Large')}
              {size === 'xlarge' && (isAr ? 'كبير جداً' : 'XL')}
            </button>
          ))}
        </div>
        <small style={{ opacity: 0.7, fontSize: '11px', marginTop: '6px', display: 'block' }}>
          {isAr 
            ? `شكل الملعب: ${settings.players === 4 ? 'مربع (4 لاعبين)' : 'مستطيل (2 لاعبين)'}`
            : `Shape: ${settings.players === 4 ? 'Square (4 Players)' : 'Rectangular (2 Players)'}`}
        </small>
      </div>
      <div className="setting-block"><label>{isAr? 'بداية الكرة' : 'Ball Start'}</label><div className="segmented">
        <button className={settings.start === 'center' ? 'selected' : ''} onClick={() => onChange({ start: 'center' })}>{isAr? 'من المنتصف - تتحرك فوراً' : 'From Center - Moves instantly'}</button>
        <button className={settings.start === 'paddle' ? 'selected' : ''} onClick={() => onChange({ start: 'paddle' })}>{isAr? 'من المضرب - انتظار إرسال' : 'From Paddle - Wait for serve'}</button>
      </div></div>

      <div className="setting-block"><label>{isAr? 'طريقة الفوز' : 'Win Mode'}</label><div className="segmented">
        <button className={settings.mode === 'time' ? 'selected' : ''} onClick={() => onChange({ mode: 'time' })}>{isAr? 'بالوقت' : 'By Time'}</button>
        <button className={settings.mode === 'goals' ? 'selected' : ''} onClick={() => onChange({ mode: 'goals' })}>{isAr? 'بالأهداف' : 'By Goals'}</button>
      </div></div>

      {settings.mode === 'time' ? 
        <div className="setting-block"><label>{isAr? 'مدة الجولة' : 'Round Duration'} <b>{settings.duration < 60 ? `${settings.duration} ${isAr? 'ث' : 's'}` : `${Math.round(settings.duration / 60)} ${isAr? 'د' : 'm'}`}</b></label><input className="range" type="range" min={1} max={600} step={1} value={settings.duration} onChange={(e) => onChange({ duration: Number(e.target.value) })} /><div className="range-labels"><span>{isAr? 'ثانية' : 'Second'}</span><span>10 {isAr? 'دقائق' : 'Minutes'}</span></div></div> : 
        <div className="setting-block"><label>{isAr? `الفوز عند ${settings.goal} أهداف` : `Win at ${settings.goal} goals`} <b>{settings.goal}</b></label><input className="range" type="range" min={2} max={30} value={settings.goal} onChange={(e) => onChange({ goal: Number(e.target.value) })} /><div className="range-labels"><span>2 {isAr? 'هدفان' : 'Goals'}</span><span>30 {isAr? 'هدفاً' : 'Goals'}</span></div></div>
      }

      <div className="setting-block"><label>{isAr? 'نمط السرعة' : 'Speed Mode'}</label><div className="segmented">
        <button className={settings.speed === 'gradual' ? 'selected' : ''} onClick={() => onChange({ speed: 'gradual' })}><Gauge size={15} /> {isAr? 'متدرجة - لا تعود للبطء إلا بعد هدف' : 'Gradual - Only slows after goal'}</button>
        <button className={settings.speed === 'fixed' ? 'selected' : ''} onClick={() => onChange({ speed: 'fixed' })}><Swords size={15} /> {isAr? `ثابتة - ${settings.ballSpeed}` : `Fixed - ${settings.ballSpeed}`}</button>
      </div></div>

      <div className="setting-toggle"><span><Volume2 size={17} /> {isAr? 'أصوات' : 'Sounds'}</span><button className={`toggle ${settings.sound ? 'on' : ''}`} onClick={() => onChange({ sound: !settings.sound })}><i /></button></div>
      <button className="primary-cta modal-done" onClick={onClose}><Check size={17} /> {isAr? 'حفظ' : 'Save'}</button>
    </div>
  </div>;
}

function WaitingRoom({ room, players, isHost, error, onBack, onStart, onRefresh }: { room: string; players: Player[]; isHost: boolean; error: string; onBack: () => void; onStart: () => void; onRefresh: () => void }) {
  const [copied, setCopied] = useState(false);
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar') ?? true;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return <main className="app-shell waiting-shell" dir={isAr? 'rtl' : 'ltr'}>
    <header className="topbar"><Brand /><div className="topbar-actions"><button className="icon-btn" onClick={() => i18n.changeLanguage(isAr? 'en' : 'ar')} style={{fontWeight:900, minWidth:42}}>{isAr? 'EN' : 'AR'}</button><button className="icon-btn" onClick={onBack}><ArrowLeft size={18}/></button></div></header>
    <section className="waiting-card">
      <div className="waiting-head"><div><h1>{t('waiting_title')}</h1><p>{t('waiting_desc')}</p></div><button className="room-code" onClick={copyCode} title={t('copy')}><span>{t('room_code')}</span><strong>{room}</strong><span className="copy-hint">{copied? t('copied') : t('copy')}</span></button></div>
      {error && <div style={{background:'#ff6b8b', color:'#fff', padding:'12px', borderRadius:'10px', fontWeight:700, marginBottom:'12px'}}>{error}</div>}
      <div className="waiting-players">
        <h3>{t('players')} • {players.length}</h3>
        <div className="player-chips">{players.map((p, i) => <span key={p.id} className="player-chip" style={{borderColor: COLORS[i]}}><span className="dot" style={{background: COLORS[i]}} />{p.name}</span>)}</div>
        <div className="waiting-note">{isHost? t('you_host') : t('you_joined')}</div>
      </div>
      <div className="waiting-actions"><button className="secondary-btn" onClick={onRefresh}>{isAr? 'تحديث' : 'Refresh'}</button>{isHost && <button className="primary-cta" onClick={onStart}><span>{t('start')}</span>{isAr ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</button>}</div>
    </section>
  </main>;
}

function GameScreen({ roomCode, isHost, players, settings, scores, lastGoal, paused, onGoal, onTimeUp, onPause, onExit }: { roomCode: string; isHost: boolean; players: Player[]; settings: Settings; scores: Scores; lastGoal: string | null; paused: boolean; onGoal: (player: Player) => void; onTimeUp: () => void; onPause: () => void; onExit: () => void }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar') ?? true;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const controls = useRef({ x: 0, y: 0 });
  const touchControls = useRef({ left: false, right: false, up: false, down: false, bottomLeft: false, bottomRight: false, leftUp: false, leftDown: false });
  const drag = useRef<{ side: Player['side'] | null; x: number; y: number }>({ side: null, x: 500, y: 300 });
  const servingRef = useRef<{ active: boolean; side: Player['side']; startTime: number; requested: boolean }>({ active: settings.start === 'paddle', side: 'bottom', startTime: performance.now(), requested: false });
  const [timeLeft, setTimeLeft] = useState(settings.mode === 'time' ? settings.duration : 0);
  const [sound, setSound] = useState(settings.sound);
  const [rally, setRally] = useState(0);
  const [isServing, setIsServing] = useState(settings.start === 'paddle');
  const soundRef = useRef(sound);
  const onTimeUpRef = useRef(onTimeUp);
  const onGoalRef = useRef(onGoal);
  const pausedRef = useRef(paused);
  const gameEndedRef = useRef(false);
  const world = useMemo(() => getArenaWorld(players.length, settings.arenaSize), [players.length, settings.arenaSize]);
  soundRef.current = sound; onTimeUpRef.current = onTimeUp; onGoalRef.current = onGoal; pausedRef.current = paused;

  const beep = useCallback((frequency: number, duration = 0.05) => {
    if (!soundRef.current) return;
    try { 
      const context = new AudioContext(); 
      const oscillator = context.createOscillator(); 
      const gain = context.createGain(); 
      oscillator.frequency.value = frequency; 
      oscillator.type = 'sine'; 
      gain.gain.setValueAtTime(0.06, context.currentTime); 
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration); 
      oscillator.connect(gain); gain.connect(context.destination); 
      oscillator.start(); oscillator.stop(context.currentTime + duration); 
    } catch {}
  }, []);

  const requestLaunch = useCallback(() => { if (servingRef.current.active) servingRef.current.requested = true; }, []);
  const getInitialSpeed = useCallback(() => { return 2.8 + settings.ballSpeed * 0.48; }, [settings.ballSpeed]);

  const stateRef = useRef({
    ball: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    paddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 },
    prevPaddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 },
    last: performance.now(), elapsed: 0, rally: 0, speedMult: 1, countdown: 0, countdownStart: 0, countdownSide: null as Player['side'] | null,
    effects: [] as { x: number; y: number; born: number; color: string }[],
  });

  const isOfflineMode = !socket.connected || players.length <= 1;

  useEffect(() => {
    if (isOfflineMode) return; 
    if (isHost) {
      const handleInput = (data: { side: Player['side']; x: number; y: number }) => {
        if (stateRef.current.paddles[data.side]) {
          stateRef.current.paddles[data.side].x = data.x;
          stateRef.current.paddles[data.side].y = data.y;
        }
      };
      socket.on('paddle-input', handleInput);
      return () => { socket.off('paddle-input', handleInput); };
    } else {
      const handleState = (serverState: any) => {
        stateRef.current.ball = serverState.ball;
        stateRef.current.paddles = serverState.paddles;
        if (serverState.countdown !== undefined) stateRef.current.countdown = serverState.countdown;
      };
      socket.on('game-state', handleState);
      return () => { socket.off('game-state', handleState); };
    }
  }, [isHost, isOfflineMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const arena = arenaRef.current;
    if (!canvas || !arena) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const state = stateRef.current;

    const launchBall = (fromPaddle: boolean = false) => {
      const spd = getInitialSpeed() * (state.speedMult || 1);
      const ang = fromPaddle ? (Math.random() - 0.5) * Math.PI * 0.6 : Math.random() * Math.PI * 2;
      if (fromPaddle) {
        const side = servingRef.current.side;
        if (side === 'bottom') { state.ball.vx = Math.sin(ang) * spd; state.ball.vy = -Math.abs(Math.cos(ang) * spd) - 1; }
        else if (side === 'top') { state.ball.vx = Math.sin(ang) * spd; state.ball.vy = Math.abs(Math.cos(ang) * spd) + 1; }
        else if (side === 'left') { state.ball.vx = Math.abs(Math.cos(ang) * spd) + 1; state.ball.vy = Math.sin(ang) * spd; }
        else { state.ball.vx = -Math.abs(Math.cos(ang) * spd) - 1; state.ball.vy = Math.sin(ang) * spd; }
      } else {
        state.ball.vx = Math.cos(ang) * spd; state.ball.vy = Math.sin(ang) * spd;
        if (Math.abs(state.ball.vx) < 2) state.ball.vx = state.ball.vx < 0 ? -2.5 : 2.5;
        if (Math.abs(state.ball.vy) < 2) state.ball.vy = state.ball.vy < 0 ? -2.5 : 2.5;
      }
    };

    if (isHost) {
      if (settings.start !== 'paddle') {
        launchBall(false);
        servingRef.current.active = false;
      } else {
        state.ball.x = state.paddles.bottom.x; state.ball.y = state.paddles.bottom.y - 24;
        servingRef.current.active = true;
        servingRef.current.side = 'bottom';
        servingRef.current.startTime = performance.now();
        servingRef.current.requested = false;
      }
    }

    let frame = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = arena.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      context.setTransform(canvas.width / world.w, 0, 0, canvas.height / world.h, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(arena);
    const playerForSide = (side: Player['side']) => players.find((player) => player.side === side) ?? players[0];
    const active = (side: Player['side']) => players.some((player) => player.side === side);
    const resetBall = (missedSide?: Player['side']) => {
      state.countdown = 3; state.countdownStart = performance.now(); state.countdownSide = missedSide || null;
      state.ball.x = world.w/2; state.ball.y = world.h/2; state.ball.vx = 0; state.ball.vy = 0;
      return;
    };

    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2);
      state.last = now;

      const myPlayer = players.find(p => p.socketId === socket.id) || players[0];

      if (!pausedRef.current && !gameEndedRef.current) {
        if (!isHost && drag.current.side === myPlayer.side) {
          socket.emit('paddle-input', { code: roomCode, side: myPlayer.side, x: drag.current.x, y: drag.current.y });
        }

        if (isHost) {
          state.elapsed += delta / 60;
          if (settings.mode === 'time' && state.elapsed > 1) { state.elapsed = 0; setTimeLeft((time) => { if (time <= 1) { gameEndedRef.current = true; onTimeUpRef.current(); return 0; } return time - 1; }); }

          if (state.countdown > 0) {
            const elapsed = (now - state.countdownStart) / 1000;
            if (elapsed >= 3) {
              state.countdown = 0;
              const side = state.countdownSide;
              if (settings.start === 'paddle' && side) {
                servingRef.current.active = true; servingRef.current.side = side; servingRef.current.startTime = now; servingRef.current.requested = false;
                if (side === 'bottom') { state.ball.x = state.paddles.bottom.x; state.ball.y = state.paddles.bottom.y - 24; }
                else if (side === 'top') { state.ball.x = state.paddles.top.x; state.ball.y = state.paddles.top.y + 24; }
                else if (side === 'left') { state.ball.x = state.paddles.left.x - 24; state.ball.y = state.paddles.left.y; }
                else { state.ball.x = state.paddles.right.x + 24; state.ball.y = state.paddles.right.y; }
                state.ball.vx = 0; state.ball.vy = 0; setIsServing(true);
              } else {
                launchBall(false); setIsServing(false); servingRef.current.active = false;
              }
            } else {
              socket.emit('game-state', { code: roomCode, state: { ball: state.ball, paddles: state.paddles, countdown: state.countdown } });
              draw(context, state, players, now, true, world);
              frame = requestAnimationFrame(tick);
              return;
            }
          }

          const touch = touchControls.current;
          if (touch.left) controls.current.x = -1; else if (touch.right) controls.current.x = 1; else controls.current.x = 0;
          if (touch.up) controls.current.y = -1; else if (touch.down) controls.current.y = 1; else controls.current.y = 0;
          const bottomInput = touch.bottomLeft ? -1 : touch.bottomRight ? 1 : 0;

          state.paddles.bottom.x = Math.max(50, Math.min(world.w - 50, state.paddles.bottom.x + (players[0]?.computer ? ai(state.ball.x, state.paddles.bottom.x, settings.difficulty) : controls.current.x + bottomInput) * 9 * delta));
          state.paddles.bottom.y = Math.max(world.h - 70 - ZONE, Math.min(world.h - 40, state.paddles.bottom.y + (players[0]?.computer ? ai(state.ball.y, state.paddles.bottom.y, settings.difficulty) : controls.current.y) * 7 * delta));
          state.paddles.top.x = Math.max(50, Math.min(world.w - 50, state.paddles.top.x + (players[1]?.computer ? ai(state.ball.x, state.paddles.top.x, settings.difficulty) : bottomInput) * 6 * delta));
          state.paddles.top.y = Math.max(40, Math.min(40 + ZONE, state.paddles.top.y));
          state.paddles.right.y = Math.max(50, Math.min(world.h - 50, state.paddles.right.y + (players[2]?.computer ? ai(state.ball.y, state.paddles.right.y, settings.difficulty) : controls.current.y) * 7 * delta));
          state.paddles.right.x = Math.max(world.w - 70 - ZONE, Math.min(world.w - 40, state.paddles.right.x));
          state.paddles.left.y = Math.max(50, Math.min(world.h - 50, state.paddles.left.y + (players[3]?.computer ? ai(state.ball.y, state.paddles.left.y, settings.difficulty) : 0) * 6 * delta));
          state.paddles.left.x = Math.max(40, Math.min(40 + ZONE, state.paddles.left.x));

          if (drag.current.side === 'bottom' && active('bottom')) { state.paddles.bottom.x = Math.max(50, Math.min(world.w - 50, drag.current.x)); state.paddles.bottom.y = Math.max(world.h - 70 - ZONE, Math.min(world.h - 40, drag.current.y)); }
          if (drag.current.side === 'top' && active('top')) { state.paddles.top.x = Math.max(50, Math.min(world.w - 50, drag.current.x)); state.paddles.top.y = Math.max(40, Math.min(40 + ZONE, drag.current.y)); }
          if (drag.current.side === 'right' && active('right')) { state.paddles.right.y = Math.max(50, Math.min(world.h - 50, drag.current.y)); state.paddles.right.x = Math.max(world.w - 70 - ZONE, Math.min(world.w - 40, drag.current.x)); }
          if (drag.current.side === 'left' && active('left')) { state.paddles.left.y = Math.max(50, Math.min(world.h - 50, drag.current.y)); state.paddles.left.x = Math.max(40, Math.min(40 + ZONE, drag.current.x)); }

          if (servingRef.current.active) {
            const side = servingRef.current.side;
            if (side === 'bottom') { state.ball.x = state.paddles.bottom.x; state.ball.y = state.paddles.bottom.y - 24; }
            else if (side === 'top') { state.ball.x = state.paddles.top.x; state.ball.y = state.paddles.top.y + 24; }
            else if (side === 'left') { state.ball.x = state.paddles.left.x - 24; state.ball.y = state.paddles.left.y; }
            else { state.ball.x = state.paddles.right.x + 24; state.ball.y = state.paddles.right.y; }
            const player = playerForSide(side);
            if (player?.computer && now - servingRef.current.startTime > 900) { servingRef.current.requested = true; }
            if (servingRef.current.requested) {
              launchBall(true);
              servingRef.current.active = false;
              servingRef.current.requested = false;
              setIsServing(false);
              beep(620);
            }
            socket.emit('game-state', { code: roomCode, state: { ball: state.ball, paddles: state.paddles, countdown: state.countdown } });
            draw(context, state, players, now, true, world);
            frame = requestAnimationFrame(tick);
            return;
          }

          const baseSpd = getInitialSpeed();
          const rallyBonus = settings.speed === 'gradual' ? state.rally * 0.15 : 0;
          const speedFactor = settings.speed === 'fixed' ? 1 : 1 + rallyBonus * 0.08;
          state.ball.x += state.ball.vx * (settings.speed === 'fixed' ? 1 : speedFactor) * delta;
          state.ball.y += state.ball.vy * (settings.speed === 'fixed' ? 1 : speedFactor) * delta;

          const r = 12;
          const PADDLE_R = 21;
          const HIT_DIST = PADDLE_R + r - 1;
          const prevBottom = state.prevPaddles.bottom;
          const prevTop = state.prevPaddles.top;
          const prevLeft = state.prevPaddles.left;
          const prevRight = state.prevPaddles.right;
          const velBottom: Vec2 = { x: state.paddles.bottom.x - prevBottom.x, y: state.paddles.bottom.y - prevBottom.y };
          const velTop: Vec2 = { x: state.paddles.top.x - prevTop.x, y: state.paddles.top.y - prevTop.y };
          const velLeft: Vec2 = { x: state.paddles.left.x - prevLeft.x, y: state.paddles.left.y - prevLeft.y };
          const velRight: Vec2 = { x: state.paddles.right.x - prevRight.x, y: state.paddles.right.y - prevRight.y };
          const THRUST = 4.8;
          const BASE_BOOST = 3.2;
          const PADDLE_POWER = 1.9;

          if (!active('top') && state.ball.y - r < 22) { state.ball.y = 22 + r; state.ball.vy = Math.abs(state.ball.vy) * 1.1; beep(300); }
          if (!active('bottom') && state.ball.y + r > world.h - 22) { state.ball.y = world.h - 22 - r; state.ball.vy = -Math.abs(state.ball.vy) * 1.1; beep(300); }
          if (!active('left') && state.ball.x - r < 22) { state.ball.x = 22 + r; state.ball.vx = Math.abs(state.ball.vx) * 1.1; beep(300); }
          if (!active('right') && state.ball.x + r > world.w - 22) { state.ball.x = world.w - 22 - r; state.ball.vx = -Math.abs(state.ball.vx) * 1.1; beep(300); }

          if (active('top')) {
            const dx = state.ball.x - state.paddles.top.x;
            const dy = state.ball.y - state.paddles.top.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist <= HIT_DIST + 14 && dist >= 0.5 && state.ball.vy < 1) {
              const nx = dx / dist; const ny = dy / dist;
              const cur = Math.hypot(state.ball.vx, state.ball.vy) || getInitialSpeed();
              const forwardSpeed = Math.max(0, velTop.y);
              const newSpeed = cur * 1.18 + BASE_BOOST + forwardSpeed * THRUST + settings.ballSpeed * 0.42;
              state.ball.x = state.paddles.top.x + nx * (HIT_DIST + 10);
              state.ball.y = state.paddles.top.y + ny * (HIT_DIST + 10);
              state.speedMult = Math.min(2.8, (state.speedMult || 1) * 1.14);
              state.rally++;
              state.ball.vx = (dx / PADDLE_R) * 6.2 + velTop.x * PADDLE_POWER;
              state.ball.vy = Math.abs(newSpeed) + 0.5;
              beep(520 + state.rally * 6);
              state.effects.push({ x: state.ball.x, y: state.ball.y, born: now, color: COLORS[1] });
            }
          }

          if (active('bottom')) {
            const dx = state.ball.x - state.paddles.bottom.x;
            const dy = state.ball.y - state.paddles.bottom.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist <= HIT_DIST + 14 && dist >= 0.5 && state.ball.vy > -1) {
              const nx = dx / dist; const ny = dy / dist;
              const cur = Math.hypot(state.ball.vx, state.ball.vy) || getInitialSpeed();
              const forwardSpeed = Math.max(0, -velBottom.y);
              const newSpeed = cur * 1.18 + BASE_BOOST + forwardSpeed * THRUST + settings.ballSpeed * 0.42;
              state.ball.x = state.paddles.bottom.x + nx * (HIT_DIST + 10);
              state.ball.y = state.paddles.bottom.y + ny * (HIT_DIST + 10);
              state.speedMult = Math.min(2.8, (state.speedMult || 1) * 1.14);
              state.rally++;
              state.ball.vx = (dx / PADDLE_R) * 6.2 + velBottom.x * PADDLE_POWER;
              state.ball.vy = -Math.abs(newSpeed) - 0.5;
              beep(520 + state.rally * 6);
              state.effects.push({ x: state.ball.x, y: state.ball.y, born: now, color: COLORS[0] });
            }
          }

          if (active('left')) {
            const dx = state.ball.x - state.paddles.left.x;
            const dy = state.ball.y - state.paddles.left.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist <= HIT_DIST + 14 && dist >= 0.5 && state.ball.vx < 1) {
              const nx = dx / dist; const ny = dy / dist;
              const cur = Math.hypot(state.ball.vx, state.ball.vy) || getInitialSpeed();
              const forwardSpeed = Math.max(0, velLeft.x);
              const newSpeed = cur * 1.18 + BASE_BOOST + forwardSpeed * THRUST + settings.ballSpeed * 0.42;
              state.ball.x = state.paddles.left.x + nx * (HIT_DIST + 10);
              state.ball.y = state.paddles.left.y + ny * (HIT_DIST + 10);
              state.speedMult = Math.min(2.8, (state.speedMult || 1) * 1.14);
              state.rally++;
              state.ball.vx = Math.abs(newSpeed) + 0.5;
              state.ball.vy = (dy / PADDLE_R) * 6.2 + velLeft.y * PADDLE_POWER;
              beep(480 + state.rally * 6);
              state.effects.push({ x: state.ball.x, y: state.ball.y, born: now, color: COLORS[3] });
            }
          }

          if (active('right')) {
            const dx = state.ball.x - state.paddles.right.x;
            const dy = state.ball.y - state.paddles.right.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist <= HIT_DIST + 14 && dist >= 0.5 && state.ball.vx > -1) {
              const nx = dx / dist; const ny = dy / dist;
              const cur = Math.hypot(state.ball.vx, state.ball.vy) || getInitialSpeed();
              const forwardSpeed = Math.max(0, -velRight.x);
              const newSpeed = cur * 1.18 + BASE_BOOST + forwardSpeed * THRUST + settings.ballSpeed * 0.42;
              state.ball.x = state.paddles.right.x + nx * (HIT_DIST + 10);
              state.ball.y = state.paddles.right.y + ny * (HIT_DIST + 10);
              state.speedMult = Math.min(2.8, (state.speedMult || 1) * 1.14);
              state.rally++;
              state.ball.vx = -Math.abs(newSpeed) - 0.5;
              state.ball.vy = (dy / PADDLE_R) * 6.2 + velRight.y * PADDLE_POWER;
              beep(480 + state.rally * 6);
              state.effects.push({ x: state.ball.x, y: state.ball.y, born: now, color: COLORS[2] });
            }
          }

          const maxSpd = 7 + settings.ballSpeed * 0.85 + state.rally * 0.55;
          state.ball.vx = Math.max(-maxSpd, Math.min(maxSpd, state.ball.vx));
          state.ball.vy = Math.max(-maxSpd, Math.min(maxSpd, state.ball.vy));

          state.prevPaddles = {
            top: { x: state.paddles.top.x, y: state.paddles.top.y },
            bottom: { x: state.paddles.bottom.x, y: state.paddles.bottom.y },
            left: { x: state.paddles.left.x, y: state.paddles.left.y },
            right: { x: state.paddles.right.x, y: state.paddles.right.y },
          };
          const GOAL_W = players.length===2 ? 260 : 300;
          const GOAL_X1 = (world.w - GOAL_W) / 2; const GOAL_X2 = GOAL_X1 + GOAL_W; const GOAL_Y1 = (world.h - GOAL_W) / 2; const GOAL_Y2 = GOAL_Y1 + GOAL_W;
          const inGoalX = (x:number) => x >= GOAL_X1 && x <= GOAL_X2;
          const inGoalY = (y:number) => y >= GOAL_Y1 && y <= GOAL_Y2;
          let missed: Player | undefined;
          if (state.ball.y - r < 22) {
            if (active('top')) { if (inGoalX(state.ball.x)) missed = playerForSide('top'); else { state.ball.y = 22 + r; state.ball.vy = Math.abs(state.ball.vy); beep(300); } }
            else { state.ball.y = 22 + r; state.ball.vy = Math.abs(state.ball.vy); beep(300); }
          }
          if (!missed && state.ball.y + r > world.h - 22) {
            if (active('bottom')) { if (inGoalX(state.ball.x)) missed = playerForSide('bottom'); else { state.ball.y = world.h - 22 - r; state.ball.vy = -Math.abs(state.ball.vy); beep(300); } }
            else { state.ball.y = world.h - 22 - r; state.ball.vy = -Math.abs(state.ball.vy); beep(300); }
          }
          if (!missed && state.ball.x - r < 22) {
            if (active('left')) { if (inGoalY(state.ball.y)) missed = playerForSide('left'); else { state.ball.x = 22 + r; state.ball.vx = Math.abs(state.ball.vx); beep(300); } }
            else { state.ball.x = 22 + r; state.ball.vx = Math.abs(state.ball.vx); beep(300); }
          }
          if (!missed && state.ball.x + r > world.w - 22) {
            if (active('right')) { if (inGoalY(state.ball.y)) missed = playerForSide('right'); else { state.ball.x = world.w - 22 - r; state.ball.vx = -Math.abs(state.ball.vx); beep(300); } }
            else { state.ball.x = world.w - 22 - r; state.ball.vx = -Math.abs(state.ball.vx); beep(300); }
          }
          if (missed) { state.effects.push({ x: Math.max(40, Math.min(world.w - 40, state.ball.x)), y: Math.max(40, Math.min(world.h - 40, state.ball.y)), born: now, color: missed.color }); beep(130, .16); onGoalRef.current(missed); resetBall(missed.side); }
          setRally(state.rally);

          socket.emit('game-state', { code: roomCode, state: { ball: state.ball, paddles: state.paddles, countdown: state.countdown } });
        }
      }
      draw(context, state, players, now, false, world);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [beep, players, settings, getInitialSpeed, isHost, roomCode]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === ' ' || event.code === 'Space') { if (servingRef.current.active) { servingRef.current.requested = true; event.preventDefault(); } }
      if (event.key === 'ArrowLeft' || key === 'a') touchControls.current.left = true;
      if (event.key === 'ArrowRight' || key === 'd') touchControls.current.right = true;
      if (event.key === 'ArrowUp' || key === 'w') touchControls.current.up = true;
      if (event.key === 'ArrowDown' || key === 's') touchControls.current.down = true;
      if (key === 'j') touchControls.current.bottomLeft = true;
      if (key === 'l') touchControls.current.bottomRight = true;
      if (key === 'i') touchControls.current.leftUp = true;
      if (key === 'k') touchControls.current.leftDown = true;
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.key === 'ArrowLeft' || key === 'a') touchControls.current.left = false;
      if (event.key === 'ArrowRight' || key === 'd') touchControls.current.right = false;
      if (event.key === 'ArrowUp' || key === 'w') touchControls.current.up = false;
      if (event.key === 'ArrowDown' || key === 's') touchControls.current.down = false;
      if (key === 'j') touchControls.current.bottomLeft = false;
      if (key === 'l') touchControls.current.bottomRight = false;
      if (key === 'i') touchControls.current.leftUp = false;
      if (key === 'k') touchControls.current.leftDown = false;
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  const bindTouch = (direction: keyof typeof touchControls.current) => ({ onPointerDown: () => { touchControls.current[direction] = true; }, onPointerUp: () => { touchControls.current[direction] = false; }, onPointerLeave: () => { touchControls.current[direction] = false; } });
  const pointerPosition = (event: PointerEvent<HTMLDivElement>) => {
    const arena = arenaRef.current;
    if (!arena) return { x: 500, y: 300 };
    const rect = arena.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * world.w, y: ((event.clientY - rect.top) / rect.height) * world.h };
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (paused) return;
    if (isServing) { requestLaunch(); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    const mySide = players.find(p => p.socketId === socket.id)?.side || 'bottom';
    drag.current = { side: mySide, x: point.x, y: point.y };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current.side) return;
    const point = pointerPosition(event);
    drag.current.x = point.x;
    drag.current.y = point.y;
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current.side = null;
  };

  const startBottomDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (paused) return;
    const mySide = players.find(p => p.socketId === socket.id)?.side || 'bottom';
    if (isServing && servingRef.current.side === mySide) { requestLaunch(); }
    const point = pointerPosition(event);
    drag.current = { side: mySide, x: point.x, y: point.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return <main className="game-shell" dir={isAr ? "rtl" : "ltr"} style={{ touchAction: 'none' }} onContextMenu={e=>e.preventDefault()}>
    <header className="game-topbar">
      <Brand />
      <div className="match-meta">
        <span><i className="live-dot" /></span>
        <b>{settings.mode === 'time' ? formatTime(timeLeft) : '∞'}</b>
        <small>{settings.mode === 'time' ? (isAr ? 'الوقت' : 'Time') : (isAr ? `الهدف ${settings.goal}` : `Goal ${settings.goal}`)}</small>
      </div>
      <div className="game-actions">
        <button className="game-icon" onClick={() => setSound((value) => !value)} aria-label="الصوت"><Volume2 size={18} /></button>
        <button className="game-icon" onClick={onPause} aria-label="إيقاف مؤقت">{paused ? <Play size={18} /> : <Pause size={18} />}</button>
        <button className="game-icon" onClick={onExit} aria-label="خروج - القائمة الرئيسية"><X size={18} /></button>
      </div>
    </header>
    <div className="score-strip">
      {players.map((player) => <div className="score-chip" key={player.id}><span className="score-color" style={{ background: player.color }} /><span>{player.name}</span><strong>{scores[player.id] ?? 0}</strong></div>)}
      <div className="rally-meter"><span>{isAr ? 'التتابع' : 'Rally'}</span><b>{rally}</b><Sparkles size={14} /></div>
    </div>
  <section className="arena-stage" style={{width:'100%', maxWidth:'100vw', display:'flex', flexDirection:'column', alignItems:'center'}}>
   <div className="arena-frame" ref={arenaRef} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
  style={{
    touchAction: 'none',
    width: `min(95vw, 760px, ${(88 * (world.w / world.h)).toFixed(2)}vh)`,
    aspectRatio: `${world.w} / ${world.h}`,
    margin: '0 auto',
    borderRadius: '32px',
    overflow: 'hidden',
    background: '#000',
    boxShadow: '0 0 0 2px #111, 0 0 40px rgba(0,229,255,0.25)',
  }}>
      <canvas ref={canvasRef} style={{ touchAction: 'none', width:'100%', height:'100%' }} />
      {isServing && <div style={{position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)', pointerEvents:'none', width:'86px', height:'86px', borderRadius:'50%', border:'2px dashed rgba(255,34,51,.85)', boxShadow:'0 0 24px rgba(255,34,51,.45)'}} />}
      {paused && <div className="pause-overlay"><div className="pause-card"><Pause size={23} /><h2>{isAr ? 'توقفت' : 'Paused'}</h2><button className="primary-cta" onClick={onPause}><Play size={17} /> {isAr ? 'متابعة' : 'Resume'}</button></div></div>}
      {lastGoal && <div className="goal-toast"><span>{isAr ? 'هدف!' : 'Goal!'}</span><strong>{lastGoal}</strong></div>}
    </div>
        <div onPointerDown={startBottomDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} style={{height:'88px', width:'100%', maxWidth:'min(95vw, 760px)', touchAction:'none', background:'rgba(255,255,255,0.06)', marginTop:'8px', borderRadius:'12px'}} />
      </section><div className="touch-controls"><button {...bindTouch('bottomRight')}><ChevronRight size={24} /></button><button {...bindTouch('bottomLeft')}><ChevronLeft size={24} /></button></div></main>;
}

function ai(ball: number, paddle: number, difficulty: Difficulty) { const factor = difficulty === 'easy' ? .35 : difficulty === 'normal' ? .65 : .92; return ball > paddle + 16 ? factor : ball < paddle - 16 ? -factor : 0; }

function getColoredPaddle(color: string, size: number = 42): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width=size; c.height=size;
  const ctx = c.getContext('2d')!;
  ctx.shadowColor = color; ctx.shadowBlur = 20;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(size/2, size/2, size*0.48, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(size/2, size/2, size*0.28, 0, Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const grad = ctx.createRadialGradient(size*0.38, size*0.38, size*0.05, size/2, size/2, size*0.32);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.2, color); grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(size/2, size*0.52, size*0.30, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.arc(size*0.38, size*0.38, size*0.08, 0, Math.PI*2); ctx.fill();
  return c;
}

function draw(context: CanvasRenderingContext2D, state: { ball: { x: number; y: number; vx: number; vy: number }; paddles: { top: Vec2; right: Vec2; bottom: Vec2; left: Vec2 }; effects: { x: number; y: number; born: number; color: string }[] }, players: Player[], now: number, isServing: boolean = false, world = RECTANGULAR_WORLD) {
  const canvas = context.canvas as HTMLCanvasElement;
  const sx = canvas.width / world.w;
  const sy = canvas.height / world.h;
  context.save(); context.setTransform(1,0,0,1,0,0); context.clearRect(0,0,canvas.width,canvas.height); context.restore();

  const outerRadius = 36;
  const borderOuter = 32;
  const borderInner = 14;
  const countdown = (state as any).countdown || 0;

  context.fillStyle = '#000000';
  context.fillRect(0, 0, world.w, world.h);

  const rr = (x:number,y:number,w:number,h:number,r:number)=>{
    context.beginPath();
    context.moveTo(x+r, y);
    context.lineTo(x+w-r, y);
    context.quadraticCurveTo(x+w, y, x+w, y+r);
    context.lineTo(x+w, y+h-r);
    context.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    context.lineTo(x+r, y+h);
    context.quadraticCurveTo(x, y+h, x, y+h-r);
    context.lineTo(x, y+r);
    context.quadraticCurveTo(x, y, x+r, y);
    context.closePath();
  };

  context.fillStyle = '#0c0c0c';
  rr(0, 0, world.w, world.h, outerRadius);
  context.fill();

  const frameShine = context.createLinearGradient(0, 0, 0, 80);
  frameShine.addColorStop(0, 'rgba(255,255,255,0.18)');
  frameShine.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = frameShine;
  rr(0, 0, world.w, 80, outerRadius);
  context.fill();

  const ledX = borderOuter - 6;
  const ledY = borderOuter - 6;
  const ledW = world.w - (borderOuter - 6)*2;
  const ledH = world.h - (borderOuter - 6)*2;
  const ledR = outerRadius - 10;

  let ledGrad: CanvasGradient;
  if (typeof (context as any).createConicGradient === 'function') {
    ledGrad = (context as any).createConicGradient(-Math.PI * 0.78, world.w / 2, world.h / 2);
    ledGrad.addColorStop(0.00, '#00e5ff');
    ledGrad.addColorStop(0.20, '#7c4dff');
    ledGrad.addColorStop(0.40, '#ff2d78');
    ledGrad.addColorStop(0.60, '#ff7a28');
    ledGrad.addColorStop(0.80, '#ffcf5a');
    ledGrad.addColorStop(1.00, '#00e5ff');
  } else {
    ledGrad = context.createLinearGradient(ledX, ledY, ledX+ledW, ledY+ledH);
    ledGrad.addColorStop(0, '#00e5ff'); ledGrad.addColorStop(0.5, '#ff2d78'); ledGrad.addColorStop(1, '#ff8a2a');
  }

  context.save();
  context.shadowBlur = 35;
  context.shadowColor = '#00e5ff';
  context.strokeStyle = ledGrad;
  context.lineWidth = 12;
  context.lineCap = 'round';
  rr(ledX, ledY, ledW, ledH, ledR);
  context.stroke();
  context.restore();

  context.save();
  context.shadowBlur = 22;
  context.shadowColor = '#ff7a28';
  context.strokeStyle = ledGrad;
  context.lineWidth = 3.5;
  context.globalAlpha = 0.9;
  rr(2, 2, world.w-4, world.h-4, outerRadius-2);
  context.stroke();
  context.restore();

  context.strokeStyle = 'rgba(255,255,255,0.95)';
  context.lineWidth = 4;
  rr(ledX, ledY, ledW, ledH, ledR);
  context.stroke();

  context.strokeStyle = ledGrad;
  context.lineWidth = 18;
  context.globalAlpha = 0.22;
  rr(ledX+8, ledY+8, ledW-16, ledH-16, ledR-6);
  context.stroke();
  context.globalAlpha = 1;

  const goalBlockW = 130;
  const goalBlockH = 26;
  context.fillStyle = '#060606';
  rr((world.w - goalBlockW)/2, ledY - goalBlockH + 12, goalBlockW, goalBlockH, 12); context.fill();
  rr((world.w - goalBlockW)/2, ledY + ledH - 12, goalBlockW, goalBlockH, 12); context.fill();
  context.fillStyle = 'rgba(255,255,255,0.08)';
  rr((world.w - goalBlockW)/2 + 6, ledY - goalBlockH + 15, goalBlockW - 12, 6, 4); context.fill();
  context.fillStyle = '#333';
  context.beginPath(); context.arc((world.w - goalBlockW)/2 + 14, ledY - goalBlockH + 25, 2.4, 0, Math.PI*2); context.fill();
  context.beginPath(); context.arc((world.w + goalBlockW)/2 - 14, ledY - goalBlockH + 25, 2.4, 0, Math.PI*2); context.fill();
  context.beginPath(); context.arc((world.w - goalBlockW)/2 + 14, ledY + ledH - 1, 2.4, 0, Math.PI*2); context.fill();
  context.beginPath(); context.arc((world.w + goalBlockW)/2 - 14, ledY + ledH - 1, 2.4, 0, Math.PI*2); context.fill();

  const innerX = borderOuter + borderInner;
  const innerY = borderOuter + borderInner;
  const innerW = world.w - (borderOuter + borderInner)*2;
  const innerH = world.h - (borderOuter + borderInner)*2;
  const innerR = outerRadius - 18;

  context.fillStyle = '#f3f5f7';
  rr(innerX, innerY, innerW, innerH, innerR);
  context.fill();

  context.fillStyle = '#0a0a0a';
  const dotStep = 26;
  const dotR = 1.9;
  for (let y = innerY + 18; y < innerY + innerH - 10; y += dotStep) {
    const offsetX = (Math.floor((y - innerY)/dotStep) % 2 === 0) ? 0 : dotStep/2;
    for (let x = innerX + 18 + offsetX; x < innerX + innerW - 12; x += dotStep) {
      context.beginPath(); context.arc(x, y, dotR, 0, Math.PI*2); context.fill();
    }
  }

  const leftGlow = context.createLinearGradient(innerX, innerY, innerX + 90, innerY);
  leftGlow.addColorStop(0, 'rgba(0,229,255,0.28)');
  leftGlow.addColorStop(0.5, 'rgba(124,77,255,0.16)');
  leftGlow.addColorStop(1, 'rgba(0,229,255,0)');
  context.fillStyle = leftGlow;
  rr(innerX, innerY, 90, innerH, innerR);
  context.fill();

  const rightGlow = context.createLinearGradient(innerX + innerW - 90, innerY, innerX + innerW, innerY);
  rightGlow.addColorStop(0, 'rgba(255,122,40,0)');
  rightGlow.addColorStop(0.5, 'rgba(255,45,120,0.16)');
  rightGlow.addColorStop(1, 'rgba(255,122,40,0.28)');
  context.fillStyle = rightGlow;
  rr(innerX + innerW - 90, innerY, 90, innerH, innerR);
  context.fill();

  const topShine = context.createRadialGradient(innerX + innerW*0.22, innerY + 40, 0, innerX + innerW*0.22, innerY + 40, 180);
  topShine.addColorStop(0, 'rgba(255,255,255,0.85)');
  topShine.addColorStop(0.3, 'rgba(255,255,255,0.25)');
  topShine.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = topShine;
  context.beginPath(); context.ellipse(innerX + innerW*0.22, innerY + 50, 120, 70, -0.2, 0, Math.PI*2); context.fill();

  const topShine2 = context.createRadialGradient(innerX + innerW*0.78, innerY + innerH*0.38, 0, innerX + innerW*0.78, innerY + innerH*0.38, 140);
  topShine2.addColorStop(0, 'rgba(255,122,40,0.22)');
  topShine2.addColorStop(1, 'rgba(255,122,40,0)');
  context.fillStyle = topShine2;
  context.beginPath(); context.ellipse(innerX + innerW*0.78, innerY + innerH*0.38, 90, 120, 0.3, 0, Math.PI*2); context.fill();

  context.save();
  context.globalAlpha = 0.5;
  const streak1 = context.createLinearGradient(innerX + innerW*0.18, innerY, innerX + innerW*0.28, innerY + innerH);
  streak1.addColorStop(0, 'rgba(255,255,255,0)');
  streak1.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  streak1.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = streak1;
  context.beginPath();
  context.moveTo(innerX + innerW*0.16, innerY);
  context.lineTo(innerX + innerW*0.22, innerY);
  context.lineTo(innerX + innerW*0.30, innerY + innerH);
  context.lineTo(innerX + innerW*0.24, innerY + innerH);
  context.closePath();
  context.fill();

  const streak2 = context.createLinearGradient(innerX + innerW*0.68, innerY, innerX + innerW*0.80, innerY + innerH);
  streak2.addColorStop(0, 'rgba(255,180,220,0)');
  streak2.addColorStop(0.5, 'rgba(255,180,220,0.4)');
  streak2.addColorStop(1, 'rgba(255,180,220,0)');
  context.fillStyle = streak2;
  context.beginPath();
  context.moveTo(innerX + innerW*0.66, innerY);
  context.lineTo(innerX + innerW*0.72, innerY);
  context.lineTo(innerX + innerW*0.82, innerY + innerH);
  context.lineTo(innerX + innerW*0.76, innerY + innerH);
  context.closePath();
  context.fill();
  context.restore();

  context.strokeStyle = 'rgba(0,0,0,0.07)';
  context.lineWidth = 1.2;
  context.beginPath(); context.moveTo(innerX + innerW/2, innerY); context.lineTo(innerX + innerW/2, innerY + innerH); context.stroke();
  context.beginPath(); context.arc(innerX + innerW/2, innerY + innerH/2, 68, 0, Math.PI*2); context.stroke();

  const colors = Object.fromEntries(players.map((player) => [player.side, player.color]));
  const active = (side: Player['side']) => players.some((player) => player.side === side);
  const GOAL_W = players.length===2 ? 260 : 300;
  const GX1 = (world.w - GOAL_W) / 2; const GX2 = GX1 + GOAL_W;
  const GY1 = (world.h - GOAL_W) / 2; const GY2 = GY1 + GOAL_W;

  const drawGoal = (x:number,y:number,w:number,h:number,col:string)=>{
    context.fillStyle = '#000000';
    context.fillRect(x, y, w, h);
    context.fillStyle = col + '33';
    context.fillRect(x, y, w, h);
    context.strokeStyle = col;
    context.lineWidth = 2.5;
    context.shadowColor = col; context.shadowBlur = 12;
    context.strokeRect(x, y, w, h);
    context.shadowBlur = 0;
  };
  if (active('top')) drawGoal(GX1, 0, GOAL_W, borderOuter+2, colors.top ?? COLORS[1]);
  if (active('bottom')) drawGoal(GX1, world.h - (borderOuter+2), GOAL_W, borderOuter+2, colors.bottom ?? COLORS[0]);
  if (active('left')) drawGoal(0, GY1, borderOuter+2, GOAL_W, colors.left ?? COLORS[3]);
  if (active('right')) drawGoal(world.w - (borderOuter+2), GY1, borderOuter+2, GOAL_W, colors.right ?? COLORS[2]);

  const drawHatPaddle = (x: number, y: number, color: string) => {
    const size = PADDLE_SIZE;
    context.save();
    const clampedX = Math.max(innerX + size/2, Math.min(innerX + innerW - size/2, x));
    const clampedY = Math.max(innerY + size/2, Math.min(innerY + innerH - size/2, y));
    context.translate(clampedX, clampedY);
    context.shadowColor = color; context.shadowBlur = 20; context.shadowOffsetY = 3;
    const img = getColoredPaddle(color, size);
    context.drawImage(img, -size/2, -size/2, size, size);
    context.restore();
  };

  if (active('top')) drawHatPaddle(state.paddles.top.x, state.paddles.top.y, colors.top ?? COLORS[1]);
  if (active('bottom')) drawHatPaddle(state.paddles.bottom.x, state.paddles.bottom.y, colors.bottom ?? COLORS[0]);
  if (active('left')) drawHatPaddle(state.paddles.left.x, state.paddles.left.y, colors.left ?? COLORS[3]);
  if (active('right')) drawHatPaddle(state.paddles.right.x, state.paddles.right.y, colors.right ?? COLORS[2]);

  if (countdown > 0) {
    context.save(); context.fillStyle='rgba(0,0,0,0.78)'; context.fillRect(0,0,world.w,world.h);
    context.fillStyle='#ff2233'; context.font='bold 120px sans-serif'; context.textAlign='center'; context.textBaseline='middle';
    context.shadowColor='#ff2233'; context.shadowBlur=28; context.fillText(String(countdown), world.w/2, world.h/2); context.shadowBlur=0;
    context.restore();
  }
  const screenRadius = 11 * Math.min(sx, sy);
  const rx = screenRadius / sx; const ry = screenRadius / sy;
  context.save();
  context.shadowColor = '#ff1a2e'; context.shadowBlur = isServing ? 32 : 22;
  context.fillStyle = '#ff2233';
  context.beginPath(); context.ellipse(state.ball.x, state.ball.y, rx, ry, 0, 0, Math.PI*2); context.fill();
  context.shadowBlur = 0;
  context.fillStyle = 'rgba(255,255,255,0.85)';
  context.beginPath(); context.ellipse(state.ball.x - rx*0.28, state.ball.y - ry*0.32, rx*0.32, ry*0.32, 0, 0, Math.PI*2); context.fill();
  context.fillStyle = '#a8000e';
  context.beginPath(); context.ellipse(state.ball.x + rx*0.25, state.ball.y + ry*0.25, rx*0.28, ry*0.28, 0, 0, Math.PI*2); context.fill();
  context.restore();

  if (isServing) {
    context.strokeStyle = 'rgba(255,34,51,0.85)'; context.lineWidth = 2.8; context.setLineDash([7,7]);
    context.beginPath(); context.ellipse(state.ball.x, state.ball.y, rx*2.7, ry*2.7, 0, 0, Math.PI*2); context.stroke();
    context.setLineDash([]);
  }

  state.effects = state.effects.filter((effect) => now - effect.born < 900);
  state.effects.forEach((effect) => {
    const progress = (now - effect.born) / 900;
    const erx = (16 + progress * 58); const ery = (16 + progress * 58) * sx / sy;
    context.save(); context.globalAlpha = 1 - progress; context.strokeStyle = effect.color; context.lineWidth = 4 - progress*2; context.shadowColor = effect.color; context.shadowBlur = 14;
    context.beginPath(); context.ellipse(effect.x, effect.y, erx, ery, 0, 0, Math.PI*2); context.stroke(); context.restore();
  });
}
function formatTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }

function ResultsScreen({ players, scores, winner, wins, onAgain, onHome }: { players: Player[]; scores: Scores; winner: Player | null; wins: Record<string, number>; onAgain: () => void; onHome: () => void }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar') ?? true;
  const ranking = useMemo(() => [...players].sort((a, b) => (scores[b.id]?? 0) - (scores[a.id]?? 0)), [players, scores]);

  return <main className="app-shell results-shell" dir={isAr? 'rtl' : 'ltr'}>
    <header className="topbar game-topbar">
      <Brand />
    </header>
    <section className="results-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px' }}>
      <div style={{ background: '#111', padding: '32px', borderRadius: '24px', textAlign: 'center', border: '2px solid #333', width: '100%', maxWidth: '400px' }}>
        <h1 style={{ color: '#00e5ff', fontSize: '2.5rem', marginBottom: '24px' }}>
          {winner ? `${winner.name} ${isAr ? 'فاز!' : 'Wins!'}` : (isAr ? 'انتهت' : 'Game Over')}
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
          {ranking.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: '#0a0a0a', borderRadius: '12px', border: `1px solid ${p.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <b style={{ color: '#888' }}>#{i + 1}</b>
                <span style={{ color: p.color, fontWeight: 'bold' }}>{p.name}</span>
              </div>
              <strong style={{ fontSize: '1.2rem', color: '#fff' }}>{scores[p.id] ?? 0}</strong>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button className="primary-cta" onClick={onAgain} style={{ flex: 1, justifyContent: 'center' }}>{isAr ? 'العب مرة أخرى' : 'Play Again'}</button>
          <button className="secondary-btn" onClick={onHome} style={{ flex: 1 }}>{isAr ? 'الرئيسية' : 'Home'}</button>
        </div>
      </div>
    </section>
  </main>;
}

export default App;
