import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, LogIn, Minus, Monitor, Pause, Play, Plus, Volume2, X, Zap, ArrowLeft, Gamepad2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GameScreen3D } from './components/GameScreen3D';
import { socket, colyseus } from './socket.tsx';

type Screen = 'setup' | 'waiting' | 'game' | 'results';
type StartMode = 'paddle' | 'center';
type SpeedMode = 'gradual' | 'fixed' | 'never_reset';
type MatchMode = 'time' | 'goals';
type Difficulty = 'easy' | 'normal' | 'hard';
type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string };
type ArenaSize = 'small' | 'medium' | 'large' | 'xlarge';
type Settings = { players: number; vsComputer: boolean; difficulty: Difficulty; start: StartMode; mode: MatchMode; duration: number; goal: number; speed: SpeedMode; ballSpeed: number; sound: boolean; graphics: '2d' | '3d'; arenaSize: ArenaSize; seriesType: 'single' | 'series'; seriesRounds: number; };
type Scores = Record<string | number, number>;
type RoomData = { code: string; players: Player[]; maxPlayers: number; status: 'waiting' | 'playing'; createdAt?: number; hostName?: string; hostSocketId?: string; settings?: Partial<Settings> };
type Vec2 = { x: number; y: number };

const ARENA_SCALES: Record<ArenaSize, number> = { small: 0.8, medium: 1.0, large: 1.25, xlarge: 1.5 };
const COLORS = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
const SIDES: Player['side'][] = ['bottom', 'top', 'right', 'left'];
const RECTANGULAR_WORLD = { w: 700, h: 1050 };
const SQUARE_WORLD = { w: 1000, h: 1000 };
const ZONE = 100;
const PADDLE_SIZE = 42;
const defaultSettings = { players: 2, vsComputer: true, difficulty: 'normal', start: 'center', mode: 'time', duration: 180, goal: 7, speed: 'never_reset', ballSpeed: 10, sound: true, graphics: '2d', arenaSize: 'medium', seriesType: 'single', seriesRounds: 3 } as Settings;

function randomRoom(existing: string[] = []) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do { code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); } while (existing.includes(code));
  return code;
}
function loadWins(): Record<string, number> { try { return JSON.parse(localStorage.getItem('qoud-ping-pong-wins')?? '{}') as Record<string, number>; } catch { return {}; } }

type SocketListener = (...args: any[]) => void;
class ColyseusBridge {
  room: any = null;
  listeners = new Map<string, Set<SocketListener>>();
  get connected() { return Boolean(this.room); }
  get id() { return this.room?.sessionId?? ''; }
  on(event: string, listener: SocketListener) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event)!.add(listener); return this; }
  off(event: string, listener?: SocketListener) { if (!listener) this.listeners.delete(event); else this.listeners.get(event)?.delete(listener); return this; }
  emit(event: string, payload?: unknown) { if (!this.room) return false; this.room.send(event, payload); return true; }
  attach(room: any) {
    this.room = room;
    for (const messageType of ['room-update', 'game-started', 'goal-scored', 'match-finished', 'host-left', 'game-state', 'paddle-input']) {
      room.onMessage(messageType, (payload: unknown) => this.dispatch(messageType, payload));
    }
    room.onStateChange((state: any) => this.dispatch('room-update', this.roomData(state)));
    room.onError?.((code: number, message: string) => this.dispatch('error', message || `Connection error (${code})`));
    room.onLeave?.((code: number) => { if (this.room === room) this.dispatch('connection-lost', code); });
    if (room.state) this.dispatch('room-update', this.roomData(room.state));
  }
  async leave() { const room = this.room; this.room = null; if (room) await room.leave(true); }
  private dispatch(event: string,...args: any[]) { this.listeners.get(event)?.forEach((listener) => listener(...args)); }
  private roomData(state: any): RoomData {
    const players = state?.players? Array.from(state.players.values()).map((player: any) => ({ id: player.id, name: player.name, color: player.color, side: player.side, computer: Boolean(player.computer), socketId: player.id, })) : [];
    let settings: Partial<Settings> | undefined;
    try { settings = state?.settingsJson? JSON.parse(state.settingsJson) : undefined; } catch {}
    return { code: state?.code?? '', status: state?.status?? 'waiting', maxPlayers: Number(state?.maxPlayers?? players.length), hostSocketId: state?.hostSessionId, hostName: players.find((player: Player) => player.id === state?.hostSessionId)?.name, players, settings, };
  }
}
function getArenaWorld(playersCount: number, arenaSize: ArenaSize = 'medium') {
  const baseWorld = playersCount === 4? SQUARE_WORLD : RECTANGULAR_WORLD;
  const scale = ARENA_SCALES[arenaSize] || 1.0;
  return { w: baseWorld.w * scale, h: baseWorld.h * scale, };
}

function App() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar')?? true;
  const [screen, setScreen] = useState<Screen>('setup');
  const [settings, setSettings] = useState<Settings>(() => { try { return {...defaultSettings,...JSON.parse(localStorage.getItem('qoud-ping-pong-settings')?? '{}') as Partial<Settings> }; } catch { return defaultSettings; } });
  const [room, setRoom] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState(() => localStorage.getItem('qoud_name') || '');
  const [names, setNames] = useState(['نورا', 'سامي', 'ليان', 'كريم']);
  const [computers, setComputers] = useState<boolean[]>([false, true, true, true]);
  const [scores, setScores] = useState<Scores>({});
  const [wins, setWins] = useState<Record<string, number>>(loadWins);
  const [winner, setWinner] = useState<Player | null>(null);
  const [lastGoal, setLastGoal] = useState<string | null>(null);
  const [matchPaused, setMatchPaused] = useState(false);
  const [matchKey, setMatchKey] = useState(0);
  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(true);
  const [roomsCount, setRoomsCount] = useState(0);
  const [celebrating, setCelebrating] = useState<Player | null>(null);
  const [seriesWins, setSeriesWins] = useState<Record<string, number>>({});
  const [currentRound, setCurrentRound] = useState(1);
  const [roundWinner, setRoundWinner] = useState<Player | null>(null);
  const celebratingRef = useRef<Player | null>(null);

  const playersRef = useRef(players);
  const roomRef = useRef(room);
  const screenRef = useRef(screen);
  const isArRef = useRef(isAr);
  const scoresRef = useRef(scores);
  const settingsRef = useRef(settings);
  const currentRoundRef = useRef(currentRound);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { isArRef.current = isAr; }, [isAr]);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { celebratingRef.current = celebrating; }, [celebrating]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { currentRoundRef.current = currentRound; }, [currentRound]);
  useEffect(() => { void fetch('/api/rooms').then(r => r.ok? r.json() : null).then((d: any) => { if (d?.count!== undefined) setRoomsCount(d.count); }).catch(() => {}); }, []);

  useEffect(() => {
    const onRoomUpdate = (roomData: RoomData) => {
      setRoom(prev => roomData.code || prev || roomRef.current);
      if (screenRef.current!== 'game' && roomData.players?.length > 0) setPlayers(roomData.players);
      if (roomData.settings && screenRef.current!== 'game') setSettings((current) => ({...current,...roomData.settings }));
      if (roomData.hostSocketId) setIsHost(roomData.hostSocketId === socket.id);
      if (roomData.status === 'playing' && screenRef.current === 'waiting') { setWinner(null); setLastGoal(null); setMatchPaused(false); setCelebrating(null); setMatchKey((k) => k + 1); setScreen('game'); }
    };
    const onGameStarted = () => { setWinner(null); setLastGoal(null); setMatchPaused(false); setCelebrating(null); setMatchKey((k) => k + 1); setScreen('game'); };
    const onMatchFinished = ({ winnerId, scores: serverScores }: any) => {
      if (celebratingRef.current) {
        setScores(serverScores); setWinner(playersRef.current.find((p) => p.id === winnerId)?? celebratingRef.current); setScreen('results'); setCelebrating(null); setMatchPaused(false);
      } else {
        setScores(serverScores); setWinner(playersRef.current.find((p) => p.id === winnerId)?? null); setScreen('results');
      }
    };
    const onGoalScored = ({ scores: serverScores, missedSide }: any) => {
      const isOfflineLocal =!socket.connected || playersRef.current.length < 2;
      if (isOfflineLocal) return;
      setScores(serverScores);
      const missed = playersRef.current.find((p) => p.side === missedSide);
      if (missed) { setLastGoal(missed.name); window.setTimeout(() => setLastGoal(null), 1300); }
    };
    const onError = (msg: string) => setError(msg);
    const onLost = () => { setError(isArRef.current? 'انقطع الاتصال بالخادم' : 'Connection lost'); setScreen('setup'); setPlayers([]); };
    const onHostLeft = () => { setError(isArRef.current? 'منشئ الغرفة غادر' : 'Host left'); setScreen('setup'); };
    socket.on('room-update', onRoomUpdate); socket.on('game-started', onGameStarted); socket.on('match-finished', onMatchFinished); socket.on('goal-scored', onGoalScored); socket.on('error', onError); socket.on('connection-lost', onLost); socket.on('host-left', onHostLeft);
    return () => { socket.off('room-update', onRoomUpdate); socket.off('game-started', onGameStarted); socket.off('match-finished', onMatchFinished); socket.off('goal-scored', onGoalScored); socket.off('error', onError); socket.off('connection-lost', onLost); socket.off('host-left', onHostLeft); };
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = {...current,...patch };
      if (patch.vsComputer!== undefined) setComputers([false, patch.vsComputer, patch.vsComputer, patch.vsComputer]);
      return next;
    });
  };
  const makePlayers = useCallback(() => {
    const total = settings.players;
    return Array.from({ length: total }, (_, index) => ({ id: String(index), name: names[index]?.trim() || `لاعب ${index + 1}`, color: COLORS[index], side: SIDES[index], computer: index === 0? false : computers[index], }));
  }, [names, settings.players, computers]);

  const enterWaiting = async () => {
    const trimmed = names.slice(0, settings.players).map(n => n.trim());
    if (trimmed.some(n => n.length < 2)) { setError(isAr? 'اكتب اسم كل اللاعبين حرفين على الاقل' : 'Names must be at least 2 chars'); return; }
    if (new Set(trimmed).size!== trimmed.length) { setError(isAr? 'الاسماء لازم مختلفة' : 'Names must be unique'); return; }
    localStorage.setItem('qoud-ping-pong-settings', JSON.stringify(settings));
    const allPlayers = makePlayers();
    try {
      const roomCode = randomRoom();
      const colyseusRoom = await colyseus.create('qoud', { code: roomCode, maxPlayers: settings.players, settings, player: allPlayers[0], computerPlayers: [], name: allPlayers[0].name, });
      socket.attach(colyseusRoom); setRoom(roomCode); setIsHost(true); setError(''); setScreen('waiting');
    } catch (cause) { setError(cause instanceof Error? cause.message : (isAr? 'تعذر إنشاء الغرفة' : 'Could not create room')); }
  };
  const joinByCode = async (customName?: string) => {
    const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (code.length!== 4) { setError(isAr? 'الكود 4 حروف' : 'Code 4 chars'); return; }
    const finalName = (customName || joinName || localStorage.getItem('qoud_name') || names[0] || 'لاعب').trim().slice(0, 15);
    if (finalName.length < 2) { setError(isAr? 'اكتب اسمك أولاً' : 'Write your name first'); return; }
    localStorage.setItem('qoud_name', finalName);
    try {
      const lookup = await fetch(`/api/rooms?code=${encodeURIComponent(code)}`);
      if (!lookup.ok) throw new Error(isAr? 'الغرفة غير موجودة' : 'Room not found');
      const { roomId } = await lookup.json() as { roomId: string };
      const colyseusRoom = await colyseus.joinById(roomId, { name: finalName });
      socket.attach(colyseusRoom); setRoom(code); setIsHost(false); setError(''); setScreen('waiting');
    } catch (cause) { setError(cause instanceof Error? cause.message : 'تعذر الانضمام'); }
  };
  const leaveWaiting = () => { void socket.leave(); setPlayers([]); setError(''); setScreen('setup'); };
  const leaveMatch = useCallback(() => { void socket.leave(); setPlayers([]); setScreen('setup'); setMatchPaused(false); setCelebrating(null); }, []);

  const finishMatch = useCallback((champion: Player) => {
    if (celebratingRef.current) return;
    // جولات متتالية: نحسب فوز الجولة مع احتفال 8 ثواني كراش داخل نفس الساحة
    if (settingsRef.current?.seriesType === 'series' || (settings as any).seriesType === 'series') {
      const totalRounds = (settingsRef.current?.seriesRounds ?? settings.seriesRounds ?? 3);
      setCelebrating(champion);
      celebratingRef.current = champion;
      // لا نوقف اللعبة - الاحتفال داخل نفس الساحة
      setRoundWinner(champion);
      setSeriesWins((prev) => {
        const upd = {...prev, [champion.id]: (prev[champion.id]??0)+1 };
        const nextRound = currentRoundRef.current;
        if (nextRound >= totalRounds) {
          // انتهت كل الجولات - نحدد الفائز الإجمالي بعد 8 ثواني احتفال سلس
          setTimeout(() => {
            const sorted = Object.entries(upd).sort((a,b)=>b[1]-a[1]);
            const maxWins = sorted[0]?.[1] ?? 0;
            const topWinners = sorted.filter(([,v])=>v===maxWins);
            if (topWinners.length > 1) {
              setWinner(null);
              setWins((cur) => cur);
            } else {
              const overallWinnerId = sorted[0]?.[0];
              const overallWinner = playersRef.current.find(p=>String(p.id)===String(overallWinnerId)) ?? champion;
              setWinner(overallWinner);
              setWins((current) => {
                const updated = {...current, [overallWinner.name]: (current[overallWinner.name]?? 0) + 1 };
                localStorage.setItem('qoud-ping-pong-wins', JSON.stringify(updated));
                return updated;
              });
            }
            if (isHost) socket.emit('match-finished', { winnerId: champion.id, scores: scoresRef.current, seriesWins: upd, currentRound: totalRounds, isSeriesEnd: true });
            setScreen('results');
            setCelebrating(null);
            celebratingRef.current = null;
            setMatchPaused(false);
          }, 8000);
        } else {
          // في جولات باقية - كراش للجولة القادمة بعد 8 ثواني احتفال
          setTimeout(() => {
            setCurrentRound((r)=>r+1);
            setCelebrating(null);
            celebratingRef.current = null;
            setMatchPaused(false);
            setScores(Object.fromEntries(playersRef.current.map(p => [p.id, 0])));
            setMatchKey((k)=>k+1);
            setRoundWinner(null);
            setLastGoal(null);
            if (isHost) socket.emit('match-finished', { winnerId: champion.id, scores: scoresRef.current, seriesWins: upd, currentRound: nextRound, isSeriesEnd: false });
          }, 8000);
        }
        return upd;
      });
      return;
    }
    // لعب حر - احتفال 8 ثواني داخل نفس الساحة بدون توقف
    setCelebrating(champion);
    celebratingRef.current = champion;
    // لا نعمل pause - اللعبة تستمر في الخلفية
    setTimeout(() => {
      setWinner(champion);
      setWins((current) => {
        const updated = {...current, [champion.name]: (current[champion.name]?? 0) + 1 };
        localStorage.setItem('qoud-ping-pong-wins', JSON.stringify(updated));
        return updated;
      });
      if (isHost) socket.emit('match-finished', { winnerId: champion.id, scores: scoresRef.current });
      setScreen('results');
      setCelebrating(null);
      celebratingRef.current = null;
      setMatchPaused(false);
    }, 8000);
  }, [isHost]);

  const startMatch = useCallback(() => {
    const canStart = isHost || playersRef.current.length <= 1 ||!socket.connected;
    if (!canStart) { setError(isArRef.current? 'المنشئ هو من يبدأ الجولة' : 'Only the host can start'); return; }
    const isOffline =!socket.connected || playersRef.current.length < settings.players || settings.vsComputer;
    const currentPlayers = isOffline? makePlayers() : (playersRef.current.length > 0? playersRef.current : makePlayers());
    if (socket.connected &&!isOffline) socket.emit('start-game', { code: roomRef.current });
    setPlayers(currentPlayers); setScores(Object.fromEntries(currentPlayers.map(p => [p.id, 0]))); setWinner(null); setLastGoal(null); setMatchPaused(false); setCelebrating(null); celebratingRef.current = null; setSeriesWins({}); setCurrentRound(1); setRoundWinner(null); setMatchKey((key) => key + 1); setScreen('game');
  }, [isHost, makePlayers, settings.players, settings.vsComputer]);

  const goalScored = useCallback((missed: Player) => {
    const isOffline =!socket.connected || playersRef.current.length < settings.players || settings.vsComputer;
    if (!isHost && socket.connected &&!isOffline) return;
    const list = playersRef.current.length >= settings.players? playersRef.current : makePlayers();
    const oppositeMap: Record<string, Player['side']> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
    const scorerSide = oppositeMap[missed.side]?? 'bottom';
    const scorer = list.find(p => p.side === scorerSide)?? list.find(p => p.side!== missed.side)?? list[0];
    if (scorer) { setLastGoal(scorer.name); window.setTimeout(() => setLastGoal(null), 1300); }
    setScores((current) => {
      if (!scorer) return current;
      const updated = {...current }; updated[scorer.id] = (updated[scorer.id]?? 0) + 1;
      if (!isOffline && socket.connected) socket.emit('goal-scored', { missedSide: missed.side, scores: updated });
      if (settings.mode === 'goals' && (updated[scorer.id]?? 0) >= settings.goal) {
        setTimeout(() => finishMatch(scorer), 100);
      }
      return updated;
    });
  }, [finishMatch, settings.goal, settings.mode, isHost, makePlayers, settings.players, settings.vsComputer]);

  if (screen === 'waiting') {
    return <WaitingRoom room={room} players={players} isHost={isHost} error={error} onBack={leaveWaiting} onStart={startMatch} onRefresh={() => {}} />;
  }
  if (screen === 'game') {
    if (settings.graphics === '3d') {
      return <GameScreen3D key={matchKey} roomCode={room} isHost={isHost} players={players} settings={settings} scores={scores} lastGoal={lastGoal} paused={matchPaused} celebrating={celebrating} seriesWins={seriesWins} currentRound={currentRound} onGoal={goalScored} onTimeUp={() => { const top = [...players].sort((a, b) => (scores[b.id]?? 0) - (scores[a.id]?? 0))[0]; if (top) finishMatch(top); }} onPause={() => setMatchPaused((p:any)=>!p)} onExit={leaveMatch} />;
    }
    return <GameScreen key={matchKey} roomCode={room} isHost={isHost} players={players} settings={settings} scores={scores} lastGoal={lastGoal} paused={matchPaused} celebrating={celebrating} seriesWins={seriesWins} currentRound={currentRound} roundWinner={roundWinner} onGoal={goalScored} onTimeUp={() => { const top = [...players].sort((a, b) => (scores[b.id]?? 0) - (scores[a.id]?? 0))[0]; if (top) finishMatch(top); }} onPause={() => setMatchPaused((p:any)=>!p)} onExit={leaveMatch} />;
  }
  if (screen === 'results') {
    return <ResultsScreen players={players} scores={scores} winner={winner} wins={wins} seriesWins={seriesWins} currentRound={currentRound} settings={settings} onAgain={startMatch} onHome={() => { void socket.leave(); setPlayers([]); setScreen('setup'); setSeriesWins({}); setCurrentRound(1); }} />;
  }
  return <SetupScreen settings={settings} names={names} roomsCount={roomsCount} joinCode={joinCode} joinName={joinName} setJoinName={setJoinName} computers={computers} error={error} onChangeName={(index: number, value: string) => setNames((current) => current.map((name, item) => item === index? value : name))} onChangeSettings={updateSettings} onToggleComputer={(idx: number) => { if (idx === 0) return; setComputers(prev => prev.map((c, i) => i === idx?!c : c)); }} onJoinCodeChange={setJoinCode} onJoin={joinByCode} onCreate={enterWaiting} />;
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-9 h-9 bg-black text-xs[#f6f0d2] border-[2.5px] border-black rounded- grid place-items-center font-black text-xssm">Q</div>
      <div className="leading-none"><div className="font-black text-xssm tracking-tight">QOUD</div><div className="text-xs font-bold -mt-1 opacity-70">LED TABLE • 42px</div></div>
    </div>
  );
}

function SetupScreen({ settings, names, roomsCount, joinCode, joinName, setJoinName, computers, error, onChangeName, onChangeSettings, onToggleComputer, onJoinCodeChange, onJoin, onCreate }: any) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar')?? true;
  return (
    <main className="min-h-screen w-full bg-[#e9dfb1] text-xsblack flex justify-center py-3 px-2" dir={isAr? 'rtl' : 'ltr'}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@600;700&family=Space+Grotesk:wght@600;700&display=swap');
        *{font-family: ${isAr? "'IBM Plex Sans Arabic', system-ui" : "'Space Grotesk', system-ui"} !important;}
        input[type=range]{-webkit-appearance:none; appearance:none; height:34px; background:transparent;}
        input[type=range]::-webkit-slider-runnable-track{height:14px; background:#fff; border:2.5px solid #000; border-radius:999px;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none; width:28px; height:28px; margin-top:-10px; background:#000; border:2.5px solid #000; border-radius:50%; box-shadow:0 0 0 2.5px #fff inset; cursor:pointer;}
        @keyframes fadeIn{from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:translateY(0)}}
      `}</style>
      <div className="w-full max-w-[480px] flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <button onClick={() => i18n.changeLanguage(isAr? 'en' : 'ar')} className="h-8 px-3 rounded-full border-[2.5px] border-black bg-white font-black text-xssmxs">{isAr? 'EN' : 'عربي'}</button>
            <span className="h-8 px-3 rounded-full border-[2.5px] border-black bg-white font-black text-xssmxs flex items-center gap-1"><span className="w-2 h-2 bg-[#ff2d2d] rounded-full animate-pulse" />{roomsCount} غرفة</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h- px-3 rounded-full border-[2.5px] border-black bg-black text-xswhite font-black text-xssm flex items-center">LED TABLE • 42px</span>
            <Brand />
          </div>
        </div>
        <div className="bg-[#fff9dc] border-[2.5px] border-black rounded-[18px] p-4 text-xscenter">
          <div className="text-xsxs font-black tracking-widest opacity-60 mb-1">طاولة LED</div>
          <h1 className="font-black text-xssm2xl leading-[1.1]">صمم مباراتك<br/>البطولية</h1>
        </div>
        {error && <div className="bg-[#ff2d2d] text-xswhite border-[2.5px] border-black rounded-[14px] p-3 font-black text-xssmsm">{error}</div>}
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[18px] p-3">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onChangeSettings({ graphics: '2d' })} className={`h- rounded-full border-[2.5px] border-black font-black text-xssm ${settings.graphics==='2d'?'bg-black text-xswhite':'bg-white'}`}>2D LED</button>
            <button onClick={() => onChangeSettings({ graphics: '3d' })} className={`h- rounded-full border-[2.5px] border-black font-black text-xssm ${settings.graphics==='3d'?'bg-black text-xswhite':'bg-white'}`}>3D LED</button>
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="font-black text-xssm">عدد اللاعبين</span>
            <div className="flex items-center gap-2 bg-black text-xswhite rounded-full px-2 h-8 border-[2.5px] border-black">
              <button onClick={() => onChangeSettings({ players: Math.min(4, settings.players + 1) })} className="w-6 h-6 grid place-items-center"><Plus size={14} /></button>
              <span className="w-6 text-xscenter font-black">{settings.players}</span>
              <button onClick={() => onChangeSettings({ players: Math.max(2, settings.players - 1) })} className="w-6 h-6 grid place-items-center"><Minus size={14} /></button>
            </div>
          </div>
        </section>
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[18px] p-3 overflow-hidden w-full box-border">
          <div className="flex items-center justify-between mb-3"><span className="bg-black text-xswhite text-xsxs font-black px-2 py-1 rounded-full shrink-0">PLAYERS {settings.players}</span><span className="font-black text-xssm">من حول الطاولة؟</span></div>
          <div className="flex flex-col gap-2 w-full">
            {Array.from({ length: settings.players }, (_, i) => (
              <div key={i} className="grid grid-cols-[38px_1fr_30px] gap-2 items-center w-full min-w-0">
                <button type="button" onClick={() => onToggleComputer(i)} className="w-9 h-6 rounded-full border-2 border-black bg-white flex items-center justify-between px-1 shrink-0 overflow-hidden">
                  <div className="w-4 h-4 rounded-full border-[1.5px] border-black transition-all" style={{background: computers[i]? '#ff6b8b' : '#fff', marginLeft: computers[i]? '16px':'0'}} />
                </button>
                <input value={names[i]} onChange={(e) => onChangeName(i, e.target.value)} className="min-w-0 w-full h-9 rounded-full border-2 border-black bg-white px-3 font-bold text-xssm outline-none box-border truncate" maxLength={14} />
                <div className="w-8 h-8 rounded-full border-2 border-black grid place-items-center shrink-0" style={{background: COLORS[i]}}><span className="text-xs">●</span></div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 w-full">
            <button onClick={() => onChangeSettings({ vsComputer: false })} className={`h-10 rounded-full border-2 border-black font-black text-smxssm w-full ${!settings.vsComputer?'bg-black text-xswhite':'bg-white'}`}>مع الأصدقاء</button>
            <button onClick={() => onChangeSettings({ vsComputer: true })} className={`h-10 rounded-full border-2 border-black font-black text-smxssm w-full ${settings.vsComputer?'bg-black text-xswhite':'bg-white'}`}>ضد الكمبيوتر</button>
          </div>
        </section>
        <section className="bg-black border-[2.5px] border-black rounded-[18px] p-3 w-full box-border">
          <div className="flex items-center justify-between mb-3"><span className="bg-[#ffcf5a] text-xsblack text-xs font-black px-2 py-1 rounded-full">JOIN ROOM</span><span className="font-black text-xssm text-xs[#f6f0d2]">انضم لغرفة موجودة؟</span></div>
          <div className="grid grid-cols-[1fr_86px_46px] gap-2 w-full min-w-0">
            <input value={joinName} onChange={(e)=>{const v=e.target.value.slice(0,15); setJoinName(v); localStorage.setItem('qoud_name',v); onChangeName(0,v);}} placeholder="اسمك" className="min-w-0 w-full h- rounded-full border- border-white bg-[#1a1a1a] text-xswhite px-3 font-bold text-xs box-border" />
            <input value={joinCode} onChange={(e)=>onJoinCodeChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4))} placeholder="BZYF" className="w- h- rounded-full border- border-white bg-white text-xsblack text-xscenter font-black tracking-[0.2em] box-border" />
            <button onClick={()=>onJoin(joinName)} className="w- h- rounded-full border- border-white bg-[#ff2d2d] grid place-items-center text-xswhite shrink-0"><LogIn size={18} /></button>
          </div>
          <div className="mt-2 text-xs font-bold text-xswhite/60 text-xscenter">اكتب اسمك + كود الغرفة 4 حروف ثم انضم</div>
        </section>
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[18px] p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><span className="bg-[#ffcf5a] border- border-black rounded-full px-2 text-xs font-black">MODE 4</span><span className="font-black text-xssm">السرعة</span></div>
            <div className="w-5 h-5 rounded-full border- border-black bg-white grid place-items-center text-xs font-black">1</div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-">
            <button onClick={()=>onChangeSettings({speed:'fixed'})} className={`relative h-[86px] rounded-[14px] border-[2.5px] border-black overflow-hidden ${settings.speed==='fixed'?'bg-black':'bg-white'}`}>
              <div className="absolute top-2 right-2 flex gap-1"><span className="w-2 h-2 rounded-full bg-[#ff2d2d]" /><span className="text-xs font-black px-1 rounded-full bg-white text-xsblack border border-black">ثابتة</span></div>
              <div className="absolute inset-0 grid place-items-center"><div className="w-16 h-8 rounded-[8px] bg-black border border-white flex items-center justify-center"><div className="w-5 h-5 rounded-full bg-[#ff2d2d] border-2 border-white" /></div></div>
              {settings.speed==='fixed' && <div className="absolute top-1 left-1 w-5 h-5 bg-white text-xsblack rounded-full grid place-items-center text-xs font-black">✓</div>}
            </button>
            <button onClick={()=>onChangeSettings({speed:'gradual'})} className={`relative h-[86px] rounded-[14px] border-[2.5px] border-black overflow-hidden ${settings.speed==='gradual'?'bg-black':'bg-white'}`}>
              <div className="absolute top-2 right-2 text-xs font-black px-1 rounded-full bg-white text-xsblack border border-black">متدرجة</div>
              <svg viewBox="0 0 120 86" className="w-full h-full"><rect width="120" height="86" fill={settings.speed==='gradual'?'#111':'#fff9dc'} /><rect x="20" y="30" width="80" height="26" rx="6" fill="#000" stroke="#000" /><circle cx="60" cy="43" r="9" fill="#ff2d2d" opacity="0.25"/><circle cx="42" cy="43" r="7.5" fill="#ff2d2d" opacity="0.45"/><circle cx="27" cy="43" r="6" fill="#ff2d2d" opacity="0.65"/><circle cx="14" cy="43" r="4.5" fill="#ff2d2d" opacity="0.9"/></svg>
              {settings.speed==='gradual' && <div className="absolute top-1 left-1 w-5 h-5 bg-white text-xsblack rounded-full grid place-items-center text-xs font-black">✓</div>}
            </button>
            <button onClick={()=>onChangeSettings({start:'paddle'})} className={`relative h-[86px] rounded-[14px] border-[2.5px] border-black overflow-hidden ${settings.start==='paddle'?'bg-black':'bg-white'}`}>
              <div className="absolute top-2 right-2 text-xs font-black px-1 rounded-full bg-white text-xsblack border border-black">من المضرب</div>
              <svg viewBox="0 0 120 86" className="w-full h-full"><rect width="120" height="86" fill={settings.start==='paddle'?'#111':'#fff9dc'} /><rect x="20" y="22" width="80" height="38" rx="8" fill="none" stroke={settings.start==='paddle'?'#fff':'#000'} strokeWidth="2"/><rect x="45" y="52" width="30" height="6" rx="3" fill={settings.start==='paddle'?'#fff':'#000'}/><circle cx="60" cy="44" r="6" fill="#ff2d2d" stroke="#000" strokeWidth="1.5"/></svg>
              {settings.start==='paddle' && <div className="absolute top-1 left-1 w-5 h-5 bg-white text-xsblack rounded-full grid place-items-center text-xs font-black">✓</div>}
            </button>
            <button onClick={()=>onChangeSettings({start:'center'})} className={`relative h-[86px] rounded-[14px] border-[2.5px] border-black overflow-hidden ${settings.start==='center'?'bg-black':'bg-white'}`}>
              <div className="absolute top-2 right-2 text-xs font-black px-1 rounded-full bg-white text-xsblack border border-black">من المنتصف</div>
              <svg viewBox="0 0 120 86" className="w-full h-full"><rect width="120" height="86" fill={settings.start==='center'?'#111':'#fff9dc'} /><rect x="20" y="22" width="80" height="38" rx="8" fill="none" stroke={settings.start==='center'?'#fff':'#000'} strokeWidth="2"/><line x1="20" y1="40" x2="100" y2="40" stroke={settings.start==='center'?'#fff':'#000'} strokeWidth="1" strokeDasharray="3 3"/><circle cx="60" cy="40" r="6" fill="#ff2d2d" stroke="#000" strokeWidth="1.5"/></svg>
              {settings.start==='center' && <div className="absolute top-1 left-1 w-5 h-5 bg-white text-xsblack rounded-full grid place-items-center text-xs font-black">✓</div>}
            </button>
          </div>
          {settings.speed==='fixed' && (
            <div className="bg-white border-[2.5px] border-black rounded-[14px] p-3 animate-[fadeIn_.2s]">
              <div className="flex justify-between mb-2"><span className="font-black text-xssm flex items-center gap-1"><span className="w-2 h-2 bg-black rounded-full" /> سرعة الكرة</span><span className="font-black text-xssm bg-black text-xswhite px-2 rounded-full">{settings.ballSpeed} / 10 - 20</span></div>
              <input type="range" min={1} max={20} value={settings.ballSpeed} onChange={e=>onChangeSettings({ballSpeed:Number(e.target.value)})} className="w-full" />
              <div className="flex justify-between text-xs font-black opacity-60 mt-1"><span>بطيء</span><span>سريع</span></div>
            </div>
          )}
        </section>
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[18px] p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><span className="bg-black text-xswhite border- border-black rounded-full px-2 text-xs font-black">SERIES</span><span className="font-black text-xssm">نظام الجولات</span></div>
            <div className="w-5 h-5 rounded-full border- border-black bg-white grid place-items-center text-xs font-black">4</div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={()=>onChangeSettings({seriesType:'single'})} className={`h-10 rounded-full border-2 border-black font-black text-smxssm ${settings.seriesType==='single'?'bg-black text-xswhite':'bg-white'}`}>🎮 لعب حر<br/><span className="text-xs opacity-70">فوز مرة واحدة</span></button>
            <button onClick={()=>onChangeSettings({seriesType:'series'})} className={`h-10 rounded-full border-2 border-black font-black text-smxssm ${settings.seriesType==='series'?'bg-black text-xswhite':'bg-white'}`}>🏆 جولات متتالية<br/><span className="text-xs opacity-70">الأكثر فوزا</span></button>
          </div>
          {settings.seriesType==='series' && (
            <div className="animate-[fadeIn_.2s] bg-white border- border-black rounded- p-">
              <div className="flex justify-between mb-2"><span className="font-black text-xssm">عدد الجولات</span><span className="font-black text-xssm bg-black text-xswhite px-2 rounded-full">{settings.seriesRounds} جولات</span></div>
              <div className="flex items-center justify-between bg-[#fff9dc] border- border-black rounded-full h- px-2 mb-2">
                <button onClick={()=>onChangeSettings({seriesRounds: Math.max(2, settings.seriesRounds-1)})} className="w-8 h-8 rounded-full border- border-black bg-white grid place-items-center"><Minus size={14} /></button>
                <div className="flex items-center gap-1">{Array.from({length: settings.seriesRounds}, (_,i)=><div key={i} className="w-5 h-5 rounded-full border-[1.5px] border-black bg-[#ffcf5a] grid place-items-center text-xs font-black">{i+1}</div>)}</div>
                <button onClick={()=>onChangeSettings({seriesRounds: Math.min(10, settings.seriesRounds+1)})} className="w-8 h-8 rounded-full border- border-black bg-white grid place-items-center"><Plus size={14} /></button>
              </div>
              <input type="range" min={2} max={10} step={1} value={settings.seriesRounds} onChange={e=>onChangeSettings({seriesRounds:Number(e.target.value)})} className="w-full" />
              <div className="flex justify-between text-xs font-black opacity-60 mt-1"><span>2 جولات</span><span>10 جولات</span></div>
              <div className="mt-2 text-xs font-bold bg-black text-xswhite rounded-full px-2 py-1 text-xscenter">الأكثر فوزا هو البطل • {settings.seriesRounds%2===0?'تعادل ممكن':'لا يوجد تعادل'}</div>
            </div>
          )}
        </section>
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[18px] p-3">
          <div className="flex items-center justify-between mb-3"><span className="font-black text-xssm">📐 حجم الساحة</span><div className="w-5 h-5 rounded-full border- border-black bg-white grid place-items-center text-xs font-black">2</div></div>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={()=>onChangeSettings({arenaSize:'small'})} className={`h-10 rounded-full border-2 border-black font-black text-smxssm ${settings.arenaSize==='small'?'bg-black text-xswhite':'bg-white'}`}>S</button>
            <button onClick={()=>onChangeSettings({arenaSize:'medium'})} className={`h-10 rounded-full border-2 border-black font-black text-smxssm ${settings.arenaSize==='medium'?'bg-black text-xswhite':'bg-white'}`}>M</button>
            <button onClick={()=>onChangeSettings({arenaSize:'large'})} className={`h-10 rounded-full border-2 border-black font-black text-smxssm ${settings.arenaSize==='large'?'bg-black text-xswhite':'bg-white'}`}>L</button>
            <button onClick={()=>onChangeSettings({arenaSize:'xlarge'})} className={`h-10 rounded-full border-2 border-black font-black text-smxssm ${settings.arenaSize==='xlarge'?'bg-black text-xswhite':'bg-white'}`}>XL</button>
          </div>
        </section>
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[18px] p-3">
          <div className="flex items-center justify-between mb-3"><span className="font-black text-xssm">طريقة الفوز</span><div className="w-5 h-5 rounded-full border- border-black bg-white grid place-items-center text-xs font-black">3</div></div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={()=>onChangeSettings({mode:'time'})} className={`h-10 rounded-full border-2 border-black font-black text-smxssm ${settings.mode==='time'?'bg-black text-xswhite':'bg-white'}`}>⏱ وقت</button>
            <button onClick={()=>onChangeSettings({mode:'goals'})} className={`h-10 rounded-full border-2 border-black font-black text-smxssm ${settings.mode==='goals'?'bg-black text-xswhite':'bg-white'}`}>🎯 أهداف</button>
          </div>
          {settings.mode==='time' ? (
            <div className="animate-[fadeIn_.2s]">
              <div className="flex items-center justify-between bg-white border-2 border-black rounded-full h-10 px-2">
                <button onClick={()=>onChangeSettings({duration: Math.max(30, settings.duration-30)})} className="w-8 h-8 rounded-full border- border-black bg-white grid place-items-center"><Minus size={14} /></button>
                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-black text-xswhite grid place-items-center text-xs">⏱</span><span className="font-black text-xssm bg-black text-xswhite px-3 py-1 rounded-full">{Math.floor(settings.duration/60)}:{String(settings.duration%60).padStart(2,'0')} / 30:00</span></div>
                <button onClick={()=>onChangeSettings({duration: Math.min(1800, settings.duration+30)})} className="w-8 h-8 rounded-full border- border-black bg-white grid place-items-center"><Plus size={14} /></button>
              </div>
              <input type="range" min={30} max={1800} step={30} value={settings.duration} onChange={e=>onChangeSettings({duration:Number(e.target.value)})} className="w-full mt-2" />
              <div className="flex justify-between text-xs font-black opacity-60"><span>30 ثانية</span><span>30 دقيقة</span></div>
            </div>
          ) : (
            <div className="animate-[fadeIn_.2s]">
              <div className="flex items-center justify-between bg-white border-2 border-black rounded-full h-10 px-2">
                <button onClick={()=>onChangeSettings({goal: Math.max(2, settings.goal-1)})} className="w-8 h-8 rounded-full border- border-black bg-white grid place-items-center"><Minus size={14} /></button>
                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-[#ffcf5a] border- border-black grid place-items-center text-xs">🎯</span><span className="font-black text-xssm bg-black text-xswhite px-3 py-1 rounded-full">{settings.goal} / 100</span></div>
                <button onClick={()=>onChangeSettings({goal: Math.min(100, settings.goal+1)})} className="w-8 h-8 rounded-full border- border-black bg-white grid place-items-center"><Plus size={14} /></button>
              </div>
              <input type="range" min={2} max={100} step={1} value={settings.goal} onChange={e=>onChangeSettings({goal:Number(e.target.value)})} className="w-full mt-2" />
              <div className="flex justify-between text-xs font-black opacity-60"><span>2</span><span>100 هدف</span></div>
            </div>
          )}
        </section>
        <div className="grid grid-cols-3 gap-2 w-full box-border">
          <div className="h- rounded-full border- border-black bg-white flex items-center justify-center gap-1 font-black text-xssm box-border"><span className="w-2 h-2 bg-[#ff2d2d] rounded-full" /> كود الغرفة</div>
          <div className="h- rounded-full border- border-black bg-white flex items-center justify-center font-black text-xssm box-border">{settings.ballSpeed} / 20 سرعة</div>
          <div className="h- rounded-full border- border-black bg-white flex items-center justify-center font-black text-xssm box-border">LED طاولة خشب</div>
        </div>
        <button onClick={onCreate} className="h- rounded- border-[2.5px] border-black bg-black text-xs[#f6f0d2] font-black text-xssm active:scale-[0.98] transition w-full box-border">أنشئ غرفة و سرعة {settings.ballSpeed} • 50</button>
        <div className="text-xscenter text-xs font-black opacity-60">طاولة LED - تصميم البطولة</div>
        <div className="h-6" />
      </div>
    </main>
  );
}

function WaitingRoom({ room, players, isHost, error, onBack, onStart, onRefresh }: any) {
  const [copied, setCopied] = useState(false); const { t, i18n } = useTranslation(); const isAr = i18n.language?.startsWith('ar')?? true;
  const copyCode = async () => { try { await navigator.clipboard.writeText(room); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  return (
    <main className="min-h-screen w-full bg-[#e9dfb1] flex justify-center p-3" dir={isAr? 'rtl' : 'ltr'}>
      <div className="w-full max-w-[480px] flex flex-col gap-33">
        <div className="flex justify-between"><Brand /><button onClick={onBack} className="w-9 h-9 rounded-full border-[2.5px] border-black bg-white grid place-items-center"><ArrowLeft size={18} /></button></div>
        <div className="bg-[#fff9dc] border-[2.5px] border-black rounded-[18px] p-34">
          <div className="flex justify-between items-center"><h1 className="font-black text-xssm">الكل جاهز؟</h1><button onClick={copyCode} className="border-[2.5px] border-black rounded-full px-3 h-8 bg-black text-xswhite font-black text-xssm">{room} {copied?'✓':'📋'}</button></div>
          {error && <div className="mt-3 bg-[#ff2d2d] text-xswhite border-[2.5px] border-black rounded- p-2 font-black text-xssm">{error}</div>}
          <div className="mt-3 flex flex-wrap gap-2">{players.map((p:any,i:number)=><span key={p.id} className="px-3 h-8 rounded-full border-[2.5px] border-black bg-white font-black text-xssm flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{background: COLORS[i]}} />{p.name}</span>)}</div>
          <div className="mt-4 flex gap-2"><button onClick={onRefresh} className="flex-1 h- rounded- border-[2.5px] border-black bg-white font-black">تحديث</button>{isHost && <button onClick={onStart} className="flex-1 h- rounded- border-[2.5px] border-black bg-black text-xswhite font-black">ابدأ</button>}</div>
        </div>
      </div>
    </main>
  );
}

function GameScreen({ roomCode, isHost, players, settings, scores, lastGoal, paused, celebrating, seriesWins, currentRound, roundWinner, onGoal, onTimeUp, onPause, onExit }: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const hintDotRef = useRef<HTMLDivElement>(null);
  const hintTextRef = useRef<HTMLDivElement>(null);
  const celebrationCanvasRef = useRef<HTMLCanvasElement>(null);
  const hasDraggedRef = useRef(false);
  const noDragStartRef = useRef(performance.now());
  const controls = useRef({ x: 0, y: 0 });
  const touchControls = useRef({ left: false, right: false, up: false, down: false, bottomLeft: false, bottomRight: false, leftUp: false, leftDown: false });
  const drag = useRef<{ side: Player['side'] | null; x: number; y: number }>({ side: null, x: 500, y: 300 });
  const servingRef = useRef<{ active: boolean; side: Player['side']; startTime: number; requested: boolean }>({ active: settings.start === 'paddle', side: 'bottom', startTime: performance.now(), requested: false });
  const [timeLeft, setTimeLeft] = useState(settings.mode === 'time'? settings.duration : 0);
  const [sound, setSound] = useState(settings.sound);
  const [rally, setRally] = useState(0);
  const [isServing, setIsServing] = useState(settings.start === 'paddle');
  const [countdown, setCountdown] = useState(0);
  const [countdownName, setCountdownName] = useState('');
  const soundRef = useRef(sound);
  const onTimeUpRef = useRef(onTimeUp);
  const onGoalRef = useRef(onGoal);
  const pausedRef = useRef(paused);
  const celebratingRef = useRef(celebrating);
  const gameEndedRef = useRef(false);
  const world = useMemo(() => getArenaWorld(players.length, settings.arenaSize), [players.length, settings.arenaSize]);
  const mySide = useMemo(() => (players.find((p:any)=>p.socketId===socket.id)?.side || 'bottom') as Player['side'], [players]);
  const angleMap: any = { bottom: 0, top: Math.PI, right: Math.PI/2, left: -Math.PI/2 };
  const myAngle = angleMap[mySide]?? 0;
  soundRef.current = sound; onTimeUpRef.current = onTimeUp; onGoalRef.current = onGoal; pausedRef.current = paused;
  useEffect(()=>{ celebratingRef.current = celebrating; },[celebrating]);
  const audioCtxRef = useRef<AudioContext|null>(null);
  const playHit = useCallback((power:number, xPos:number = world.w/2)=>{
    if(!soundRef.current) return;
    try{
      if(!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext||(window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current; if(ctx.state==='suspended') ctx.resume(); const t=ctx.currentTime;
      const o=ctx.createOscillator(), g=ctx.createGain(); o.type='sine'; o.frequency.setValueAtTime(90+power*800,t); o.frequency.exponentialRampToValueAtTime(35,t+0.25); g.gain.setValueAtTime(0.15+power*0.85,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.45); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+0.45);
    }catch{}
  },[world.w]);
  const playGoalSound = useCallback(()=>{
    if(!soundRef.current) return;
    try{
      if(!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext||(window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current; if(ctx.state==='suspended') ctx.resume(); const t = ctx.currentTime;
      const master = ctx.createGain(); master.gain.value = 1.3; master.connect(ctx.destination);
      [261,329,392,523,659].forEach((freq,i)=>{ const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='square'; o.frequency.setValueAtTime(freq,t+i*0.07); g.gain.setValueAtTime(0,t+i*0.07); g.gain.linearRampToValueAtTime(0.9,t+i*0.07+0.01); g.gain.exponentialRampToValueAtTime(0.001,t+i*0.07+0.6); o.connect(g).connect(master); o.start(t+i*0.07); o.stop(t+i*0.07+0.7); });
    }catch{}
  },[]);
  const playCelebrationSound = useCallback(()=>{
    if(!soundRef.current) return;
    try{
      if(!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext||(window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current; if(ctx.state==='suspended') ctx.resume(); const t=ctx.currentTime;
      const master = ctx.createGain(); master.gain.value=1.5; master.connect(ctx.destination);
      // جمهور 8 ثواني
      const bufferSize = ctx.sampleRate*8; const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate); const data = buffer.getChannelData(0);
      for(let i=0;i<bufferSize;i++) data[i]=(Math.random()*2-1)*0.65;
      const crowd = ctx.createBufferSource(); crowd.buffer=buffer;
      const filter = ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=900; filter.Q.value=1;
      const gCrowd=ctx.createGain(); gCrowd.gain.setValueAtTime(0,t); gCrowd.gain.linearRampToValueAtTime(0.95,t+0.25); gCrowd.gain.setValueAtTime(0.95,t+6.8); gCrowd.gain.linearRampToValueAtTime(0,t+8);
      crowd.connect(filter).connect(gCrowd).connect(master); crowd.start(t);
      // تصفير عالي جدا
      const whistle = (delay:number, f1:number, f2:number, vol:number)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='sine';
        o.frequency.setValueAtTime(f1,t+delay); o.frequency.linearRampToValueAtTime(f2,t+delay+0.7);
        g.gain.setValueAtTime(0,t+delay); g.gain.linearRampToValueAtTime(vol,t+delay+0.04); g.gain.exponentialRampToValueAtTime(0.001,t+delay+1.4);
        o.connect(g).connect(master); o.start(t+delay); o.stop(t+delay+1.5);
      };
      whistle(0.1,1800,3800,1.3); whistle(0.9,2200,4200,1.2); whistle(2.3,1600,3500,1.1); whistle(3.5,2000,3900,1.0);
      // بوق احتفالي
      [523,659,783,1046,1318].forEach((freq,i)=>{ const o=ctx.createOscillator(); const g2=ctx.createGain(); o.type='square'; o.frequency.value=freq; g2.gain.setValueAtTime(0,t+i*0.12); g2.gain.linearRampToValueAtTime(0.75,t+i*0.12+0.02); g2.gain.exponentialRampToValueAtTime(0.001,t+i*0.12+0.8); o.connect(g2).connect(master); o.start(t+i*0.12); o.stop(t+i*0.12+0.9); });
    }catch{}
  },[]);
  useEffect(()=>{
    if(!celebrating) return;
    playCelebrationSound();
    const canvas = celebrationCanvasRef.current; if(!canvas) return; const c=canvas.getContext('2d'); if(!c) return;
    const arena = arenaRef.current; if(!arena) return;
    const rect = arena.getBoundingClientRect();
    canvas.width = rect.width*2; canvas.height = rect.height*2;
    (canvas as any).style.width = rect.width+'px'; (canvas as any).style.height = rect.height+'px';
    c.scale(2,2);
    const colorsHue = [45, 350, 165, 195];
    let parts:any[] = Array.from({length:320},()=>({
      x:Math.random()*rect.width, y:Math.random()*-rect.height*0.4,
      vx:(Math.random()-0.5)*7, vy:Math.random()*3+1.2,
      size:Math.random()*6+2.5, rot:Math.random()*360, rotSpeed:(Math.random()-0.5)*9,
      hue: colorsHue[Math.floor(Math.random()*colorsHue.length)] + (Math.random()*25-12),
      alpha:1, shape: Math.floor(Math.random()*3)
    }));
    let start = performance.now(); let raf=0;
    const loop=(now:number)=>{
      const elapsed = now-start;
      if(!celebratingRef.current || elapsed>8000){ c.clearRect(0,0,rect.width,rect.height); return; }
      c.clearRect(0,0,rect.width,rect.height);
      parts.forEach((p:any)=>{
        p.hue = (p.hue + 0.32) % 360;
        p.x+=p.vx; p.y+=p.vy; p.vy+=0.13; p.vx*=0.998; p.rot+=p.rotSpeed;
        p.alpha = elapsed>6200? Math.max(0,1-((elapsed-6200)/1800)) : 1;
        c.save(); c.translate(p.x,p.y); c.rotate(p.rot*Math.PI/180); c.globalAlpha=p.alpha;
        c.fillStyle=`hsl(${p.hue},100%,62%)`; c.shadowColor=`hsl(${p.hue},100%,62%)`; c.shadowBlur=10;
        if(p.shape===0) c.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.65);
        else if(p.shape===1){ c.beginPath(); c.arc(0,0,p.size/2,0,Math.PI*2); c.fill(); }
        else { c.beginPath(); c.moveTo(0,-p.size/2); c.lineTo(p.size/2,p.size/2); c.lineTo(-p.size/2,p.size/2); c.closePath(); c.fill(); }
        c.restore();
        if(p.y>rect.height+40){ p.y=-30; p.x=Math.random()*rect.width; p.vy=Math.random()*3+1.2; }
      });
      raf=requestAnimationFrame(loop);
    };
    raf=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(raf);
  },[celebrating, playCelebrationSound]);
  const requestLaunch = useCallback(() => { if (servingRef.current.active) servingRef.current.requested = true; }, []);
  const getInitialSpeed = useCallback(() => 2.8 + settings.ballSpeed * 0.48, [settings.ballSpeed]);
  const stateRef = useRef({
    ball: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    paddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 },
    targetPaddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 },
    prevPaddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 },
    last: performance.now(), elapsed: 0, rally: 0, speedMult: 1, countdown: 0, countdownStart: 0, countdownSide: null as Player['side'] | null, effects: [] as { x: number; y: number; born: number; color: string; power: number }[]
  });
  const isOfflineMode =!socket.connected || players.length <= 1;
  const getWorldFromClient = useCallback((clientX:number, clientY:number)=>{
    const arena = arenaRef.current; if(!arena) return {x:world.w/2,y:world.h/2};
    const rect = arena.getBoundingClientRect();
    let wx = ((clientX-rect.left)/rect.width)*world.w;
    let wy = ((clientY-rect.top)/rect.height)*world.h;
    const cos = Math.cos(-myAngle); const sin = Math.sin(-myAngle);
    const dx = wx-world.w/2; const dy = wy-world.h/2;
    return { x: dx*cos - dy*sin + world.w/2, y: dx*sin + dy*cos + world.h/2 };
  }, [world, myAngle]);
  useEffect(() => {
    if (isOfflineMode) return;
    if (isHost) {
      const handleInput = (data: { side: Player['side']; x: number; y: number }) => { if (stateRef.current.targetPaddles[data.side]) { stateRef.current.targetPaddles[data.side].x = data.x; stateRef.current.targetPaddles[data.side].y = data.y; } };
      socket.on('paddle-input', handleInput); return () => { socket.off('paddle-input', handleInput); };
    } else {
      const handleState = (serverState: any) => { stateRef.current.ball = serverState.ball; Object.keys(serverState.paddles || {}).forEach((k: any) => { stateRef.current.targetPaddles[k] = serverState.paddles[k]; }); if (serverState.countdown!== undefined) { stateRef.current.countdown = serverState.countdown; if(serverState.countdown>0) setCountdown(serverState.countdown); } };
      socket.on('game-state', handleState); return () => { socket.off('game-state', handleState); };
    }
  }, [isHost, isOfflineMode]);
  useEffect(() => {
    const canvas = canvasRef.current; const arena = arenaRef.current; if (!canvas ||!arena) return; const context = canvas.getContext('2d'); if (!context) return; const state = stateRef.current;
    const launchBall = (fromPaddle = false) => {
      const spd = getInitialSpeed() * (state.speedMult || 1); const ang = fromPaddle? (Math.random() - 0.5) * Math.PI * 0.6 : Math.random() * Math.PI * 2;
      if (fromPaddle) { const side = servingRef.current.side; if (side === 'bottom') { state.ball.vx = Math.sin(ang) * spd; state.ball.vy = -Math.abs(Math.cos(ang) * spd) - 1; } else if (side === 'top') { state.ball.vx = Math.sin(ang) * spd; state.ball.vy = Math.abs(Math.cos(ang) * spd) + 1; } else if (side === 'left') { state.ball.vx = Math.abs(Math.cos(ang) * spd) + 1; state.ball.vy = Math.sin(ang) * spd; } else { state.ball.vx = -Math.abs(Math.cos(ang) * spd) - 1; state.ball.vy = Math.sin(ang) * spd; } } else { state.ball.vx = Math.cos(ang) * spd; state.ball.vy = Math.sin(ang) * spd; if (Math.abs(state.ball.vx) < 2) state.ball.vx = state.ball.vx < 0? -2.5 : 2.5; if (Math.abs(state.ball.vy) < 2) state.ball.vy = state.ball.vy < 0? -2.5 : 2.5; }
    };
    if (isHost) { if (settings.start!== 'paddle') { launchBall(false); servingRef.current.active = false; } else { state.ball.x = state.targetPaddles.bottom.x; state.ball.y = state.targetPaddles.bottom.y - 24; servingRef.current.active = true; servingRef.current.side = 'bottom'; servingRef.current.startTime = performance.now(); servingRef.current.requested = false; } }
    let frame = 0;
    const resize = () => { const ratio = Math.min(window.devicePixelRatio || 1, 2); const rect = arena.getBoundingClientRect(); canvas.width = rect.width * ratio; canvas.height = rect.height * ratio; context.setTransform(canvas.width / world.w, 0, 0, canvas.height / world.h, 0, 0); }; resize(); const observer = new ResizeObserver(resize); observer.observe(arena);
    const needCount = Math.max(2, players.length, settings.players || 2);
    const requiredSides: Player['side'][] = needCount === 2? ['bottom','top'] : needCount === 3? ['bottom','top','right'] : ['bottom','top','right','left'];
    const playerForSide = (side: Player['side']) => players.find((p) => p.side === side)?? ({ id: side, name: side, color: COLORS[SIDES.indexOf(side)], side, computer: side!== 'bottom' } as Player);
    const active = (side: Player['side']) => requiredSides.includes(side);
    const opposite: Record<string, Player['side']> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
    const resetBall = (missedSide?: Player['side']) => {
      const scorerSide = missedSide? opposite[missedSide] : null;
      const scorer = scorerSide? playerForSide(scorerSide) : null;
      state.countdown = 3; state.countdownStart = performance.now(); state.countdownSide = scorerSide as any; setCountdown(3); setCountdownName(scorer? scorer.name : '');
      state.ball.x = world.w / 2; state.ball.y = world.h / 2; state.ball.vx = 0; state.ball.vy = 0; state.rally = 0; setRally(0); state.speedMult = 1; hasDraggedRef.current=false; noDragStartRef.current=performance.now(); if(hintDotRef.current) hintDotRef.current.style.display='none'; if(hintTextRef.current) hintTextRef.current.style.display='none';
    };
    const clamp = (v: number, mn: number, mx: number) => Math.max(mn, Math.min(mx, v));
    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2); state.last = now;
      // احتفال داخل نفس الساحة - لا نوقف اللعبة بل نخليها بطيئة وسلسة
      if (celebratingRef.current) {
        state.ball.x += state.ball.vx * 0.28 * delta;
        state.ball.y += state.ball.vy * 0.28 * delta;
        if (state.ball.x < 30 || state.ball.x > world.w-30) state.ball.vx *= -1;
        if (state.ball.y < 30 || state.ball.y > world.h-30) state.ball.vy *= -1;
        draw(context, state, players, now, false, world, myAngle);
        frame = requestAnimationFrame(tick);
        return;
      }
      if (!pausedRef.current &&!gameEndedRef.current) {
        const myPlayer = players.find(p => p.socketId === socket.id) || players[0];
        const mySideLocal = (myPlayer?.side || 'bottom') as Player['side'];
        const isOffline =!socket.connected || players.length <= 1;
        if (!isHost && drag.current.side === mySideLocal) socket.emit('paddle-input', { code: roomCode, side: mySideLocal, x: drag.current.x, y: drag.current.y });
        if (isHost) {
          state.elapsed += delta / 60;
          if (settings.mode === 'time' && state.elapsed > 1) { state.elapsed = 0; setTimeLeft((time) => { if (time <= 1) { gameEndedRef.current = true; onTimeUpRef.current(); return 0; } return time - 1; }); }
          if (state.countdown > 0) {
            const elapsed = (now - state.countdownStart) / 1000;
            if (elapsed >= 3) {
              state.countdown = 0; setCountdown(0); const side = state.countdownSide;
              if (settings.start === 'paddle' && side) {
                servingRef.current.active = true; servingRef.current.side = side; servingRef.current.startTime = now; servingRef.current.requested = false;
                if (side === 'bottom') { state.ball.x = state.targetPaddles.bottom.x; state.ball.y = state.targetPaddles.bottom.y - 24; }
                else if (side === 'top') { state.ball.x = state.targetPaddles.top.x; state.ball.y = state.targetPaddles.top.y + 24; }
                else if (side === 'left') { state.ball.x = state.targetPaddles.left.x - 24; state.ball.y = state.targetPaddles.left.y; }
                else { state.ball.x = state.targetPaddles.right.x + 24; state.ball.y = state.targetPaddles.right.y; }
                state.ball.vx = 0; state.ball.vy = 0; setIsServing(true);
              } else { launchBall(false); setIsServing(false); servingRef.current.active = false; }
            } else { setCountdown(Math.ceil(3-elapsed)); socket.emit('game-state', { code: roomCode, state: { ball: state.ball, paddles: state.paddles, countdown: state.countdown } }); draw(context, state, players, now, true, world, myAngle); frame = requestAnimationFrame(tick); return; }
          }
          const touch = touchControls.current;
          if (touch.left) controls.current.x = -1; else if (touch.right) controls.current.x = 1; else controls.current.x = 0;
          if (touch.up) controls.current.y = -1; else if (touch.down) controls.current.y = 1; else controls.current.y = 0;
          const bottomInput = touch.bottomLeft? -1 : touch.bottomRight? 1 : 0;
          const predX = state.ball.x + state.ball.vx * 12; const predY = state.ball.y + state.ball.vy * 12;
          if (isOffline) {
            state.targetPaddles.bottom.x = clamp(state.targetPaddles.bottom.x + (controls.current.x + bottomInput) * 9 * delta + (drag.current.side === 'bottom'? (drag.current.x - state.targetPaddles.bottom.x) * 0.18 : 0), 50, world.w - 50);
            state.targetPaddles.bottom.y = clamp(state.targetPaddles.bottom.y + controls.current.y * 7 * delta, world.h - 70 - ZONE, world.h - 40);
            state.targetPaddles.top.x = clamp(predX, 50, world.w - 50);
            state.targetPaddles.right.y = clamp(predY, 50, world.h - 50);
            state.targetPaddles.left.y = clamp(predY, 50, world.h - 50);
            if (drag.current.side === 'bottom' && active('bottom')) { state.targetPaddles.bottom.x = clamp(drag.current.x, 50, world.w - 50); state.targetPaddles.bottom.y = clamp(drag.current.y, world.h - 70 - ZONE, world.h - 40); }
          } else {
            if (drag.current.side) {
              const s = drag.current.side;
              if(s==='bottom'||s==='top'){ state.targetPaddles[s].x = clamp(drag.current.x, 50, world.w - 50); state.targetPaddles[s].y = clamp(drag.current.y, s==='bottom'? world.h - 70 - ZONE : 40, s==='bottom'? world.h-40 : 40+ZONE); }
              else { state.targetPaddles[s].y = clamp(drag.current.y, 50, world.h - 50); state.targetPaddles[s].x = clamp(drag.current.x, s==='left'? 40 : world.w-70-ZONE, s==='left'? 40+ZONE : world.w-40); }
            }
            const pTop = players.find(p => p.side === 'top'); const pRight = players.find(p => p.side === 'right'); const pLeft = players.find(p => p.side === 'left');
            if (pTop?.computer) state.targetPaddles.top.x = clamp(state.targetPaddles.top.x + ai(predX, state.targetPaddles.top.x, settings.difficulty) * 6 * delta, 50, world.w - 50);
            if (pRight?.computer) state.targetPaddles.right.y = clamp(state.targetPaddles.right.y + ai(predY, state.targetPaddles.right.y, settings.difficulty) * 7 * delta, 50, world.h - 50);
            if (pLeft?.computer) state.targetPaddles.left.y = clamp(state.targetPaddles.left.y + ai(predY, state.targetPaddles.left.y, settings.difficulty) * 6 * delta, 50, world.h - 50);
          }
          const lerpFactor = (isHuman: boolean) => isHuman? 0.38 : 0.18;
          const isHumanSide = (side: Player['side']) => { if (isOffline) return side === 'bottom'; const pl = players.find(p => p.side === side); return side === mySideLocal || (pl &&!pl.computer); };
          (['top','bottom','right','left'] as Player['side'][]).forEach(s => { if (!active(s)) return; const f = lerpFactor(isHumanSide(s)) * delta; state.paddles[s].x += (state.targetPaddles[s].x - state.paddles[s].x) * f; state.paddles[s].y += (state.targetPaddles[s].y - state.paddles[s].y) * f; });
          if (servingRef.current.active) {
            const side = servingRef.current.side;
            if (side === 'bottom') { state.ball.x = state.paddles.bottom.x; state.ball.y = state.paddles.bottom.y - 24; } else if (side === 'top') { state.ball.x = state.paddles.top.x; state.ball.y = state.paddles.top.y + 24; } else if (side === 'left') { state.ball.x = state.paddles.left.x - 24; state.ball.y = state.paddles.left.y; } else { state.ball.x = state.paddles.right.x + 24; state.ball.y = state.paddles.right.y; }
            const player = playerForSide(side); if (player?.computer && now - servingRef.current.startTime > 900) servingRef.current.requested = true;
            if (servingRef.current.requested) { launchBall(true); servingRef.current.active = false; servingRef.current.requested = false; setIsServing(false); playHit(0.3, state.ball.x); }
            socket.emit('game-state', { code: roomCode, state: { ball: state.ball, paddles: state.paddles, countdown: state.countdown } }); draw(context, state, players, now, true, world, myAngle); frame = requestAnimationFrame(tick); return;
          }
          state.ball.x += state.ball.vx * delta; state.ball.y += state.ball.vy * delta;
          const r = 12; const PADDLE_R = 21; const HIT_DIST = PADDLE_R + r - 1;
          const prevBottom = state.prevPaddles.bottom; const prevTop = state.prevPaddles.top; const prevLeft = state.prevPaddles.left; const prevRight = state.prevPaddles.right;
          const velBottom: Vec2 = { x: state.paddles.bottom.x - prevBottom.x, y: state.paddles.bottom.y - prevBottom.y };
          const velTop: Vec2 = { x: state.paddles.top.x - prevTop.x, y: state.paddles.top.y - prevTop.y };
          const velLeft: Vec2 = { x: state.paddles.left.x - prevLeft.x, y: state.paddles.left.y - prevLeft.y };
          const velRight: Vec2 = { x: state.paddles.right.x - prevRight.x, y: state.paddles.right.y - prevRight.y };
          const THRUST = 6.0; const BASE_BOOST = 0.8; const PADDLE_POWER = 1.9;
          if (!active('top') && state.ball.y - r < 22) { state.ball.y = 22 + r; state.ball.vy = Math.abs(state.ball.vy) * 1.1; playHit(0.15, state.ball.x); }
          if (!active('bottom') && state.ball.y + r > world.h - 22) { state.ball.y = world.h - 22 - r; state.ball.vy = -Math.abs(state.ball.vy) * 1.1; playHit(0.15, state.ball.x); }
          if (!active('left') && state.ball.x - r < 22) { state.ball.x = 22 + r; state.ball.vx = Math.abs(state.ball.vx) * 1.1; playHit(0.15, state.ball.x); }
          if (!active('right') && state.ball.x + r > world.w - 22) { state.ball.x = world.w - 22 - r; state.ball.vx = -Math.abs(state.ball.vx) * 1.1; playHit(0.15, state.ball.x); }
          const checkHit = (side: Player['side'], vel: Vec2)=>{
            const dx = state.ball.x - state.paddles[side].x; const dy = state.ball.y - state.paddles[side].y; const dist = Math.sqrt(dx*dx+dy*dy);
            if(dist <= HIT_DIST+14 && dist>=0.5){
              const nx = dx/dist; const ny = dy/dist;
              const cur = Math.hypot(state.ball.vx, state.ball.vy) || getInitialSpeed();
              let forward=0; if(side==='bottom') forward=-vel.y; if(side==='top') forward=vel.y; if(side==='left') forward=vel.x; if(side==='right') forward=-vel.x;
              const speed = Math.hypot(vel.x, vel.y);
              const hitPower = Math.min(1, forward*0.12 + speed*0.08 + 0.15);
              const powerMult = forward>0.5? 1+Math.min(forward*0.12,0.7) : 0.85;
              const newSpeed = cur*1.05 + BASE_BOOST + Math.max(0,forward)*THRUST + settings.ballSpeed*0.15;
              state.ball.x = state.paddles[side].x + nx*(HIT_DIST+10); state.ball.y = state.paddles[side].y + ny*(HIT_DIST+10);
              state.speedMult = Math.min(2.8, (state.speedMult||1)*1.14); state.rally++;
              if(side==='top' || side==='bottom'){ state.ball.vx = (dx/PADDLE_R)*6.2 + vel.x*PADDLE_POWER; state.ball.vy = (side==='bottom'? -Math.abs(newSpeed) : Math.abs(newSpeed))*powerMult; }
              else { state.ball.vy = (dy/PADDLE_R)*6.2 + vel.y*PADDLE_POWER; state.ball.vx = (side==='left'? Math.abs(newSpeed) : -Math.abs(newSpeed))*powerMult; }
              playHit(hitPower, state.ball.x); state.effects.push({ x: state.ball.x, y: state.ball.y, born: now, color: COLORS[SIDES.indexOf(side)], power: hitPower });
            }
          };
          if(active('top')) checkHit('top', velTop); if(active('bottom')) checkHit('bottom', velBottom); if(active('left')) checkHit('left', velLeft); if(active('right')) checkHit('right', velRight);
          const maxSpd = 7 + settings.ballSpeed * 0.85 + state.rally * 0.55; state.ball.vx = Math.max(-maxSpd, Math.min(maxSpd, state.ball.vx)); state.ball.vy = Math.max(-maxSpd, Math.min(maxSpd, state.ball.vy));
          state.prevPaddles = { top: { x: state.paddles.top.x, y: state.paddles.top.y }, bottom: { x: state.paddles.bottom.x, y: state.paddles.bottom.y }, left: { x: state.paddles.left.x, y: state.paddles.left.y }, right: { x: state.paddles.right.x, y: state.paddles.right.y }, };
          const GOAL_W = players.length === 2? 260 : 300; const GOAL_X1 = (world.w - GOAL_W) / 2; const GOAL_X2 = GOAL_X1 + GOAL_W; const GOAL_Y1 = (world.h - GOAL_W) / 2; const GOAL_Y2 = GOAL_Y1 + GOAL_W; const inGoalX = (x: number) => x >= GOAL_X1 && x <= GOAL_X2; const inGoalY = (y: number) => y >= GOAL_Y1 && y <= GOAL_Y2; let missed: Player | undefined;
          if (state.ball.y - r < 22) { if (active('top')) { if (inGoalX(state.ball.x)) missed = playerForSide('top'); else { state.ball.y = 22 + r; state.ball.vy = Math.abs(state.ball.vy); playHit(0.15, state.ball.x); } } else { state.ball.y = 22 + r; state.ball.vy = Math.abs(state.ball.vy); } }
          if (!missed && state.ball.y + r > world.h - 22) { if (active('bottom')) { if (inGoalX(state.ball.x)) missed = playerForSide('bottom'); else { state.ball.y = world.h - 22 - r; state.ball.vy = -Math.abs(state.ball.vy); playHit(0.15, state.ball.x); } } else { state.ball.y = world.h - 22 - r; state.ball.vy = -Math.abs(state.ball.vy); } }
          if (!missed && state.ball.x - r < 22) { if (active('left')) { if (inGoalY(state.ball.y)) missed = playerForSide('left'); else { state.ball.x = 22 + r; state.ball.vx = Math.abs(state.ball.vx); playHit(0.15, state.ball.x); } } else { state.ball.x = 22 + r; state.ball.vx = Math.abs(state.ball.vx); } }
          if (!missed && state.ball.x + r > world.w - 22) { if (active('right')) { if (inGoalY(state.ball.y)) missed = playerForSide('right'); else { state.ball.x = world.w - 22 - r; state.ball.vx = -Math.abs(state.ball.vx); playHit(0.15, state.ball.x); } } else { state.ball.x = world.w - 22 - r; state.ball.vx = -Math.abs(state.ball.vx); } }
          if (missed) { state.effects.push({ x: state.ball.x, y: state.ball.y, born: now, color: missed.color, power: 0.9 }); playHit(0.9, state.ball.x); playGoalSound(); onGoalRef.current(playerForSide(missed.side)); resetBall(missed.side); }
          setRally(state.rally); socket.emit('game-state', { code: roomCode, state: { ball: state.ball, paddles: state.paddles, countdown: state.countdown } });
        }
      }
      if(!hasDraggedRef.current && arenaRef.current && hintDotRef.current && hintTextRef.current){
        const elapsed = now - noDragStartRef.current;
        if(elapsed>3000 && state.countdown===0 &&!pausedRef.current &&!celebratingRef.current){
          const myP = state.paddles[mySide];
          const cos = Math.cos(myAngle); const sin = Math.sin(myAngle);
          const dx = myP.x-world.w/2; const dy = myP.y-world.h/2;
          const rx = dx*cos - dy*sin + world.w/2; const ry = dx*sin + dy*cos + world.h/2;
          const rect = arenaRef.current.getBoundingClientRect();
          const sx = (rx/world.w)*rect.width; const sy = (ry/world.h)*rect.height;
          hintDotRef.current.style.left=`${sx}px`; hintDotRef.current.style.top=`${sy+40}px`; hintDotRef.current.style.display='block';
          hintTextRef.current.style.left=`${sx+18}px`; hintTextRef.current.style.top=`${sy+28}px`; hintTextRef.current.style.display='block';
        }
      }
      draw(context, state, players, now, false, world, myAngle); frame = requestAnimationFrame(tick);
    }; frame = requestAnimationFrame(tick); return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [players, settings, getInitialSpeed, isHost, roomCode, mySide, myAngle, playHit, playGoalSound]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (key === ' ' || event.code === 'Space') { if (servingRef.current.active) { servingRef.current.requested = true; event.preventDefault(); } } if (event.key === 'ArrowLeft' || key === 'a') touchControls.current.left = true; if (event.key === 'ArrowRight' || key === 'd') touchControls.current.right = true; if (event.key === 'ArrowUp' || key === 'w') touchControls.current.up = true; if (event.key === 'ArrowDown' || key === 's') touchControls.current.down = true; if (key === 'j') touchControls.current.bottomLeft = true; if (key === 'l') touchControls.current.bottomRight = true; if (key === 'i') touchControls.current.leftUp = true; if (key === 'k') touchControls.current.leftDown = true; };
    const up = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (event.key === 'ArrowLeft' || key === 'a') touchControls.current.left = false; if (event.key === 'ArrowRight' || key === 'd') touchControls.current.right = false; if (event.key === 'ArrowUp' || key === 'w') touchControls.current.up = false; if (event.key === 'ArrowDown' || key === 's') touchControls.current.down = false; if (key === 'j') touchControls.current.bottomLeft = false; if (key === 'l') touchControls.current.bottomRight = false; if (key === 'i') touchControls.current.leftUp = false; if (key === 'k') touchControls.current.leftDown = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const bindTouch = (direction: keyof typeof touchControls.current) => ({ onPointerDown: () => { touchControls.current[direction] = true; }, onPointerUp: () => { touchControls.current[direction] = false; }, onPointerLeave: () => { touchControls.current[direction] = false; } });
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (paused || celebrating) return; if (isServing) { requestLaunch(); return; }
    (event.currentTarget as any).setPointerCapture?.(event.pointerId);
    const pt = getWorldFromClient(event.clientX, event.clientY);
    const isTouch = (event as any).pointerType==='touch'; const OFFSET = isTouch? 180 : 90;
    let tx=pt.x, ty=pt.y; if(mySide==='bottom') ty=pt.y-OFFSET; if(mySide==='top') ty=pt.y+OFFSET; if(mySide==='left') tx=pt.x+OFFSET; if(mySide==='right') tx=pt.x-OFFSET;
    hasDraggedRef.current=true; if(hintDotRef.current) hintDotRef.current.style.display='none'; if(hintTextRef.current) hintTextRef.current.style.display='none';
    drag.current = { side: mySide, x: tx, y: ty };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current.side) return;
    const pt = getWorldFromClient(event.clientX, event.clientY);
    const isTouch = (event as any).pointerType==='touch'; const OFFSET = isTouch? 110 : 50;
    let tx=pt.x, ty=pt.y; if(mySide==='bottom') ty=pt.y-OFFSET; if(mySide==='top') ty=pt.y+OFFSET; if(mySide==='left') tx=pt.x+OFFSET; if(mySide==='right') tx=pt.x-OFFSET;
    drag.current.x = tx; drag.current.y = ty;
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => { if ((event.currentTarget as any).hasPointerCapture?.(event.pointerId)) (event.currentTarget as any).releasePointerCapture(event.pointerId); drag.current.side = null; };

  return (
    <main className="game-shell" dir="ltr" style={{ touchAction: 'none' }} onContextMenu={e => e.preventDefault()}>
      <style>{`
        @keyframes hintPulse{0%{transform:translate(-50%,-50%) scale(1); box-shadow:0 0 0 0 rgba(0,229,255,0.7)}70%{transform:translate(-50%,-50%) scale(1.3); box-shadow:0 0 0 12px rgba(0,229,255,0)}100%{transform:translate(-50%,-50%) scale(1); box-shadow:0 0 0 0 rgba(0,229,255,0)}}
        @keyframes crashShake{0%{transform:translate(0,0)}20%{transform:translate(-1px,1px)}40%{transform:translate(1px,-1px)}60%{transform:translate(-1px,-1px)}80%{transform:translate(1px,1px)}100%{transform:translate(0,0)}}
        @keyframes celePulse{0%{transform:scale(1)}100%{transform:scale(1.08)}}
        @keyframes crashFlash{0%{background:rgba(255,207,90,0)}10%{background:rgba(255,207,90,0.9)}20%{background:rgba(255,255,255,0.8)}30%{background:rgba(255,207,90,0.2)}100%{background:transparent}}
      `}</style>
      <header className="game-topbar"><Brand /><div className="match-meta flex items-center gap-2"><span><i className="live-dot" /></span><b>{settings.mode === 'time'? formatTime(timeLeft) : '∞'}</b> | {mySide}{settings.seriesType==='series' && <span className="bg-[#ffcf5a] text-xsblack border-[1.5px] border-black rounded-full px-2 text-xs font-black">جولة {typeof currentRound!=='undefined'?currentRound:1}/{settings.seriesRounds}</span>}</div><div className="game-actions"><button className="game-icon" onClick={() => setSound((value) =>!value)}><Volume2 size={18} /></button><button className="game-icon" onClick={onPause}>{paused? <Play size={18} /> : <Pause size={18} />}</button><button className="game-icon" onClick={onExit}><X size={18} /></button></div></header>
      <div className="score-strip">{players.map((player) => <div className="score-chip" key={player.id} style={{border: player.side===mySide?`2px solid ${player.color}`:undefined}}><span className="score-color" style={{ background: player.color }} /><span>{player.name}{player.side===mySide?' (أنت)':''}</span><strong>{scores[player.id]?? 0}</strong></div>)}<div className="rally-meter"><span>Rally</span><b>{rally}</b></div></div>
      <section className="arena-stage" style={{ width: '100%', maxWidth: '100vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div className="arena-frame" ref={arenaRef} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} style={{ touchAction: 'none', position:'relative', width: `min(95vw, 760px, ${(88 * (world.w / world.h)).toFixed(2)}vh)`, aspectRatio: `${world.w} / ${world.h}`, margin: '0 auto', borderRadius: '32px', overflow: 'hidden', background: '#000', boxShadow: '0 0 0 2px #111, 0 0 40px rgba(0,229,255,0.25)', }}>
          <canvas ref={canvasRef} style={{ touchAction: 'none', width: '100%', height: '100%' }} />
          <div ref={hintDotRef} style={{position:'absolute', width:'14px', height:'14px', borderRadius:'50%', background:'#00e5ff', border:'2px solid #fff', display:'none', zIndex:20, pointerEvents:'none', animation:'hintPulse 1.2s infinite'}}/>
          <div ref={hintTextRef} style={{position:'absolute', background:'#00e5ff', color:'#000', padding:'6px 12px', borderRadius:999, fontSize:'12px', fontWeight:900, display:'none', zIndex:20, pointerEvents:'none', whiteSpace:'nowrap'}}>👆 حرك المضرب من هنا</div>
          {countdown>0 && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}><span style={{ fontSize: '110px', fontWeight: 900, color: '#ff2233' }}>{countdown}</span><span style={{ background: '#222', color: '#fff', padding: '8px 18px', borderRadius: 999, fontWeight: 800 }}>{countdownName} سجل!</span></div>}
          {lastGoal &&!celebrating && <div style={{ position: 'absolute', top: '48%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,34,51,0.92)', color: '#fff', padding: '12px 22px', borderRadius: 12, fontWeight: 900, zIndex: 11 }}>هدف! {lastGoal}</div>}
          {celebrating && (
            <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 38%, rgba(255,207,90,0.22), rgba(0,0,0,0.88))',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',zIndex:50, animation:'crashShake 0.14s infinite'}}>
              <div style={{position:'absolute',inset:0,animation:'crashFlash 0.5s ease 3',pointerEvents:'none',zIndex:0}}/>
              <canvas ref={celebrationCanvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:1}}/>
              <div style={{position:'relative',zIndex:2,display:'flex',flexDirection:'column',alignItems:'center',gap:14}}>
                <div style={{fontSize:12,color:'#000',background:'#ffcf5a',padding:'7px 16px',borderRadius:999,border:'2px solid #000',fontWeight:900,letterSpacing:1}}>🏆 CRASH CELEBRATION • 8 SEC</div>
                <div style={{fontSize:56,fontWeight:900,color:celebrating.color,textShadow:`0 0 22px ${celebrating.color}, 0 0 50px ${celebrating.color}, 0 2px 0 #000`,textAlign:'center',lineHeight:1.05,animation:'celePulse 0.5s ease infinite alternate'}}>{celebrating.name}<br/><span style={{fontSize:42}}>فاز!</span></div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
                  <div style={{background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,207,90,0.6)',padding:'6px 14px',borderRadius:999,color:'#fff',fontSize:12,fontWeight:700}}>🔊 جمهور + تصفير عالي</div>
                  {settings.seriesType==='series' && roundWinner && <div style={{background:'#ffcf5a',color:'#000',padding:'6px 14px',borderRadius:999,fontWeight:900,fontSize:12,border:'2px solid #000'}}>جولة {currentRound}/{settings.seriesRounds} • {seriesWins[celebrating.id]??0} فوز - كراش</div>}
                </div>
                <div style={{marginTop:4,display:'flex',gap:4}}>{Array.from({length:8},(_,i)=><div key={i} style={{width:22,height:6,borderRadius:999,background:celebrating.color,opacity:0.9-(i*0.1),animation:`celePulse ${0.3+i*0.05}s infinite alternate`}}/>)}</div>
              </div>
            </div>
          )}
        </div>
      </section>
      <div className="touch-controls"><button {...bindTouch('bottomRight')}><ChevronRight size={24} /></button><button {...bindTouch('bottomLeft')}><ChevronLeft size={24} /></button></div>
    </main>
  );
}

function ai(ball: number, paddle: number, difficulty: Difficulty) {
  const maxFactor = difficulty === 'easy'? 0.85 : difficulty === 'normal'? 1.45 : 2.15; const diff = ball - paddle; const dead = 4; if (Math.abs(diff) < dead) return 0; const proportional = diff * 0.15; return Math.max(-maxFactor, Math.min(maxFactor, proportional));
}
function getColoredPaddle(color: string, size: number = 42): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = size; c.height = size; const ctx = c.getContext('2d')!;
  ctx.shadowColor = color; ctx.shadowBlur = 20; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const grad = ctx.createRadialGradient(size * 0.38, size * 0.38, size * 0.05, size / 2, size / 2, size * 0.32);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.2, color); grad.addColorStop(1, color); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(size / 2, size / 0.52, size * 0.30, 0, Math.PI * 2); ctx.fill();
  return c;
}
function draw(context: CanvasRenderingContext2D, state: any, players: Player[], now: number, isServing: boolean, world = RECTANGULAR_WORLD, myAngle=0) {
  const canvas = context.canvas as HTMLCanvasElement; const sx = canvas.width / world.w; const sy = canvas.height / world.h;
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height); context.restore();
  context.save(); context.translate(world.w/2, world.h/2); context.rotate(myAngle); context.translate(-world.w/2, -world.h/2);
  const outerRadius = 36; const borderOuter = 32; const borderInner = 14; const countdown = (state as any).countdown || 0;
  context.fillStyle = '#000000'; context.fillRect(0, 0, world.w, world.h);
  const rr = (x: number, y: number, w: number, h: number, r: number) => { context.beginPath(); context.moveTo(x + r, y); context.lineTo(x + w - r, y); context.quadraticCurveTo(x + w, y, x + w, y + r); context.lineTo(x + w, y + h - r); context.quadraticCurveTo(x + w, y + h, x + w - r, y + h); context.lineTo(x + r, y + h); context.quadraticCurveTo(x, y + h, x, y + h - r); context.lineTo(x, y + r); context.quadraticCurveTo(x, y, x + r, y); context.closePath(); };
  context.fillStyle = '#0c0c0c'; rr(0, 0, world.w, world.h, outerRadius); context.fill();
  const ledX = borderOuter - 6; const ledY = borderOuter - 6; const ledW = world.w - (borderOuter - 6) * 2; const ledH = world.h - (borderOuter - 6) * 2; const ledR = outerRadius - 10;
  let ledGrad: CanvasGradient;
  if (typeof (context as any).createConicGradient === 'function') { ledGrad = (context as any).createConicGradient(-Math.PI * 0.78, world.w / 2, world.h / 2); ledGrad.addColorStop(0.00, '#00e5ff'); ledGrad.addColorStop(0.20, '#7c4dff'); ledGrad.addColorStop(0.40, '#ff2d78'); ledGrad.addColorStop(0.60, '#ff7a28'); ledGrad.addColorStop(0.80, '#ffcf5a'); ledGrad.addColorStop(1.00, '#00e5ff'); } else { ledGrad = context.createLinearGradient(ledX, ledY, ledX + ledW, ledY + ledH); ledGrad.addColorStop(0, '#00e5ff'); ledGrad.addColorStop(0.5, '#ff2d78'); ledGrad.addColorStop(1, '#ff8a2a'); }
  context.save(); context.shadowBlur = 35; context.shadowColor = '#00e5ff'; context.strokeStyle = ledGrad; context.lineWidth = 12; context.lineCap = 'round'; rr(ledX, ledY, ledW, ledH, ledR); context.stroke(); context.restore();
  context.strokeStyle = 'rgba(255,255,255,0.95)'; context.lineWidth = 4; rr(ledX, ledY, ledW, ledH, ledR); context.stroke();
  const innerX = borderOuter + borderInner; const innerY = borderOuter + borderInner; const innerW = world.w - (borderOuter + borderInner) * 2; const innerH = world.h - (borderOuter + borderInner) * 2; const innerR = outerRadius - 18;
  context.fillStyle = '#f3f5f7'; rr(innerX, innerY, innerW, innerH, innerR); context.fill();
  const colors = Object.fromEntries(players.map((player) => [player.side, player.color]));
  const active = (side: Player['side']) => { if (players.some((player) => player.side === side)) return true; const count = Math.max(2, players.length || 2); const req = count === 2 ? ['bottom','top'] : count === 3 ? ['bottom','top','right'] : ['bottom','top','right','left']; return (req as string[]).includes(side); };
  const GOAL_W = players.length === 2? 260 : 300; const GX1 = (world.w - GOAL_W) / 2; const GY1 = (world.h - GOAL_W) / 2;
  const drawGoal = (x: number, y: number, w: number, h: number, col: string) => { context.fillStyle = '#000000'; context.fillRect(x, y, w, h); context.fillStyle = col + '33'; context.fillRect(x, y, w, h); context.strokeStyle = col; context.lineWidth = 2.5; context.shadowColor = col; context.shadowBlur = 12; context.strokeRect(x, y, w, h); context.shadowBlur = 0; };
  if (active('top')) drawGoal(GX1, 0, GOAL_W, borderOuter + 2, colors.top?? COLORS[1]); if (active('bottom')) drawGoal(GX1, world.h - (borderOuter + 2), GOAL_W, borderOuter + 2, colors.bottom?? COLORS[0]); if (active('left')) drawGoal(0, GY1, borderOuter + 2, GOAL_W, colors.left?? COLORS[3]); if (active('right')) drawGoal(world.w - (borderOuter + 2), GY1, borderOuter + 2, GOAL_W, colors.right?? COLORS[2]);
  const drawHatPaddle = (x: number, y: number, color: string) => { const size = PADDLE_SIZE; context.save(); const clampedX = Math.max(innerX + size / 2, Math.min(innerX + innerW - size / 2, x)); const clampedY = Math.max(innerY + size / 2, Math.min(innerY + innerH - size / 2, y)); context.translate(clampedX, clampedY); context.shadowColor = color; context.shadowBlur = 20; const img = getColoredPaddle(color, size); context.drawImage(img, -size / 2, -size / 2, size, size); context.restore(); };
  if (active('top')) drawHatPaddle(state.paddles.top.x, state.paddles.top.y, colors.top?? COLORS[1]); if (active('bottom')) drawHatPaddle(state.paddles.bottom.x, state.paddles.bottom.y, colors.bottom?? COLORS[0]); if (active('left')) drawHatPaddle(state.paddles.left.x, state.paddles.left.y, colors.left?? COLORS[3]); if (active('right')) drawHatPaddle(state.paddles.right.x, state.paddles.right.y, colors.right?? COLORS[2]);
  if (countdown > 0) { context.save(); context.fillStyle = 'rgba(0,0,0,0.78)'; context.fillRect(0, 0, world.w, world.h); context.fillStyle = '#ff2233'; context.font = 'bold 120px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.shadowColor = '#ff2233'; context.shadowBlur = 28; context.fillText(String(countdown), world.w / 2, world.h / 2); context.shadowBlur = 0; context.restore(); }
  const screenRadius = 11 * Math.min(sx, sy); const rx = screenRadius / sx; const ry = screenRadius / sy;
  context.save(); context.shadowColor = '#ff1a2e'; context.shadowBlur = isServing? 32 : 22; context.fillStyle = '#ff2233'; context.beginPath(); context.ellipse(state.ball.x, state.ball.y, rx, ry, 0, 0, Math.PI * 2); context.fill(); context.restore();
  state.effects = state.effects.filter((effect) => now - effect.born < 900);
  state.effects.forEach((effect: any) => { const progress = (now - effect.born) / 900; const erx = (16 + progress * 58); const ery = (16 + progress * 58) * sx / sy; context.save(); context.globalAlpha = 1 - progress; context.strokeStyle = effect.color; context.lineWidth = 3; context.beginPath(); context.ellipse(effect.x, effect.y, erx, ery, 0, 0, Math.PI * 2); context.stroke(); context.restore(); });
  context.restore();
}
function formatTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }

function ResultsScreen({ players, scores, winner, wins, seriesWins, currentRound, settings, onAgain, onHome }: any) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar')?? true;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showFire, setShowFire] = useState(true);
  const sortedCurrent = [...players].sort((a:any,b:any)=>(scores[b.id]??0)-(scores[a.id]??0));
  const sortedAllTime = Object.entries(wins as Record<string,number>).sort((a:any,b:any)=>b[1]-a[1]).slice(0,20);
  useEffect(()=>{
    const canvas = canvasRef.current; if(!canvas) return; const c = canvas.getContext('2d'); if(!c) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const colors = ['#ffcf5a','#ff6b8b','#61e7c2','#00e5ff','#ff2d78','#ffffff'];
    let particles:any[] = Array.from({length:180},()=>({x:Math.random()*canvas.width, y:Math.random()*-canvas.height, vx:(Math.random()-0.5)*6, vy:Math.random()*6+3, color:colors[Math.floor(Math.random()*colors.length)], size:Math.random()*4+2}));
    let raf=0; const start=performance.now();
    const loop = (now:number)=>{ if(now-start>5000){ setShowFire(false); return; } c.clearRect(0,0,canvas.width,canvas.height); particles.forEach((p:any)=>{ p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; c.fillStyle=p.color; c.beginPath(); c.arc(p.x,p.y,p.size,0,Math.PI*2); c.fill(); if(p.y>canvas.height){ p.y=-20; p.x=Math.random()*canvas.width; } }); raf=requestAnimationFrame(loop); };
    raf=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(raf);
  },[]);
  return (
    <main className="app-shell results-shell" dir={isAr? 'rtl' : 'ltr'} style={{position:'relative',overflow:'hidden'}}>
      <style>{`@keyframes flash {0%{background:rgba(255,255,255,0)}10%{background:rgba(255,255,255,0.9)}20%{background:rgba(255,207,90,0.6)}30%{background:transparent}100%{background:transparent}}`}</style>
      {showFire&&<><div style={{position:'fixed',inset:0,animation:'flash 0.6s ease 2',pointerEvents:'none',zIndex:20}}/><canvas ref={canvasRef} style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:15}}/></>}
      <header className="topbar"><Brand /></header>
      <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap:16, padding: 16, minHeight:'100%', position:'relative', zIndex:10 }}>
        <div style={{ background: '#111', padding: 24, borderRadius: 24, textAlign: 'center', border: '2px solid #ffcf5a', width: '100%', maxWidth: 460, boxShadow: showFire?'0 0 40px #ffcf5a':'' }}>
          <h1 style={{ color: '#ffcf5a', fontSize: '2.2rem', marginBottom: 8 }}>
            {settings?.seriesType==='series' ? (
              winner ? `🏆 ${winner.name} بطل السلسلة!` : '🤝 تعادل السلسلة!'
            ) : (
              winner? `🏆 ${winner.name} ${isAr? 'فاز!' : 'Wins!'}` : (isAr? 'انتهت' : 'Game Over')
            )}
          </h1>
          {settings?.seriesType==='series' && seriesWins && (
            <div style={{background:'#000',border:'1.5px solid #ffcf5a',borderRadius:12,padding:10,marginBottom:12}}>
              <div style={{color:'#ffcf5a',fontWeight:900,fontSize:12,marginBottom:6}}>نتيجة الجولات {Object.values(seriesWins as any).reduce((a:any,b:any)=>a+b,0)}/{settings.seriesRounds} • كراش</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'center'}}>
                {players.map((p:any)=><div key={p.id} style={{background: p.id===winner?.id?'#2a2200':'#111',border:`1px solid ${p.color}`,borderRadius:8,padding:'6px 10px',display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:p.color}}/><span style={{color:'#fff',fontSize:12}}>{p.name}</span><b style={{color:p.color}}>{(seriesWins as any)[p.id]??0}</b></div>)}
              </div>
              {!winner && <div style={{marginTop:8,color:'#fff',fontSize:11,background:'#222',borderRadius:999,padding:'4px 10px',display:'inline-block'}}>تعادل {Object.values(seriesWins as any).join('-')} • أعد الجولات</div>}
            </div>
          )}
          <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:16}}>
            <b style={{color:'#fff'}}>{isAr?'ترتيب هذه المباراة':'This Match Ranking'}</b>
            {sortedCurrent.map((p:any, idx:number)=>(
              <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background: idx===0?'#2a2200':'#0a0a0a',border:`1px solid ${p.color}`,borderRadius:10,padding:'10px 12px'}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontWeight:900,width:20}}>{idx+1}</span><span style={{width:10,height:10,borderRadius:'50%',background:p.color}}/><span style={{color:'#fff',fontWeight:700}}>{p.name}</span>{winner?.id===p.id&&<span>👑</span>}</div>
                <strong style={{color:p.color,fontSize:18}}>{scores[p.id]??0}</strong>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:10,marginTop:18}}>
            <button className="primary-cta" onClick={onAgain} style={{ flex: 1 }}>{isAr? 'مرة أخرى' : 'Again'}</button>
            <button className="secondary-btn" onClick={onHome} style={{ flex: 1 }}>{isAr? 'الرئيسية' : 'Home'}</button>
          </div>
        </div>
        <div style={{ background: '#0a0a0a', border:'1px solid #222', borderRadius:16, padding:16, width:'100%', maxWidth:460 }}>
          <b style={{color:'#00e5ff'}}>📊 {isAr?'ترتيب الفائزين المحفوظ':'All-Time Leaderboard'}</b>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:10}}>
            {sortedAllTime.length===0&&<span style={{color:'#666'}}>{isAr?'لا يوجد فائزين بعد':'No winners yet'}</span>}
            {sortedAllTime.map(([name,count]:any, idx:number)=>(
              <div key={name} style={{display:'flex',justifyContent:'space-between',background:'#111',borderRadius:8,padding:'8px 12px'}}>
                <span style={{color:'#fff'}}>{idx+1}. {name}</span><b style={{color:'#ffcf5a'}}>{count} {isAr?'فوز':'wins'}</b>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
