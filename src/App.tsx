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

const ARENA_SCALES: Record<ArenaSize, number> = { small: 0.85, medium: 1.05, large: 1.7, xlarge: 2.2 }; // L-XL أكبر بكثير - 7
const COLORS = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
const SIDES: Player['side'][] = ['bottom', 'top', 'right', 'left'];
const RECTANGULAR_WORLD = { w: 700, h: 1050 };
const SQUARE_WORLD = { w: 1000, h: 1000 };
const ZONE = 100;
const PADDLE_MOVE_ZONE = 220;
const PADDLE_SIZE = 42;
const defaultSettings = { players: 2, vsComputer: true, difficulty: 'normal', start: 'center', mode: 'time', duration: 180, goal: 7, speed: 'never_reset', ballSpeed: 10, sound: true, graphics: '2d', arenaSize: 'medium', seriesType: 'single', seriesRounds: 3 } as Settings;

function randomRoom(existing: string[] = []) {
  // 6 أرقام مختلفة فقط - بدون تكرار
  let code = '';
  do {
    const digits = ['0','1','2','3','4','5','6','7','8','9'];
    // خلط الأرقام وأخذ 6 مختلفة
    for (let i = digits.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [digits[i], digits[j]] = [digits[j], digits[i]];
    }
    code = digits.slice(0, 6).join('');
    // تأكد أول رقم ليس صفر لسهولة القراءة
    if (code[0] === '0') {
      code = code.slice(1) + code[0];
    }
  } while (existing.includes(code));
  return code;
}
function loadWins(): Record<string, number> { try { return JSON.parse(localStorage.getItem('qoud-ping-pong-wins')?? '{}') as Record<string, number>; } catch { return {}; } }

function getArenaWorld(playersCount: number, arenaSize: ArenaSize = 'medium') {
  const baseWorld = playersCount >= 3? SQUARE_WORLD : RECTANGULAR_WORLD;
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
  const [isConnectingRoom, setIsConnectingRoom] = useState(false);
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
  useEffect(() => {
    void fetch('/health').catch(() => {});
    void fetch('/api/rooms').then(r => r.ok? r.json() : null).then((d: any) => { if (d?.count!== undefined) setRoomsCount(d.count); }).catch(() => {});
  }, []);

useEffect(() => {
  const onRoomUpdate = (roomData: RoomData) => {
    setRoom(prev => roomData.code || prev || roomRef.current);
    if (screenRef.current!== 'game' && roomData.players?.length > 0) setPlayers(roomData.players);
    if (roomData.settings && screenRef.current!== 'game') setSettings((current) => ({...current,...roomData.settings }));
    if (roomData.hostSocketId) setIsHost(roomData.hostSocketId === socket.id);
    if (roomData.status === 'playing' && screenRef.current === 'waiting') { setWinner(null); setLastGoal(null); setMatchPaused(false); setCelebrating(null); setMatchKey((k) => k + 1); setScreen('game'); }
    if ((roomData as any).series) {
      const s = (roomData as any).series;
      if (s.seriesWins) setSeriesWins(s.seriesWins);
      if (s.currentRound) setCurrentRound(s.currentRound);
    }
  };
  const onGameStarted = () => { 
    setWinner(null); 
    setLastGoal(null); 
    setMatchPaused(false); 
    setCelebrating(null); 
    setMatchKey((k) => k + 1); 
    setScreen('game'); 
  };
  const onMatchFinished = ({ winnerId, scores: serverScores, seriesWins: sWins }: any) => {
    setScores(serverScores);
    if (sWins) setSeriesWins(sWins);
    if (!winnerId && sWins) {
      setWinner(null);
      setScreen('results');
      setCelebrating(null);
      setMatchPaused(false);
      return;
    }
    if (celebratingRef.current) {
      setWinner(playersRef.current.find((p) => p.id === winnerId)?? celebratingRef.current); 
      setScreen('results'); 
      setCelebrating(null); 
      setMatchPaused(false);
    } else {
      setWinner(playersRef.current.find((p) => p.id === winnerId)?? null); 
      setScreen('results');
    }
  };
  const onGoalScored = ({ scores: serverScores, missedSide }: any) => {
    if (!socket.connected) return;
    setScores(serverScores);
    const missed = playersRef.current.find((p) => p.side === missedSide);
    if (missed) { 
      setLastGoal(missed.name); 
      window.setTimeout(() => setLastGoal(null), 1300); 
    }
  };
  const onRoundFinished = (data:any) => {
    setSeriesWins(data.seriesWins);
    setCurrentRound(data.currentRound);
    setScores(data.scores);
    const w = data.winnerId ? playersRef.current.find(p=>String(p.id)===String(data.winnerId)) : null;
    if(w) { 
      setRoundWinner(w); 
      setCelebrating(w); 
      setTimeout(() => { setCelebrating(null); }, 5000);
    } else {
      setLastGoal(isArRef.current ? 'تعادل في الجولة!' : 'Round Draw!');
      setTimeout(()=>setLastGoal(null), 2000);
      setCelebrating({ id: 'draw', name: isArRef.current ? 'تعادل' : 'Draw', color: '#fff', side: 'bottom', computer: false } as any);
      setTimeout(()=>{ setCelebrating(null); }, 5000);
    }
  };
  const onNextRound = (data:any) => {
    setCurrentRound(data.currentRound);
    setSeriesWins(data.seriesWins);
    setScores(Object.fromEntries(playersRef.current.map(p => [p.id, 0])));
    setCelebrating(null);
    celebratingRef.current = null;
    setRoundWinner(null);
    setLastGoal(null);
    setMatchKey(k=>k+1);
  };
  const onSeriesStarted = (data:any) => {
    setCurrentRound(data.currentRound);
    setSeriesWins({});
  };
  const onError = (msg: string) => setError(msg);
  const onLost = () => { 
    setError(isArRef.current? 'انقطع الاتصال بالخادم' : 'Connection lost'); 
    setScreen('setup'); 
    setPlayers([]); 
  };
  const onHostLeft = () => { 
    setError(isArRef.current? 'منشئ الغرفة غادر' : 'Host left'); 
    setScreen('setup'); 
  };
  socket.on('room-update', onRoomUpdate);
  socket.on('game-started', onGameStarted);
  socket.on('match-finished', onMatchFinished);
  socket.on('goal-scored', onGoalScored);
  socket.on('round-finished', onRoundFinished);
  socket.on('next-round', onNextRound);
  socket.on('series-started', onSeriesStarted);
  socket.on('error', onError);
  socket.on('connection-lost', onLost);
  socket.on('host-left', onHostLeft);
  return () => {
    socket.off('room-update', onRoomUpdate);
    socket.off('game-started', onGameStarted);
    socket.off('match-finished', onMatchFinished);
    socket.off('goal-scored', onGoalScored);
    socket.off('round-finished', onRoundFinished);
    socket.off('next-round', onNextRound);
    socket.off('series-started', onSeriesStarted);
    socket.off('error', onError);
    socket.off('connection-lost', onLost);
    socket.off('host-left', onHostLeft);
  };
}, []);
  useEffect(() => {
    const onConnect = () => setIsConnectingRoom(false);
    const onDisconnect = () => {};
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = {...current,...patch };
      if (patch.vsComputer!== undefined) setComputers([false, patch.vsComputer, patch.vsComputer, patch.vsComputer]);
      return next;
    });
  };
  const makePlayers = useCallback(() => {
    const requested = settings.players;
    const total = requested === 3? 4 : requested;
    return Array.from({ length: total }, (_, index) => ({
      id: String(index),
      name: names[index]?.trim() || `لاعب ${index + 1}`,
      color: COLORS[index],
      side: SIDES[index],
      computer: index === 0? false : (requested === 3 && index === 3? true : (index >= requested? true : computers[index])),
    }));
  }, [names, settings.players, computers]);

  const enterWaiting = async () => {
    const trimmed = names.slice(0, settings.players).map(n => n.trim());
    if (trimmed.some(n => n.length < 2)) { setError(isAr? 'اكتب اسم كل اللاعبين حرفين على الأقل' : 'Names must be at least 2 chars'); return; }
    if (new Set(trimmed).size!== trimmed.length) { setError(isAr? 'الاسماء لازم مختلفة' : 'Names must be unique'); return; }
    localStorage.setItem('qoud-ping-pong-settings', JSON.stringify(settings));
    const allPlayers = makePlayers();
    setIsConnectingRoom(true);
    try {
      const roomCode = randomRoom();
      const colyseusRoom = await colyseus.create('qoud', { code: roomCode, maxPlayers: allPlayers.length, settings, player: allPlayers[0], computerPlayers: allPlayers.slice(1).filter(p=>p.computer), name: allPlayers[0].name, });
      socket.attach(colyseusRoom); setRoom(roomCode); setIsHost(true); setError(''); setScreen('waiting');
    } catch (cause) { setError(cause instanceof Error? cause.message : (isAr? 'تعذر انشاء الغرفة' : 'Could not create room')); }
    finally { setIsConnectingRoom(false); }
  };
  const joinByCode = async (customName?: string) => {
    const code = joinCode.replace(/[^0-9]/g, '').slice(0, 6);
    if (code.length!== 6) { setError(isAr? 'الكود 6 أرقام مختلفة' : 'Code 6 different digits'); return; }
    // تحقق أن الأرقام مختلفة
    if (new Set(code.split('')).size !== 6) { setError(isAr? 'الأرقام يجب أن تكون مختلفة' : 'Digits must be different'); return; }
    const finalName = (customName || joinName || localStorage.getItem('qoud_name') || names[0] || 'لاعب').trim().slice(0, 15);
    if (finalName.length < 2) { setError(isAr? 'اكتب اسمك أولاً' : 'Write your name first'); return; }
    localStorage.setItem('qoud_name', finalName);
    setIsConnectingRoom(true);
    try {
      const lookup = await fetch(`/api/rooms?code=${encodeURIComponent(code)}`);
      if (!lookup.ok) throw new Error(isAr? 'الغرفة غير موجودة' : 'Room not found');
      const { roomId } = await lookup.json() as { roomId: string };
      const colyseusRoom = await colyseus.joinById(roomId, { name: finalName });
      socket.attach(colyseusRoom); setRoom(code); setIsHost(false); setError(''); setScreen('waiting');
    } catch (cause) { setError(cause instanceof Error? cause.message : 'تعذر الانضمام'); }
    finally { setIsConnectingRoom(false); }
  };
  const leaveWaiting = () => { void socket.leave(); setPlayers([]); setError(''); setScreen('setup'); };
  const leaveMatch = useCallback(() => { void socket.leave(); setPlayers([]); setScreen('setup'); setMatchPaused(false); setCelebrating(null); }, []);

  const finishMatch = useCallback((champion: Player) => {
    if (celebratingRef.current) return;
    if (settingsRef.current?.seriesType === 'series' || (settings as any).seriesType === 'series') {
      const totalRounds = (settingsRef.current?.seriesRounds ?? settings.seriesRounds ?? 3);
      setCelebrating(champion);
      celebratingRef.current = champion;
      setRoundWinner(champion);
      setSeriesWins((prev) => {
        const upd = {...prev, [champion.id]: (prev[champion.id]??0)+1 };
        const nextRound = currentRoundRef.current;
        if (nextRound >= totalRounds) {
          setTimeout(() => {
            const sorted = Object.entries(upd).sort((a,b)=>b[1]-a[1]);
            const maxWins = sorted[0]?.[1] ?? 0;
            const topWinners = sorted.filter(([,v])=>v===maxWins);
            if (topWinners.length > 1) {
              setWinner(null);
              setWins((cur) => cur);
            } else {
              const overallWinnerId = sorted[0]?.[0];
           const overallWinner = playersRef.current.find(p=>String(p?.id)===String(overallWinnerId)) ?? champion ?? playersRef.current[0];
              setWinner(overallWinner);
              setWins((current) => {
                const key = overallWinner?.name ?? champion?.name ?? 'لاعب';
                const updated = { ...current, [key]: (current[key] ?? 0) + 1 };
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
    setCelebrating(champion);
    celebratingRef.current = champion;
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
    const canStart = isHost || playersRef.current.length <= 1 || !socket.connected;
    if (!canStart) { setError(isArRef.current ? 'المنشئ هو من يبدأ الجولة' : 'Only the host can start'); return; }
    const isOffline = !socket.connected;
    const currentPlayers = isOffline ? makePlayers() : (playersRef.current.length > 0 ? playersRef.current : makePlayers());
    if (socket.connected) socket.emit('start-game', { code: roomRef.current });
    setPlayers(currentPlayers); 
    setScores(Object.fromEntries(currentPlayers.map(p => [p.id, 0]))); 
    setWinner(null); setLastGoal(null); setMatchPaused(false); setCelebrating(null); 
    celebratingRef.current = null; setSeriesWins({}); setCurrentRound(1); setRoundWinner(null); 
    setMatchKey((key) => key + 1); setScreen('game');
}, [isHost, makePlayers, settings.players]);

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
      return <GameScreen3D key={matchKey} roomCode={room} isHost={isHost} players={players} settings={settings} scores={scores} lastGoal={lastGoal} paused={matchPaused} celebrating={celebrating} seriesWins={seriesWins} currentRound={currentRound} onGoal={goalScored} onTimeUp={() => {const top = [...players].filter(Boolean).sort((a, b) => (scores[b?.id]?? 0) - (scores[a?.id]?? 0))[0]; if (top) finishMatch(top); }} onPause={() => setMatchPaused((p:any)=>!p)} onExit={leaveMatch} />;
    }
    return <GameScreen key={matchKey} roomCode={room} isHost={isHost} players={players} settings={settings} scores={scores} lastGoal={lastGoal} paused={matchPaused} celebrating={celebrating} seriesWins={seriesWins} currentRound={currentRound} roundWinner={roundWinner} onGoal={goalScored} onTimeUp={() => { const top = [...players].sort((a, b) => (scores[b.id]?? 0) - (scores[a.id]?? 0))[0]; if (top) finishMatch(top); }} onPause={() => setMatchPaused((p:any)=>!p)} onExit={leaveMatch} />;
  }
  if (screen === 'results') {
    return <ResultsScreen players={players} scores={scores} winner={winner} wins={wins} seriesWins={seriesWins} currentRound={currentRound} settings={settings} onAgain={startMatch} onHome={() => { void socket.leave(); setPlayers([]); setScreen('setup'); setSeriesWins({}); setCurrentRound(1); }} />;
  }
  return <SetupScreen settings={settings} names={names} roomsCount={roomsCount} joinCode={joinCode} joinName={joinName} setJoinName={setJoinName} computers={computers} error={error} isConnectingRoom={isConnectingRoom} onChangeName={(index: number, value: string) => setNames((current) => current.map((name, item) => item === index? value : name))} onChangeSettings={updateSettings} onToggleComputer={(idx: number) => { if (idx === 0) return; setComputers(prev => prev.map((c, i) => i === idx?!c : c)); }} onJoinCodeChange={setJoinCode} onJoin={joinByCode} onCreate={enterWaiting} />;
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-9 h-9 bg-black text-[#f6f0d2] border-[2.5px] border-black rounded-[10px] grid place-items-center font-black text-[14px]">Q</div>
      <div className="leading-none"><div className="font-black text-[13px] tracking-tight">QOUD</div><div className="text-[10px] font-bold -mt-[2px] opacity-60">LED TABLE • 42px</div></div>
    </div>
  );
}

function SetupScreen({ settings, names, roomsCount, joinCode, joinName, setJoinName, computers, error, onChangeName, onChangeSettings, onToggleComputer, onJoinCodeChange, onJoin, onCreate }: any) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar')?? true;
  const [showJoinOnly, setShowJoinOnly] = useState(false);
  return (
    <main className="min-h-screen w-full bg-[#e9dfb1] text-black flex justify-center py-4 px-3" dir={isAr? 'rtl' : 'ltr'}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@600;700&family=Space+Grotesk:wght@600;700&display=swap');
        *{font-family: ${isAr? "'IBM Plex Sans Arabic', system-ui" : "'Space Grotesk', system-ui"} !important;}
        input[type=range]{-webkit-appearance:none; appearance:none; height:32px; background:transparent;}
        input[type=range]::-webkit-slider-runnable-track{height:14px; background:#fff; border:2.5px solid #000; border-radius:999px;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none; width:26px; height:26px; margin-top:-9px; background:#000; border:2px solid #000; border-radius:50%; box-shadow:0 0 0 2px #fff inset; cursor:pointer;}
        @keyframes fadeIn{from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:translateY(0)}}
      `}</style>
      <div className="w-full max-w-[480px] flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <button onClick={() => i18n.changeLanguage(isAr? 'en' : 'ar')} className="h-8 px-3 rounded-full border-[2px] border-black bg-white font-black text-[12px] leading-none">EN</button>
            <span className="h-8 px-3 rounded-full border-[2px] border-black bg-white font-black text-[12px] flex items-center gap-1.5 leading-none"><span className="w-2 h-2 bg-[#ff2d2d] rounded-full animate-pulse" />{roomsCount} غرفة</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-8 px-3 rounded-full border-[2px] border-black bg-black text-white font-black text-[11px] flex items-center leading-none tracking-wide">LED TABLE • 42px</span>
            <Brand />
          </div>
        </div>

        {/* شاشة الانضمام فقط - تظهر عند الضغط على زر الانضمام العريض */}
        {showJoinOnly ? (
          <>
            <div className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-4 text-center">
              <div className="text-[11px] font-black tracking-[0.18em] opacity-50 mb-1.5">انضم لغرفة</div>
              <h1 className="font-black text-[22px] leading-[1.05] tracking-tight">ادخل بيانات الانضمام</h1>
            </div>
            {error && <div className="bg-[#ff2d2d] text-white border-[2.5px] border-black rounded-[14px] p-3 font-black text-[13px] text-center">{error}</div>}
            <section className="bg-black border-[2.5px] border-black rounded-[20px] p-4 flex flex-col gap-4 animate-[fadeIn_.25s]">
              <div className="flex flex-col gap-2">
                <span className="font-black text-[13px] text-[#f6f0d2]">اسمك</span>
                <input value={joinName} onChange={(e)=>{const v=e.target.value.slice(0,15); setJoinName(v); localStorage.setItem('qoud_name',v); onChangeName(0,v);}} placeholder="اكتب اسمك" className="w-full h-14 rounded-full border-[2.5px] border-white/20 bg-[#1a1a1a] text-white px-5 font-bold text-[16px] placeholder:text-white/40 outline-none focus:border-white/50" />
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-black text-[13px] text-[#f6f0d2]">رمز الغرفة - 6 أرقام</span>
                <input value={joinCode} onChange={(e)=>onJoinCodeChange(e.target.value.replace(/[^0-9]/g,'').slice(0,6))} placeholder="123456" className="w-full h-14 rounded-full border-[2.5px] border-white bg-white text-black text-center font-black text-[22px] tracking-[0.3em] outline-none" />
              </div>
              <button onClick={()=>onJoin(joinName)} className="w-full h-14 rounded-full border-[2.5px] border-white bg-[#ff2d2d] text-white font-black text-[16px] flex items-center justify-center gap-2 hover:bg-[#ff4444] active:scale-[0.98] transition">
                <LogIn size={20} strokeWidth={2.5} /> دخول الغرفة
              </button>
              <div className="text-[11px] font-bold text-white/50 text-center">اكتب اسمك + كود الغرفة 6 أرقام مختلفة</div>
            </section>
            <button onClick={()=>setShowJoinOnly(false)} className="w-full h-12 rounded-full border-[2.5px] border-black bg-white text-black font-black text-[14px] active:scale-[0.98] transition">← رجوع للإعدادات</button>
          </>
        ) : (
          <>
            <div className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-4 text-center">
              <div className="text-[11px] font-black tracking-[0.18em] opacity-50 mb-1.5">طاولة LED</div>
              <h1 className="font-black text-[26px] leading-[1.05] tracking-tight">صمم مباراتك<br/>البطولية</h1>
            </div>
            {error && <div className="bg-[#ff2d2d] text-white border-[2.5px] border-black rounded-[14px] p-3 font-black text-[13px] text-center">{error}</div>}

            {/* زر انضمام عريض في الأعلى - يخفي كل القائمة */}
            <button onClick={()=>setShowJoinOnly(true)} className="w-full h-[56px] rounded-[16px] border-[2.5px] border-black bg-[#0a0a0a] text-white font-black text-[16px] flex items-center justify-center gap-2 hover:bg-black active:scale-[0.98] transition shadow-[0_3px_0_#000]">
              <LogIn size={20} strokeWidth={2.5} /> انضمام لغرفة موجودة
            </button>


        {/* 1- نموذج 2D / 3D فقط */}
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-black text-[14px]">نموذج اللعبة</span>
            <span className="bg-black text-white text-[11px] font-black px-3 h-7 rounded-full grid place-items-center">MODEL</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onChangeSettings({ graphics: '2d' })} className={`h-11 rounded-full border-[2.5px] border-black font-black text-[14px] transition-colors ${settings.graphics==='2d'?'bg-black text-white':'bg-white text-black'}`}>2D LED</button>
            <button onClick={() => onChangeSettings({ graphics: '3d' })} className={`h-11 rounded-full border-[2.5px] border-black font-black text-[14px] transition-colors ${settings.graphics==='3d'?'bg-black text-white':'bg-white text-black'}`}>3D LED</button>
          </div>
        </section>

        {/* 2- السرعة */}
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><span className="bg-[#ffcf5a] border-[2px] border-black rounded-full px-3 h-7 text-[11px] font-black grid place-items-center">MODE 4</span><span className="font-black text-[14px]">السرعة</span></div>
            <div className="w-6 h-6 rounded-full border-[2px] border-black bg-white grid place-items-center text-[11px] font-black">1</div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={()=>onChangeSettings({speed:'fixed'})} className={`relative h-[92px] rounded-[14px] border-[2.5px] border-black overflow-hidden transition-colors ${settings.speed==='fixed'?'bg-black':'bg-white'}`}>
              <div className="absolute top-2.5 right-2.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ff2d2d]" /><span className="text-[10px] font-black px-2 h-5 rounded-full bg-white text-black border border-black grid place-items-center">ثابتة</span></div>
              <div className="absolute inset-0 grid place-items-center pt-3"><div className="w-20 h-9 rounded-[10px] bg-black border border-white/20 flex items-center justify-center"><div className="w-5 h-5 rounded-full bg-[#ff2d2d] border-2 border-white" /></div></div>
              {settings.speed==='fixed' && <div className="absolute top-1.5 left-1.5 w-5 h-5 bg-white text-black rounded-full grid place-items-center text-[12px] font-black">✓</div>}
            </button>
            <button onClick={()=>onChangeSettings({speed:'gradual'})} className={`relative h-[92px] rounded-[14px] border-[2.5px] border-black overflow-hidden ${settings.speed==='gradual'?'bg-black':'bg-white'}`}>
              <div className="absolute top-2.5 right-2.5 text-[10px] font-black px-2 h-5 rounded-full bg-white text-black border border-black grid place-items-center">متدرجة</div>
              <svg viewBox="0 0 120 86" className="w-full h-full"><rect width="120" height="86" fill={settings.speed==='gradual'?'#111':'#fff9dc'} /><rect x="20" y="30" width="80" height="26" rx="6" fill="#000" /><circle cx="60" cy="43" r="9" fill="#ff2d2d" opacity="0.25"/><circle cx="42" cy="43" r="7.5" fill="#ff2d2d" opacity="0.45"/><circle cx="27" cy="43" r="6" fill="#ff2d2d" opacity="0.65"/><circle cx="14" cy="43" r="4.5" fill="#ff2d2d" opacity="0.9"/></svg>
              {settings.speed==='gradual' && <div className="absolute top-1.5 left-1.5 w-5 h-5 bg-white text-black rounded-full grid place-items-center text-[12px] font-black">✓</div>}
            </button>
            <button onClick={()=>onChangeSettings({start:'paddle'})} className={`relative h-[92px] rounded-[14px] border-[2.5px] border-black overflow-hidden ${settings.start==='paddle'?'bg-black':'bg-white'}`}>
              <div className="absolute top-2.5 right-2.5 text-[10px] font-black px-2 h-5 rounded-full bg-white text-black border border-black grid place-items-center">من المضرب</div>
              <svg viewBox="0 0 120 86" className="w-full h-full"><rect width="120" height="86" fill={settings.start==='paddle'?'#111':'#fff9dc'} /><rect x="20" y="22" width="80" height="38" rx="8" fill="none" stroke={settings.start==='paddle'?'#fff':'#000'} strokeWidth="2"/><rect x="45" y="52" width="30" height="6" rx="3" fill={settings.start==='paddle'?'#fff':'#000'}/><circle cx="60" cy="44" r="6" fill="#ff2d2d" stroke="#000" strokeWidth="1.5"/></svg>
              {settings.start==='paddle' && <div className="absolute top-1.5 left-1.5 w-5 h-5 bg-white text-black rounded-full grid place-items-center text-[12px] font-black">✓</div>}
            </button>
            <button onClick={()=>onChangeSettings({start:'center'})} className={`relative h-[92px] rounded-[14px] border-[2.5px] border-black overflow-hidden ${settings.start==='center'?'bg-black':'bg-white'}`}>
              <div className="absolute top-2.5 right-2.5 text-[10px] font-black px-2 h-5 rounded-full bg-white text-black border border-black grid place-items-center">من المنتصف</div>
              <svg viewBox="0 0 120 86" className="w-full h-full"><rect width="120" height="86" fill={settings.start==='center'?'#111':'#fff9dc'} /><rect x="20" y="22" width="80" height="38" rx="8" fill="none" stroke={settings.start==='center'?'#fff':'#000'} strokeWidth="2"/><line x1="20" y1="40" x2="100" y2="40" stroke={settings.start==='center'?'#fff':'#000'} strokeWidth="1" strokeDasharray="3 3"/><circle cx="60" cy="40" r="6" fill="#ff2d2d" stroke="#000" strokeWidth="1.5"/></svg>
              {settings.start==='center' && <div className="absolute top-1.5 left-1.5 w-5 h-5 bg-white text-black rounded-full grid place-items-center text-[12px] font-black">✓</div>}
            </button>
          </div>
          {settings.speed==='fixed' && (
            <div className="bg-white border-[2.5px] border-black rounded-[14px] p-3 animate-[fadeIn_.2s]">
              <div className="flex justify-between mb-2"><span className="font-black text-[13px] flex items-center gap-1.5"><span className="w-2 h-2 bg-black rounded-full" /> سرعة الكرة</span><span className="font-black text-[12px] bg-black text-white px-2.5 h-6 rounded-full grid place-items-center">{settings.ballSpeed} / 20</span></div>
              <input type="range" min={1} max={20} value={settings.ballSpeed} onChange={e=>onChangeSettings({ballSpeed:Number(e.target.value)})} className="w-full" />
              <div className="flex justify-between text-[11px] font-black opacity-50 mt-1"><span>بطيء</span><span>سريع</span></div>
            </div>
          )}
        </section>

        {/* 3- نظام الجولات */}
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><span className="bg-black text-white border border-black rounded-full px-3 h-7 text-[11px] font-black grid place-items-center">SERIES</span><span className="font-black text-[14px]">نظام الجولات</span></div>
            <div className="w-6 h-6 rounded-full border-[2px] border-black bg-white grid place-items-center text-[11px] font-black">4</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={()=>onChangeSettings({seriesType:'single'})} className={`h-[52px] rounded-full border-[2px] border-black font-black text-[13px] leading-[1.1] transition-colors ${settings.seriesType==='single'?'bg-black text-white':'bg-white text-black'}`}>🎮 لعب حر<br/><span className="text-[10px] opacity-70 font-bold">فوز مرة واحدة</span></button>
            <button onClick={()=>onChangeSettings({seriesType:'series'})} className={`h-[52px] rounded-full border-[2px] border-black font-black text-[13px] leading-[1.1] transition-colors ${settings.seriesType==='series'?'bg-black text-white':'bg-white text-black'}`}>🏆 جولات متتالية<br/><span className="text-[10px] opacity-70 font-bold">الأكثر فوزا</span></button>
          </div>
          {settings.seriesType==='series' && (
            <div className="animate-[fadeIn_.2s] bg-white border-[2px] border-black rounded-[14px] p-3 flex flex-col gap-2.5">
              <div className="flex justify-between"><span className="font-black text-[13px]">عدد الجولات</span><span className="font-black text-[12px] bg-black text-white px-2.5 h-6 rounded-full grid place-items-center">{settings.seriesRounds} جولات</span></div>
              <div className="flex items-center justify-between bg-[#fff9dc] border-[2px] border-black rounded-full h-10 px-2">
                <button onClick={()=>onChangeSettings({seriesRounds: Math.max(2, settings.seriesRounds-1)})} className="w-8 h-8 rounded-full border-[2px] border-black bg-white grid place-items-center hover:bg-black hover:text-white transition"><Minus size={16} /></button>
                <div className="flex items-center gap-1">{Array.from({length: settings.seriesRounds}, (_,i)=><div key={i} className="w-6 h-6 rounded-full border-[1.5px] border-black bg-[#ffcf5a] grid place-items-center text-[11px] font-black">{i+1}</div>)}</div>
                <button onClick={()=>onChangeSettings({seriesRounds: Math.min(10, settings.seriesRounds+1)})} className="w-8 h-8 rounded-full border-[2px] border-black bg-white grid place-items-center hover:bg-black hover:text-white transition"><Plus size={16} /></button>
              </div>
              <input type="range" min={2} max={10} step={1} value={settings.seriesRounds} onChange={e=>onChangeSettings({seriesRounds:Number(e.target.value)})} className="w-full" />
              <div className="flex justify-between text-[11px] font-black opacity-50"><span>2 جولات</span><span>10 جولات</span></div>
            </div>
          )}
        </section>

        {/* 4- حجم الساحة */}
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="font-black text-[14px]">📐 حجم الساحة</span><div className="w-6 h-6 rounded-full border-[2px] border-black bg-white grid place-items-center text-[11px] font-black">2</div></div>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={()=>onChangeSettings({arenaSize:'small'})} className={`h-10 rounded-full border-[2px] border-black font-black text-[13px] ${settings.arenaSize==='small'?'bg-black text-white':'bg-white text-black'}`}>S</button>
            <button onClick={()=>onChangeSettings({arenaSize:'medium'})} className={`h-10 rounded-full border-[2px] border-black font-black text-[13px] ${settings.arenaSize==='medium'?'bg-black text-white':'bg-white text-black'}`}>M</button>
            <button onClick={()=>onChangeSettings({arenaSize:'large'})} className={`h-10 rounded-full border-[2px] border-black font-black text-[13px] ${settings.arenaSize==='large'?'bg-black text-white':'bg-white text-black'}`}>L</button>
            <button onClick={()=>onChangeSettings({arenaSize:'xlarge'})} className={`h-10 rounded-full border-[2px] border-black font-black text-[13px] ${settings.arenaSize==='xlarge'?'bg-black text-white':'bg-white text-black'}`}>XL</button>
          </div>
        </section>

        {/* 5- طريقة الفوز */}
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="font-black text-[14px]">طريقة الفوز</span><div className="w-6 h-6 rounded-full border-[2px] border-black bg-white grid place-items-center text-[11px] font-black">3</div></div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={()=>onChangeSettings({mode:'time'})} className={`h-11 rounded-full border-[2px] border-black font-black text-[13px] ${settings.mode==='time'?'bg-black text-white':'bg-white text-black'}`}>⏱ وقت</button>
            <button onClick={()=>onChangeSettings({mode:'goals'})} className={`h-11 rounded-full border-[2px] border-black font-black text-[13px] ${settings.mode==='goals'?'bg-black text-white':'bg-white text-black'}`}>🎯 أهداف</button>
          </div>
          {settings.mode==='time' ? (
            <div className="animate-[fadeIn_.2s] flex flex-col gap-2">
              <div className="flex items-center justify-between bg-white border-[2px] border-black rounded-full h-11 px-2">
                <button onClick={()=>onChangeSettings({duration: Math.max(30, settings.duration-30)})} className="w-8 h-8 rounded-full border-[2px] border-black bg-white grid place-items-center"><Minus size={14} strokeWidth={2.5} /></button>
                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-black text-white grid place-items-center text-[11px]">⏱</span><span className="font-black text-[13px] bg-black text-white px-3 h-7 rounded-full grid place-items-center">{Math.floor(settings.duration/60)}:{String(settings.duration%60).padStart(2,'0')} / 30:00</span></div>
                <button onClick={()=>onChangeSettings({duration: Math.min(1800, settings.duration+30)})} className="w-8 h-8 rounded-full border-[2px] border-black bg-white grid place-items-center"><Plus size={14} strokeWidth={2.5} /></button>
              </div>
              <input type="range" min={30} max={1800} step={30} value={settings.duration} onChange={e=>onChangeSettings({duration:Number(e.target.value)})} className="w-full" />
            </div>
          ) : (
            <div className="animate-[fadeIn_.2s] flex flex-col gap-2">
              <div className="flex items-center justify-between bg-white border-[2px] border-black rounded-full h-11 px-2">
                <button onClick={()=>onChangeSettings({goal: Math.max(2, settings.goal-1)})} className="w-8 h-8 rounded-full border-[2px] border-black bg-white grid place-items-center"><Minus size={14} strokeWidth={2.5} /></button>
                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-[#ffcf5a] border border-black grid place-items-center text-[11px]">🎯</span><span className="font-black text-[13px] bg-black text-white px-3 h-7 rounded-full grid place-items-center">{settings.goal} / 100</span></div>
                <button onClick={()=>onChangeSettings({goal: Math.min(100, settings.goal+1)})} className="w-8 h-8 rounded-full border-[2px] border-black bg-white grid place-items-center"><Plus size={14} strokeWidth={2.5} /></button>
              </div>
              <input type="range" min={2} max={100} step={1} value={settings.goal} onChange={e=>onChangeSettings({goal:Number(e.target.value)})} className="w-full" />
            </div>
          )}
        </section>

        {/* 6- عدد اللاعبين + من حول الطاولة + ضد الكمبيوتر/الأصدقاء - في الأخير */}
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-black text-[14px]">عدد اللاعبين</span>
            <div className="flex items-center gap-1.5 bg-black text-white rounded-full px-1.5 h-9 border-[2.5px] border-black">
              <button onClick={() => onChangeSettings({ players: Math.min(4, settings.players + 1) })} className="w-7 h-7 grid place-items-center rounded-full hover:bg-white/10 transition"><Plus size={16} strokeWidth={3} /></button>
              <span className="w-7 text-center font-black text-[15px]">{settings.players}</span>
              <button onClick={() => onChangeSettings({ players: Math.max(2, settings.players - 1) })} className="w-7 h-7 grid place-items-center rounded-full hover:bg-white/10 transition"><Minus size={16} strokeWidth={3} /></button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="bg-black text-white text-[11px] font-black px-3 h-7 rounded-full grid place-items-center tracking-wide">PLAYERS {settings.players}</span>
            <span className="font-black text-[14px]">من حول الطاولة؟</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: settings.players }, (_, i) => (
              <div key={i} className="grid grid-cols-[42px_1fr_34px] gap-2 items-center">
                <button type="button" onClick={() => onToggleComputer(i)} className="w-10 h-7 rounded-full border-[2px] border-black bg-white flex items-center px-1 shrink-0">
                  <div className="w-4 h-4 rounded-full border-[1.5px] border-black transition-all duration-200" style={{background: computers[i]? '#ff6b8b' : '#fff', marginLeft: computers[i]? '18px':'0'}} />
                </button>
                <input value={names[i]} onChange={(e) => onChangeName(i, e.target.value)} className="w-full h-10 rounded-full border-[2px] border-black bg-white px-4 font-bold text-[14px] outline-none" maxLength={14} />
                <div className="w-8 h-8 rounded-full border-[2px] border-black grid place-items-center shrink-0" style={{background: COLORS[i]}}><span className="text-[10px]">●</span></div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onChangeSettings({ vsComputer: false })} className={`h-11 rounded-full border-[2px] border-black font-black text-[13px] transition-colors ${!settings.vsComputer?'bg-black text-white':'bg-white text-black'}`}>مع الأصدقاء</button>
            <button onClick={() => onChangeSettings({ vsComputer: true })} className={`h-11 rounded-full border-[2px] border-black font-black text-[13px] transition-colors ${settings.vsComputer?'bg-black text-white':'bg-white text-black'}`}>ضد الكمبيوتر</button>
          </div>
        </section>

        <button onClick={onCreate} className="h-[52px] rounded-[16px] border-[2.5px] border-black bg-black text-[#f6f0d2] font-black text-[16px] active:scale-[0.98] transition hover:bg-[#1a1a1a]">بدء اللعب • انشئ غرفة</button>
        <div className="text-center text-[11px] font-black opacity-50">طاولة LED - تصميم البطولة</div>
        <div className="h-6" />
          </>
        )}
      </div>
    </main>
  );
}




function WaitingRoom({ room, players, isHost, error, onBack, onStart, onRefresh }: any) {
  const [copied, setCopied] = useState(false); const { t, i18n } = useTranslation(); const isAr = i18n.language?.startsWith('ar')?? true;
  const copyCode = async () => { try { await navigator.clipboard.writeText(room); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  return (
    <main className="min-h-screen w-full bg-[#e9dfb1] flex justify-center p-4" dir={isAr? 'rtl' : 'ltr'}>
      <div className="w-full max-w-[480px] flex flex-col gap-3">
        <div className="flex justify-between"><Brand /><button onClick={onBack} className="w-10 h-10 rounded-full border-[2.5px] border-black bg-white grid place-items-center"><ArrowLeft size={18} strokeWidth={2.5} /></button></div>
        <div className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-4">
          <div className="flex justify-between items-center"><h1 className="font-black text-[18px]">الكل جاهز؟</h1><button onClick={copyCode} className="border-[2.5px] border-black rounded-full px-4 h-9 bg-black text-white font-black text-[13px]">{room} {copied?'✓':'📋'}</button></div>
          {error && <div className="mt-3 bg-[#ff2d2d] text-white border-[2.5px] border-black rounded-[12px] p-2.5 font-black text-[13px] text-center">{error}</div>}
          <div className="mt-3 flex flex-wrap gap-2">
  {players.filter(Boolean).map((p:any,i:number)=>(
    <span key={p.id} className="px-3 h-8 rounded-full border-[2px] border-black bg-white font-black text-[12px] flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full" style={{background: COLORS[i]}} />
      {p?.name ?? 'لاعب'}
    </span>
  ))}
</div>
          <div className="mt-4 flex gap-2"><button onClick={onRefresh} className="flex-1 h-11 rounded-[12px] border-[2.5px] border-black bg-white font-black text-[14px]">تحديث</button>{isHost && <button onClick={onStart} className="flex-1 h-11 rounded-[12px] border-[2.5px] border-black bg-black text-white font-black text-[14px]">ابدأ</button>}</div>
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
  const hasDraggedRef = useRef(false);
  const noDragStartRef = useRef(performance.now());
  const touchControls = useRef({ left: false, right: false, up: false, down: false, bottomLeft: false, bottomRight: false, leftUp: false, leftDown: false });
  const drag = useRef<{ side: Player['side'] | null; x: number; y: number }>({ side: null, x: 500, y: 300 });
  const servingRef = useRef<{ active: boolean; side: Player['side']; startTime: number; requested: boolean }>({ active: settings.start === 'paddle', side: 'bottom', startTime: performance.now(), requested: false });
  const [timeLeft, setTimeLeft] = useState(settings.mode === 'time'? settings.duration : 0);
  const [sound, setSound] = useState(settings.sound);
  const [rally, setRally] = useState(0);
  const [isServing, setIsServing] = useState(settings.start === 'paddle');
  const [countdown, setCountdown] = useState(0);
  const [countdownName, setCountdownName] = useState('');
  const [countdownSide, setCountdownSide] = useState('');
  const soundRef = useRef(sound);
  const onTimeUpRef = useRef(onTimeUp);
  const onGoalRef = useRef(onGoal);
  const pausedRef = useRef(paused);
  const celebratingRef = useRef(celebrating);
  const gameEndedRef = useRef(false);
  // --- جديد: إيقاف اللعبة في البداية ---
  const [localReady, setLocalReady] = useState(false);
  const localReadyRef = useRef(false);
  useEffect(()=>{ localReadyRef.current = localReady; }, [localReady]);
  const world = useMemo(() => getArenaWorld(players.length, settings.arenaSize), [players.length, settings.arenaSize]);
  // 2D: كل لاعب يلعب من تحت - إصلاح الشاشة السوداء - بدون دوران كاميرا مؤقتاً لضمان ظهور الساحة
  // ثم التحكم من تحت لكل لاعب عن طريق عكس الإحداثيات
  const mySide = useMemo(() => {
    const mySocketId = (socket as any).id || (socket as any).socketId;
    if (mySocketId) {
      const found = players.find((p:any)=>p.socketId===mySocketId);
      if (found) return found.side as Player['side'];
    }
    const isVsComputer = (settings as any).vsComputer || players.some((p:any)=>p.computer);
    if (isVsComputer) return 'bottom' as Player['side'];
    // للمضيف والعميل
    if (isHost) {
      const hostP = players.find((p:any)=>p.side==='bottom') || players[0];
      return (hostP?.side ?? 'bottom') as Player['side'];
    }
    const nonBottom = players.find((p:any)=>p.side!=='bottom' && !p.computer);
    if (nonBottom) return nonBottom.side as Player['side'];
    return 'bottom' as Player['side'];
  }, [players, isHost, settings.vsComputer]);
  // FIX: كل لاعب يرى نفسه تحت - دوران الساحة حسب الجانب (2D)
  // bottom=0, top=PI, left=-PI/2, right=PI/2 - بدون تعديل كاميرا خارجي
  const myAngle = useMemo(() => {
    if (mySide === 'top') return Math.PI;
    if (mySide === 'left') return -Math.PI/2;
    if (mySide === 'right') return Math.PI/2;
    return 0;
  }, [mySide]);
  soundRef.current = sound; onTimeUpRef.current = onTimeUp; onGoalRef.current = onGoal; pausedRef.current = paused;
  useEffect(()=>{ celebratingRef.current = celebrating; },[celebrating]);
  const audioCtxRef = useRef<AudioContext|null>(null);
  const playHit = useCallback((power:number, xPos:number = world.w/2)=>{ if(!soundRef.current) return; },[world.w]);
  const playGoalSound = useCallback(()=>{},[]);
  const requestLaunch = useCallback(() => { if (servingRef.current.active) servingRef.current.requested = true; }, []);
  const getInitialSpeed = useCallback(() => 1.5 + settings.ballSpeed * 0.2, [settings.ballSpeed]);
  const stateRef = useRef({
    ball: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    ballTarget: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    paddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 },
    targetPaddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 },
    prevPaddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2 },
    last: performance.now(), elapsed: 0, rally: 0, speedMult: 1, countdown: 0, countdownStart: performance.now(), countdownSide: null as Player['side'] | null, effects: [] as any[]
  });
  const ballBuffer = useRef<Array<{x:number,y:number,vx:number,vy:number,t:number}>>([]);
  const isOfflineMode = players.length <= 1;
  const getWorldFromClient = useCallback((clientX:number, clientY:number)=>{
    const arena = arenaRef.current; if(!arena) return {x:world.w/2,y:world.h/2};
    const rect = arena.getBoundingClientRect();
    let wx = ((clientX-rect.left)/rect.width)*world.w;
    let wy = ((clientY-rect.top)/rect.height)*world.h;
    // FIX: عكس دوران الساحة لتحويل إحداثيات اللمس إلى إحداثيات العالم
    // الساحة مرسومة بدوران myAngle، لذا نعكس الدوران للنقطة
    if (myAngle !== 0) {
      const cx = world.w/2;
      const cy = world.h/2;
      const dx = wx - cx;
      const dy = wy - cy;
      const cos = Math.cos(-myAngle);
      const sin = Math.sin(-myAngle);
      wx = cx + dx * cos - dy * sin;
      wy = cy + dx * sin + dy * cos;
    }
    return { x: wx, y: wy };
  }, [world, myAngle]);

  useEffect(() => {
    const handleGameState = (data: any) => {
      if (!data) return;
      if (players.length <= 1) return;
      if (data.ball) {
        ballBuffer.current.push({ x: data.ball.x, y: data.ball.y, vx: data.ball.vx, vy: data.ball.vy, t: performance.now() });
        if (ballBuffer.current.length > 8) ballBuffer.current.shift();
        stateRef.current.ballTarget.x = data.ball.x;
        stateRef.current.ballTarget.y = data.ball.y;
        stateRef.current.ballTarget.vx = data.ball.vx;
        stateRef.current.ballTarget.vy = data.ball.vy;
      }
      if (data.paddles) {
        Object.keys(data.paddles).forEach((side) => {
          if (side === mySide) return;
          const p = data.paddles[side];
          if (stateRef.current.targetPaddles[side as Player['side']]) {
            stateRef.current.targetPaddles[side as Player['side']].x = p.x;
            stateRef.current.targetPaddles[side as Player['side']].y = p.y;
          }
        });
      }
      if (data.countdown !== undefined) { stateRef.current.countdown = data.countdown; setCountdown(data.countdown); }
      if (data.countdownSide !== undefined) { setCountdownSide(data.countdownSide || ''); }
      if (data.rally !== undefined) setRally(data.rally);
    };
    socket.on('game-state', handleGameState);
    return () => { socket.off('game-state', handleGameState); };
  }, [mySide]);

  useEffect(() => {
    const canvas = canvasRef.current; const arena = arenaRef.current; if (!canvas ||!arena) return; const context = canvas.getContext('2d'); if (!context) return; const state = stateRef.current;
    let frame = 0;
    const resize = () => { const ratio = Math.min(window.devicePixelRatio || 1, 2); const rect = arena.getBoundingClientRect(); canvas.width = rect.width * ratio; canvas.height = rect.height * ratio; context.setTransform(canvas.width / world.w, 0, 0, canvas.height / world.h, 0, 0); }; resize(); const observer = new ResizeObserver(resize); observer.observe(arena);
    const needCount = Math.max(2, players.length);
    const requiredSides: Player['side'][] = needCount === 2? ['bottom','top'] : ['bottom','top','right','left'];
    const playerForSide = (side: Player['side']) => players.find((p) => p.side === side)?? ({ id: side, name: side, color: COLORS[SIDES.indexOf(side)], side, computer: side!== 'bottom' } as Player);
    const active = (side: Player['side']) => { return requiredSides.includes(side); };
    const opposite: Record<string, Player['side']> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
    const resetBall = (missedSide?: Player['side']) => {
      const scorerSide = missedSide? opposite[missedSide] : null;
      const scorer = scorerSide? playerForSide(scorerSide) : null;
      try { playGoalSound(); spawnGoalStars(world.w/2, world.h/2); } catch {}
      
      // === إصلاح 4: عند اختيار من المضرب - الكرة تبدأ من المضرب وبالترتيب ===
      if (settings.start === 'paddle') {
        // حدد المضرب التالي بالترتيب - يبدأ من الخصم الذي استقبل الهدف ثم يدور
        const order: Player['side'][] = players.length >= 4 ? ['bottom','right','top','left'] : ['bottom','top'];
        let nextSide: Player['side'] = 'bottom';
        if (missedSide) {
          // الكرة تبدأ من صاحب الهدف المسجل ضده؟ أو بالترتيب - نستخدم الترتيب الدوري
          const lastIdx = order.indexOf(missedSide as any);
          const nextIdx = (lastIdx + 1) % order.length;
          nextSide = order[nextIdx] || 'bottom';
        } else {
          // بداية المباراة - من الأسفل
          nextSide = 'bottom';
        }
        // إذا الجانب غير موجود (مثلاً 2 لاعبين فقط)، استخدم bottom/top
        if (!order.includes(nextSide)) nextSide = 'bottom';
        
        servingRef.current.active = true;
        servingRef.current.side = nextSide;
        servingRef.current.startTime = performance.now();
        servingRef.current.requested = false;
        setIsServing(true);
        
        // ضع الكرة عند المضرب مباشرة
        const paddle = state.paddles[nextSide];
        if (paddle) {
          if (nextSide === 'bottom') { state.ball.x = paddle.x; state.ball.y = paddle.y - 50; }
          else if (nextSide === 'top') { state.ball.x = paddle.x; state.ball.y = paddle.y + 50; }
          else if (nextSide === 'left') { state.ball.x = paddle.x + 50; state.ball.y = paddle.y; }
          else { state.ball.x = paddle.x - 50; state.ball.y = paddle.y; }
          state.ballTarget.x = state.ball.x;
          state.ballTarget.y = state.ball.y;
        }
        state.ball.vx = 0; state.ball.vy = 0;
        state.countdown = 0; setCountdown(0);
        state.rally = 0; setRally(0); state.speedMult = 1;
        hasDraggedRef.current=false; noDragStartRef.current=performance.now();
        return;
      }
      
      state.countdown = 3; state.countdownStart = performance.now(); state.countdownSide = scorerSide as any; setCountdown(3); setCountdownName(scorer? scorer.name : '');
      state.ball.x = world.w / 2; state.ball.y = world.h / 2; state.ballTarget.x = world.w/2; state.ballTarget.y = world.h/2; state.ball.vx = 0; state.ball.vy = 0; state.rally = 0; setRally(0); state.speedMult = 1; hasDraggedRef.current=false; noDragStartRef.current=performance.now(); if(hintDotRef.current) hintDotRef.current.style.display='none'; if(hintTextRef.current) hintTextRef.current.style.display='none';
    };
    const clamp = (v: number, mn: number, mx: number) => Math.max(mn, Math.min(mx, v));
    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2); state.last = now;
      // --- إيقاف اللعبة في البداية: نرسم فقط بدون تحريك ---
      if (!localReadyRef.current) {
        draw(context, state, players, now, false, world, myAngle);
        frame = requestAnimationFrame(tick);
        return;
      }
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
        if (drag.current.side === mySide) {
          state.targetPaddles[mySide].x = clamp(drag.current.x, 50, world.w - 50);
          if(mySide==='bottom' || mySide==='top'){
            if (mySide === 'bottom') {
              const minY = world.h - PADDLE_MOVE_ZONE - 60;
              const maxY = world.h - 40;
              state.targetPaddles[mySide].y = clamp(drag.current.y, minY, maxY);
            } else {
              const minY = 40;
              const maxY = 40 + PADDLE_MOVE_ZONE;
              if (drag.current.y > world.h / 2) {
                const t = (drag.current.y - world.h/2) / (world.h/2);
                state.targetPaddles[mySide].y = clamp(40 + t * PADDLE_MOVE_ZONE, minY, maxY);
              } else {
                state.targetPaddles[mySide].y = clamp(drag.current.y, minY, maxY);
              }
            }
          } else {
            state.targetPaddles[mySide].y = clamp(drag.current.y, 50, world.h - 50);
            const minX = mySide==='left'? 40 : world.w - PADDLE_MOVE_ZONE - 60;
            const maxX = mySide==='left'? 40 + PADDLE_MOVE_ZONE : world.w - 40;
            state.targetPaddles[mySide].x = clamp(drag.current.x, minX, maxX);
          }
          socket.sendPaddleTarget(state.targetPaddles[mySide].x, state.targetPaddles[mySide].y);
        }
        if (isOfflineMode && state.countdown > 0) {
          const elapsed = (now - state.countdownStart) / 1000;
          const newCount = Math.max(0, 3 - Math.floor(elapsed));
          if (newCount !== state.countdown) {
            state.countdown = newCount;
            setCountdown(newCount);
            if (newCount === 0) {
              const spd = getInitialSpeed();
              const ang = (Math.random() - 0.5) * 0.8;
              state.ball.vx = Math.sin(ang) * spd;
              state.ball.vy = -Math.abs(Math.cos(ang) * spd) - 2;
              state.ballTarget.vx = state.ball.vx;
              state.ballTarget.vy = state.ball.vy;
            }
          }
          if (state.countdown > 0) {
            draw(context, state, players, now, false, world, myAngle);
            frame = requestAnimationFrame(tick);
            return;
          }
        }
        if (isOfflineMode) {
          const ball = state.ball;
          const w = world.w, h = world.h;
          
          // === إذا من المضرب - الكرة تتبع المضرب حتى يطلب الإطلاق ===
          if (servingRef.current.active) {
            const servingSide = servingRef.current.side;
            const servingPaddle = state.paddles[servingSide];
            if (servingPaddle) {
              if (servingSide === 'bottom') { ball.x = servingPaddle.x; ball.y = servingPaddle.y - 50; }
              else if (servingSide === 'top') { ball.x = servingPaddle.x; ball.y = servingPaddle.y + 50; }
              else if (servingSide === 'left') { ball.x = servingPaddle.x + 50; ball.y = servingPaddle.y; }
              else { ball.x = servingPaddle.x - 50; ball.y = servingPaddle.y; }
              ball.vx = 0; ball.vy = 0;
              state.ballTarget.x = ball.x; state.ballTarget.y = ball.y;
            }
            // إطلاق عند طلب
            if (servingRef.current.requested) {
              servingRef.current.active = false;
              setIsServing(false);
              servingRef.current.requested = false;
              const spd = getInitialSpeed() + 2;
              if (servingSide === 'bottom') { ball.vx = (Math.random()-0.5)*spd; ball.vy = -Math.abs(spd); }
              else if (servingSide === 'top') { ball.vx = (Math.random()-0.5)*spd; ball.vy = Math.abs(spd); }
              else if (servingSide === 'left') { ball.vx = Math.abs(spd); ball.vy = (Math.random()-0.5)*spd; }
              else { ball.vx = -Math.abs(spd); ball.vy = (Math.random()-0.5)*spd; }
            } else {
              draw(context, state, players, now, true, world, myAngle);
              frame = requestAnimationFrame(tick);
              return;
            }
          }
          const BALL_R = 14, PADDLE_R = 26, HIT_DIST = BALL_R + PADDLE_R;
          const predX = ball.x + ball.vx * 12;
          const predY = ball.y + ball.vy * 12;
          const diffMax = settings.difficulty === 'easy' ? 1.8 : settings.difficulty === 'hard' ? 4.5 : 3.2;
          const chase = (cur: number, target: number) => {
            const diff = target - cur;
            if (Math.abs(diff) < 1) return cur;
            return cur + Math.max(-diffMax, Math.min(diffMax, diff * 0.16)) * delta;
          };
          (['top','bottom','right','left'] as const).forEach(side => {
            if (!active(side) || side === mySide) return;
            const p = state.paddles[side];
            // حركة الكمبيوتر - تبقى داخل الساحة فقط
            if (side === 'top') {
              p.x = Math.max(80, Math.min(w - 80, chase(p.x, predX)));
              p.y = Math.max(50, Math.min(200, chase(p.y, predY)));
            } else if (side === 'bottom') {
              p.x = Math.max(80, Math.min(w - 80, chase(p.x, predX)));
              p.y = Math.max(h - 200, Math.min(h - 50, chase(p.y, predY)));
            } else if (side === 'left') {
              p.y = Math.max(80, Math.min(h - 80, chase(p.y, predY)));
              p.x = Math.max(50, Math.min(200, chase(p.x, predX)));
            } else {
              p.y = Math.max(80, Math.min(h - 80, chase(p.y, predY)));
              p.x = Math.max(w - 200, Math.min(w - 50, chase(p.x, predX)));
            }
            state.targetPaddles[side].x = p.x;
            state.targetPaddles[side].y = p.y;
          });
          ball.x += ball.vx * delta * 0.5;
          ball.y += ball.vy * delta * 0.5;
          // === فيزياء محسنة: ارتداد بقوة حسب سرعة واتجاه المضرب ===
          (['top','bottom','right','left'] as const).forEach(side => {
            if (!active(side)) return;
            const paddle = state.paddles[side];
            const prev = state.prevPaddles[side];
            const pvx = (paddle.x - prev.x) / (delta || 1);
            const pvy = (paddle.y - prev.y) / (delta || 1);
            const paddleSpeed = Math.hypot(pvx, pvy);
            
            const dx = ball.x - paddle.x, dy = ball.y - paddle.y, d = Math.hypot(dx, dy);
            if (d < HIT_DIST && d > 0.5) {
              const nx = dx / d, ny = dy / d;
              ball.x = paddle.x + nx * (HIT_DIST + 2);
              ball.y = paddle.y + ny * (HIT_DIST + 2);
              
              // انعكاس مع سرعة المضرب - ارتداد بقوة حسب اتجاهه وسرعته
              const dot = ball.vx * nx + ball.vy * ny;
              let newVx = ball.vx - 2 * dot * nx;
              let newVy = ball.vy - 2 * dot * ny;
              
              // إضافة قوة دفع المضرب بقوة (70% من سرعة المضرب)
              newVx += pvx * 0.85;
              newVy += pvy * 0.85;
              
              // تأثير مكان الضرب على المضرب
              const hitOffset = side === 'bottom' || side === 'top' 
                ? (ball.x - paddle.x) / PADDLE_R 
                : (ball.y - paddle.y) / PADDLE_R;
              if (side === 'bottom' || side === 'top') {
                newVx += hitOffset * 4.5;
              } else {
                newVy += hitOffset * 4.5;
              }
              
              // زيادة السرعة حسب سرعة المضرب - كلما كان المضرب أسرع ارتدت الكرة بقوة أكبر
              const curSpd = Math.hypot(newVx, newVy);
              const speedBoost = 1.08 + state.rally * 0.025 + paddleSpeed * 0.045;
              const baseSpeed = Math.max(curSpd * speedBoost, getInitialSpeed() + 2 + paddleSpeed * 0.12);
              const finalSpeed = Math.min(baseSpeed, 14 + paddleSpeed * 0.1);
              
              const ang = Math.atan2(newVy, newVx);
              // منع الزاوية الأفقية
              let finalAng = ang;
              if (Math.abs(Math.sin(finalAng)) < 0.28) {
                finalAng += (Math.random() > 0.5 ? 1 : -1) * 0.4;
              }
              
              ball.vx = Math.cos(finalAng) * finalSpeed;
              ball.vy = Math.sin(finalAng) * finalSpeed;
              
              try { playHitSound(Math.min(1, (state.rally + paddleSpeed*0.2)/10)); } catch {}
              state.rally++; setRally(state.rally);
            }
            prev.x = paddle.x;
            prev.y = paddle.y;
          });
          // === إصلاح: اهداف كبيرة 52% + ارتداد صحيح من الجدار الاحمر فقط ===
          const BORDER = 28; // سماكة الإطار الأحمر
          const WALL_R = 16; // نصف قطر الارتداد
          const goalW = Math.min(520, Math.max(280, w * 0.52)); // اهداف كبيرة 52%
          const goalH = Math.min(520, Math.max(280, h * 0.52));
          const gx1 = (w - goalW) / 2, gx2 = gx1 + goalW;
          const gy1 = (h - goalH) / 2, gy2 = gy1 + goalH;
          const EDGE = 26;

          // --- جدران علوية وسفلية ---
          // علوي
          if (ball.y < BORDER) {
            if (active('top') && ball.x >= gx1 && ball.x <= gx2) {
              // داخل الفتحة السوداء - هدف
              if (ball.y < -BALL_R) { onGoalRef.current(playerForSide('bottom')); resetBall('top'); }
            } else {
              // خارج الفتحة - ارتداد من الجدار الأحمر
              // ارتداد من زاوية الفتحة
              if (ball.x >= gx1 - EDGE && ball.x < gx1) {
                ball.x = gx1 - WALL_R - 2; ball.vx = -Math.abs(ball.vx) * 1.05; ball.vy = Math.abs(ball.vy);
              } else if (ball.x > gx2 && ball.x <= gx2 + EDGE) {
                ball.x = gx2 + WALL_R + 2; ball.vx = Math.abs(ball.vx) * 1.05; ball.vy = Math.abs(ball.vy);
              } else {
                ball.y = BORDER; ball.vy = Math.abs(ball.vy) * 1.02;
              }
            }
          }
          // سفلي
          if (ball.y > h - BORDER) {
            if (active('bottom') && ball.x >= gx1 && ball.x <= gx2) {
              if (ball.y > h + BALL_R) { onGoalRef.current(playerForSide('top')); resetBall('bottom'); }
            } else {
              if (ball.x >= gx1 - EDGE && ball.x < gx1) {
                ball.x = gx1 - WALL_R - 2; ball.vx = -Math.abs(ball.vx) * 1.05; ball.vy = -Math.abs(ball.vy);
              } else if (ball.x > gx2 && ball.x <= gx2 + EDGE) {
                ball.x = gx2 + WALL_R + 2; ball.vx = Math.abs(ball.vx) * 1.05; ball.vy = -Math.abs(ball.vy);
              } else {
                ball.y = h - BORDER; ball.vy = -Math.abs(ball.vy) * 1.02;
              }
            }
          }
          // يسار
          if (ball.x < BORDER) {
            if (active('left') && ball.y >= gy1 && ball.y <= gy2) {
              if (ball.x < -BALL_R) { onGoalRef.current(playerForSide('right')); resetBall('left'); }
            } else {
              if (ball.y >= gy1 - EDGE && ball.y < gy1) {
                ball.y = gy1 - WALL_R - 2; ball.vy = -Math.abs(ball.vy) * 1.05; ball.vx = Math.abs(ball.vx);
              } else if (ball.y > gy2 && ball.y <= gy2 + EDGE) {
                ball.y = gy2 + WALL_R + 2; ball.vy = Math.abs(ball.vy) * 1.05; ball.vx = Math.abs(ball.vx);
              } else {
                ball.x = BORDER; ball.vx = Math.abs(ball.vx) * 1.02;
              }
            }
          }
          // يمين
          if (ball.x > w - BORDER) {
            if (active('right') && ball.y >= gy1 && ball.y <= gy2) {
              if (ball.x > w + BALL_R) { onGoalRef.current(playerForSide('left')); resetBall('right'); }
            } else {
              if (ball.y >= gy1 - EDGE && ball.y < gy1) {
                ball.y = gy1 - WALL_R - 2; ball.vy = -Math.abs(ball.vy) * 1.05; ball.vx = -Math.abs(ball.vx);
              } else if (ball.y > gy2 && ball.y <= gy2 + EDGE) {
                ball.y = gy2 + WALL_R + 2; ball.vy = Math.abs(ball.vy) * 1.05; ball.vx = -Math.abs(ball.vx);
              } else {
                ball.x = w - BORDER; ball.vx = -Math.abs(ball.vx) * 1.02;
              }
            }
          }
          const cur = state.paddles[mySide]; const tgt = state.targetPaddles[mySide];
          cur.x += (tgt.x - cur.x) * 0.5; cur.y += (tgt.y - cur.y) * 0.5;
          // احصر مضرب اللاعب داخل الساحة البيضاء فقط - لا يخرج
          cur.x = Math.max(70, Math.min(w - 70, cur.x));
          cur.y = Math.max(70, Math.min(h - 70, cur.y));
        } else {
          const SUBSTEPS = 4;
          const stepDelta = delta / SUBSTEPS;
          for (let i = 0; i < SUBSTEPS; i++) {
            state.ball.x += state.ball.vx * stepDelta;
            state.ball.y += state.ball.vy * stepDelta;
            const HIT_DIST = 40;
            (['top','bottom','right','left'] as const).forEach(side => {
              if (!active(side)) return;
              const paddle = state.paddles[side];
              const prev = state.prevPaddles[side];
              const pvx = (paddle.x - prev.x) / (delta || 1);
              const pvy = (paddle.y - prev.y) / (delta || 1);
              const paddleSpeed = Math.hypot(pvx, pvy);
              
              const dx = state.ball.x - paddle.x;
              const dy = state.ball.y - paddle.y;
              const dist = Math.hypot(dx, dy);
              if (dist < HIT_DIST && dist > 0.5) {
                const nx = dx / dist, ny = dy / dist;
                const overlap = HIT_DIST - dist + 1;
                state.ball.x += nx * overlap;
                state.ball.y += ny * overlap;
                
                // ارتداد بقوة حسب سرعة المضرب - حتى في الأونلاين
                const dot = state.ball.vx * nx + state.ball.vy * ny;
                let newVx = state.ball.vx - 2 * dot * nx + pvx * 0.75;
                let newVy = state.ball.vy - 2 * dot * ny + pvy * 0.75;
                
                const speedBoost = 1.05 + paddleSpeed * 0.04;
                let spd = Math.hypot(newVx, newVy) * speedBoost;
                spd = Math.max(spd, getInitialSpeed() + 1);
                const ang = Math.atan2(newVy, newVx);
                state.ball.vx = Math.cos(ang) * spd;
                state.ball.vy = Math.sin(ang) * spd;
              }
              prev.x = paddle.x;
              prev.y = paddle.y;
            });
          }
          state.ball.x += (state.ballTarget.x - state.ball.x) * 0.1;
          state.ball.y += (state.ballTarget.y - state.ball.y) * 0.1;
          (['top','bottom','right','left'] as const).forEach(side => {
            if (!active(side)) return;
            const target = state.targetPaddles[side]; const current = state.paddles[side];
            const lf = side === mySide ? 0.5 : 0.22;
            current.x += (target.x - current.x) * lf;
            current.y += (target.y - current.y) * lf;
          });
        }
      }
      draw(context, state, players, now, false, world, myAngle);
      if (pausedRef.current || gameEndedRef.current) { frame = requestAnimationFrame(tick); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [players, settings, getInitialSpeed, isHost, roomCode, mySide, myAngle]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (key === ' ' || event.code === 'Space') { if (servingRef.current.active) { servingRef.current.requested = true; event.preventDefault(); } } if (event.key === 'ArrowLeft' || key === 'a') touchControls.current.left = true; if (event.key === 'ArrowRight' || key === 'd') touchControls.current.right = true; if (event.key === 'ArrowUp' || key === 'w') touchControls.current.up = true; if (event.key === 'ArrowDown' || key === 's') touchControls.current.down = true; if (key === 'j') touchControls.current.bottomLeft = true; if (key === 'l') touchControls.current.bottomRight = true; if (key === 'i') touchControls.current.leftUp = true; if (key === 'k') touchControls.current.leftDown = true; };
    const up = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (event.key === 'ArrowLeft' || key === 'a') touchControls.current.left = false; if (event.key === 'ArrowRight' || key === 'd') touchControls.current.right = false; if (event.key === 'ArrowUp' || key === 'w') touchControls.current.up = false; if (event.key === 'ArrowDown' || key === 's') touchControls.current.down = false; if (key === 'j') touchControls.current.bottomLeft = false; if (key === 'l') touchControls.current.bottomRight = false; if (key === 'i') touchControls.current.leftUp = false; if (key === 'k') touchControls.current.leftDown = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const bindTouch = (direction: keyof typeof touchControls.current) => ({ onPointerDown: () => { touchControls.current[direction] = true; }, onPointerUp: () => { touchControls.current[direction] = false; }, onPointerLeave: () => { touchControls.current[direction] = false; } });
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (paused || celebrating) return; 
    // إصلاح 5: بدء الكرة من المضرب عند الضغط
    if (isServing || servingRef.current.active) { 
      requestLaunch(); 
      servingRef.current.requested = true;
      return; 
    }
    (event.currentTarget as any).setPointerCapture?.(event.pointerId);
    const pt = getWorldFromClient(event.clientX, event.clientY);
    const isTouch = (event as any).pointerType==='touch'; const OFFSET = isTouch? 195 : 70; // الإصبع أسفل المضرب ولا يغطيه - إصلاح جوال
    let tx=pt.x, ty=pt.y;
    if(mySide==='bottom') ty=pt.y-OFFSET;
    else if(mySide==='top') ty=pt.y+OFFSET;
    else if(mySide==='left') tx=pt.x+OFFSET;
    else if(mySide==='right') tx=pt.x-OFFSET;
    hasDraggedRef.current=true; if(hintDotRef.current) hintDotRef.current.style.display='none'; if(hintTextRef.current) hintTextRef.current.style.display='none';
    drag.current = { side: mySide, x: tx, y: ty };
    stateRef.current.targetPaddles[mySide].x = tx; stateRef.current.targetPaddles[mySide].y = ty;
    socket.sendPaddleTarget(tx, ty);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current.side) return;
    const pt = getWorldFromClient(event.clientX, event.clientY);
    const isTouch = (event as any).pointerType==='touch'; const OFFSET = isTouch? 195 : 70; // الإصبع أسفل المضرب ولا يغطيه - إصلاح جوال
    let tx=pt.x, ty=pt.y;
    if(mySide==='bottom') ty=pt.y-OFFSET;
    else if(mySide==='top') ty=pt.y+OFFSET;
    else if(mySide==='left') tx=pt.x+OFFSET;
    else if(mySide==='right') tx=pt.x-OFFSET;
    drag.current.x = tx; drag.current.y = ty;
    stateRef.current.targetPaddles[mySide].x = tx; stateRef.current.targetPaddles[mySide].y = ty;
    socket.sendPaddleTarget(tx, ty);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => { if ((event.currentTarget as any).hasPointerCapture?.(event.pointerId)) (event.currentTarget as any).releasePointerCapture(event.pointerId); drag.current.side = null; };

  return (
    <main className="game-shell" dir="ltr" style={{ touchAction: 'none' }} onContextMenu={e => e.preventDefault()}>
  <style>{`
    @keyframes hintPulse{0%{transform:translate(-50%,-50%) scale(1); box-shadow:0 0 0 0 rgba(0,229,255,0.7)}70%{transform:translate(-50%,-50%) scale(1.3); box-shadow:0 0 0 12px rgba(0,229,255,0)}100%{transform:translate(-50%,-50%) scale(1); box-shadow:0 0 0 0 rgba(0,229,255,0)}}
  `}</style>
  <header className="game-topbar">
    <Brand />
    <div className="match-meta flex items-center gap-2">
      <span><i className="live-dot" /></span>
      <b>{settings.mode === 'time' ? formatTime(timeLeft) : '∞'}</b> | {mySide}
      {settings.seriesType === 'series' && (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: '#1a1a1a', padding: '4px 12px', borderRadius: '20px', color: '#fff' }}>
          <span style={{ fontWeight: 'bold', color: '#ffcf5a' }}>جولة {currentRound}/{settings.seriesRounds}</span>
          {players.filter(Boolean).map((p: any) => (
            <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.color }} />
              <span>{p.name}</span>
              <strong style={{ color: p.color }}>{(seriesWins[p.id] ?? 0)}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
    <div className="game-actions">
      <button className="game-icon" onClick={() => setSound((value) => !value)}><Volume2 size={18} /></button>
      <button className="game-icon" onClick={onPause}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>
    </div>
  </header>
  <div className="score-strip">
    {players.filter(Boolean).map((player: any) => (
      <div className="score-chip" key={player.id} style={{ border: player.side === mySide ? `2px solid ${player.color}` : undefined }}>
        <span className="score-color" style={{ background: player.color }} />
        <span>{player.name}{player.side === mySide ? ' (انت)' : ''}</span>
        <strong>{scores[player.id] ?? 0}</strong>
      </div>
    ))}
    <div className="rally-meter"><span>Rally</span><b>{rally}</b></div>
  </div>
  <section className="arena-stage" style={{ width: '100%', maxWidth: '100vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <div className="arena-frame" ref={arenaRef} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
      style={{ touchAction: 'none', position: 'relative', width: `min(95vw, 760px, ${(88 * (world.w / world.h)).toFixed(2)}vh)`, aspectRatio: `${world.w} / ${world.h}`, margin: '0 auto', borderRadius: '32px', overflow: 'hidden', background: '#000', boxShadow: '0 0 0 2px #111, 0 0 40px rgba(0,229,255,0.25)' }}>
      <canvas ref={canvasRef} style={{ touchAction: 'none', width: '100%', height: '100%' }} />
      <div ref={hintDotRef} style={{ position: 'absolute', width: '14px', height: '14px', borderRadius: '50%', background: '#00e5ff', border: '2px solid #fff', display: 'none', zIndex: 20, pointerEvents: 'none', animation: 'hintPulse 1.2s infinite' }} />
      <div ref={hintTextRef} style={{ position: 'absolute', background: '#00e5ff', color: '#000', padding: '6px 12px', borderRadius: 999, fontSize: '12px', fontWeight: 900, display: 'none', zIndex: 20, pointerEvents: 'none', whiteSpace: 'nowrap' }}>👆 حرك المضرب من هنا</div>
      <button onClick={() => window.location.reload()} style={{ position: 'absolute', top: 12, left: 12, zIndex: 100, background: 'rgba(255, 45, 45, 0.9)', color: 'white', border: 'none', padding: '8px 12px', borderRadius: 8, fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>خروج</button>

      {/* --- Overlay 2D مبسط - بدون تغطية سوداء كاملة - يظهر اللاعبين والكرة --- */}
      {!localReady && (
        <div style={{ position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 'calc(100% - 32px)', maxWidth: '420px', background: 'rgba(15,15,20,0.75)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '20px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
            <div style={{textAlign:'center'}}>
              <h3 style={{color:'#fff', fontSize:'18px', fontWeight:900, marginBottom:'6px'}}>جاهز؟ الساحة أمامك</h3>
              <p style={{color:'rgba(255,255,255,0.6)', fontSize:'13px', lineHeight:1.4}}>الساحة ظاهرة بوضوح - حرك المضرب لتجربة التحكم قبل البدء</p>
            </div>
            <button onClick={()=>setLocalReady(true)} style={{width:'100%', padding:'14px', borderRadius:'12px', background:'#4CAF50', color:'#fff', fontWeight:900, fontSize:'16px', border:'none', cursor:'pointer', boxShadow:'0 4px 12px rgba(76,175,80,0.4)'}}>🎮 بدء اللعب</button>
          </div>
        </div>
      )}

      {localReady && countdown > 0 && (
        <div style={{ position: 'absolute', inset: 0, background: countdownSide ? 'rgba(0,0,0,0.84)' : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'none', gap: '22px' }}>
          <span style={{ fontSize: '132px', fontWeight: 900, color: '#ff2233', lineHeight: 1, textShadow: '0 0 40px rgba(255,34,51,0.9), 0 0 80px rgba(0,0,0,1)' }}>{countdown}</span>
          {countdownSide && (
            <span style={{ 
              background: 'linear-gradient(135deg, #ff2233 0%, #ff6b6b 100%)', 
              color: '#fff', padding: '13px 28px', borderRadius: 999, 
              fontWeight: 900, fontSize: '17px',
              boxShadow: '0 8px 28px rgba(255,34,51,0.65)',
              border: '2px solid rgba(255,255,255,0.32)',
              display: 'flex', alignItems: 'center', gap: '10px'
            }}>
              ⚽ {(() => {
                const opposite: any = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
                const scorerSide = opposite[countdownSide] || countdownSide;
                const scorer = players.find((p: any) => p.side === scorerSide);
                return scorer ? `${scorer.name} سجل هدف!` : 'هدف!';
              })()}
            </span>
          )}
        </div>
      )}
      {localReady && lastGoal && !celebrating && countdown === 0 && (
        <div style={{ 
          position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%,-50%)', 
          background: 'linear-gradient(135deg, rgba(255,34,51,0.96) 0%, rgba(255,100,100,0.96) 100%)', 
          color: '#fff', padding: '16px 30px', borderRadius: 16, fontWeight: 900, fontSize: '19px',
          zIndex: 11, boxShadow: '0 10px 36px rgba(255,34,51,0.7)', border: '2px solid rgba(255,255,255,0.3)'
        }}>⚽ هدف! {lastGoal}</div>
      )}
      {celebrating && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, gap: '8px' }}>
          <div style={{ fontSize: '48px', fontWeight: 900, color: '#ffcf5a', textShadow: '0 0 20px #ffcf5a' }}>{celebrating?.name ?? 'لاعب'} فاز بالجولة!</div>
          <div style={{ fontSize: '24px', color: '#fff', background: '#222', padding: '8px 24px', borderRadius: '999px' }}>الجولة {currentRound} / {settings.seriesRounds}</div>
        </div>
      )}
    </div>
  </section>
  <div className="touch-controls">
    <button {...bindTouch('bottomRight')}><ChevronRight size={24} /></button>
    <button {...bindTouch('bottomLeft')}><ChevronLeft size={24} /></button>
  </div>
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

// === نظام الأصوات - اصطدام وجمهور - 3 ===
let audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { return null; }
  }
  return audioCtx;
}
function playHitSound(power: number = 0.5) {
  const ctx = getAudioCtx(); if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 620 + power * 380;
    gain.gain.value = 0.2 + power * 0.14;
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.14);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.14);
  } catch {}
}
function playGoalSound() {
  const ctx = getAudioCtx(); if (!ctx) return;
  try {
    for (let i=0;i<4;i++) {
      setTimeout(() => {
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = 180 + Math.random()*320;
          gain.gain.value = 0.3;
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.9);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(); osc.stop(ctx.currentTime + 0.9);
        } catch {}
      }, i*110);
    }
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.frequency.value = 920;
    osc2.frequency.exponentialRampToValueAtTime(1450, ctx.currentTime + 0.38);
    gain2.gain.value = 0.36;
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.72);
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.start(); osc2.stop(ctx.currentTime + 0.72);
  } catch {}
}
let goalStars: Array<{x:number,y:number,vx:number,vy:number,life:number,size:number,color:string}> = [];
function spawnGoalStars(x:number, y:number) {
  for (let i=0;i<28;i++) {
    const ang = (Math.PI*2 * i / 28) + Math.random()*0.4;
    const spd = 3.5 + Math.random()*7;
    goalStars.push({
      x, y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd,
      life: 1, size: 5 + Math.random()*7,
      color: ['#ffcf5a','#ff6b8b','#61e7c2','#00e5ff','#ffffff'][Math.floor(Math.random()*5)]
    });
  }
}
function updateAndDrawStars(ctx: CanvasRenderingContext2D) {
  for (let i=goalStars.length-1;i>=0;i--) {
    const s = goalStars[i];
    s.x += s.vx; s.y += s.vy; s.vy += 0.16; s.vx *= 0.99; s.life -= 0.018;
    if (s.life <=0) { goalStars.splice(i,1); continue; }
    ctx.globalAlpha = s.life;
    ctx.fillStyle = s.color; ctx.shadowColor = s.color; ctx.shadowBlur = 14;
    ctx.beginPath();
    const spikes = 5; const outer = s.size; const inner = s.size*0.5;
    for (let j=0;j<spikes*2;j++) {
      const r = j%2===0 ? outer : inner;
      const a = (Math.PI*2 * j / (spikes*2)) - Math.PI/2;
      if (j===0) ctx.moveTo(s.x + Math.cos(a)*r, s.y + Math.sin(a)*r);
      else ctx.lineTo(s.x + Math.cos(a)*r, s.y + Math.sin(a)*r);
    }
    ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
}


function draw(context: CanvasRenderingContext2D, state: any, players: Player[], now: number, isServing: boolean, world = RECTANGULAR_WORLD, myAngle=0) {
  const canvas = context.canvas as HTMLCanvasElement; const sx = canvas.width / world.w; const sy = canvas.height / world.h;
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height); context.restore();
  context.save(); context.translate(world.w/2, world.h/2); context.rotate(myAngle); context.translate(-world.w/2, -world.h/2);
  const outerRadius = 22; const borderThick = 28; const innerMargin = 10; const countdown = (state as any).countdown || 0;
  // خلفية سوداء خارجية
  context.fillStyle = '#000000'; context.fillRect(0, 0, world.w, world.h);
  const rr = (x: number, y: number, w: number, h: number, r: number) => { context.beginPath(); context.moveTo(x + r, y); context.lineTo(x + w - r, y); context.quadraticCurveTo(x + w, y, x + w, y + r); context.lineTo(x + w, y + h - r); context.quadraticCurveTo(x + w, y + h, x + w - r, y + h); context.lineTo(x + r, y + h); context.quadraticCurveTo(x, y + h, x, y + h - r); context.lineTo(x, y + r); context.quadraticCurveTo(x, y, x + r, y); context.closePath(); };
  // إطار أحمر سميك مثل الصورة - مع فتحة سوداء للهدف
  const GOAL_W = Math.min(520, Math.max(280, world.w * 0.52)); // كبر الاهداف - 52% مثل ما طلب
  const GOAL_H = Math.min(520, Math.max(280, world.h * 0.52)); // كبر الاهداف
  const GX1 = (world.w - GOAL_W) / 2; const GX2 = GX1 + GOAL_W;
  const GY1 = (world.h - GOAL_H) / 2; const GY2 = GY1 + GOAL_H;

  // رسم الإطار الأحمر مع قطع مكان الهدف (أسود)
  const colors = Object.fromEntries(players.map((player) => [player.side, player.color]));
  const active = (side: Player['side']) => { if (players.some((player) => player.side === side)) return true; const count = Math.max(2, players.length || 2); const req = count === 2 ? ['bottom','top'] : ['bottom','top','right','left']; return (req as string[]).includes(side); };

  // طبقة الإطار الأحمر
  context.fillStyle = '#d32f2f'; // أحمر مثل الصورة
  // علوي: جزئين يسار ويمين الفتحة
  if (active('top')) {
    context.fillRect(0, 0, GX1, borderThick); // يسار الفتحة
    context.fillRect(GX2, 0, world.w - GX2, borderThick); // يمين الفتحة
  } else {
    context.fillRect(0, 0, world.w, borderThick);
  }
  // سفلي
  if (active('bottom')) {
    context.fillRect(0, world.h - borderThick, GX1, borderThick);
    context.fillRect(GX2, world.h - borderThick, world.w - GX2, borderThick);
  } else {
    context.fillRect(0, world.h - borderThick, world.w, borderThick);
  }
  // يسار
  if (active('left')) {
    context.fillRect(0, 0, borderThick, GY1);
    context.fillRect(0, GY2, borderThick, world.h - GY2);
  } else {
    context.fillRect(0, 0, borderThick, world.h);
  }
  // يمين
  if (active('right')) {
    context.fillRect(world.w - borderThick, 0, borderThick, GY1);
    context.fillRect(world.w - borderThick, GY2, borderThick, world.h - GY2);
  } else {
    context.fillRect(world.w - borderThick, 0, borderThick, world.h);
  }

  // الفتحات السوداء - مكان دخول الكرة فقط
  context.fillStyle = '#000000';
  if (active('top')) context.fillRect(GX1, 0, GOAL_W, borderThick);
  if (active('bottom')) context.fillRect(GX1, world.h - borderThick, GOAL_W, borderThick);
  if (active('left')) context.fillRect(0, GY1, borderThick, GOAL_H);
  if (active('right')) context.fillRect(world.w - borderThick, GY1, borderThick, GOAL_H);

  // الساحة الداخلية بيضاء مع خطوط
  const innerX = borderThick + innerMargin; const innerY = borderThick + innerMargin;
  const innerW = world.w - (borderThick + innerMargin) * 2; const innerH = world.h - (borderThick + innerMargin) * 2;
  const innerR = 12;
  context.fillStyle = '#f5f5f0'; rr(innerX, innerY, innerW, innerH, innerR); context.fill();
  // خط المنتصف ودوائر
  context.strokeStyle = 'rgba(0,0,0,0.08)'; context.lineWidth = 1.5; context.setLineDash([8,8]);
  context.beginPath(); context.moveTo(world.w/2, innerY); context.lineTo(world.w/2, innerY+innerH); context.stroke();
  context.beginPath(); context.moveTo(innerX, world.h/2); context.lineTo(innerX+innerW, world.h/2); context.stroke();
  context.setLineDash([]);
  // دوائر المنتصف
  context.strokeStyle = 'rgba(211,47,47,0.25)'; context.lineWidth = 2;
  context.beginPath(); context.arc(world.w/2, world.h/2, 90, 0, Math.PI*2); context.stroke();
  context.beginPath(); context.arc(innerX+innerW*0.25, world.h/2, 70, 0, Math.PI*2); context.stroke();
  context.beginPath(); context.arc(innerX+innerW*0.75, world.h/2, 70, 0, Math.PI*2); context.stroke();

  const drawGoalGlow = (x: number, y: number, w: number, h: number, col: string) => {
    context.fillStyle = col + '18'; context.fillRect(x, y, w, h);
    context.strokeStyle = col; context.lineWidth = 2; context.shadowColor = col; context.shadowBlur = 10; context.strokeRect(x, y, w, h); context.shadowBlur = 0;
  };
  if (active('top')) drawGoalGlow(GX1, 0, GOAL_W, borderThick, colors.top?? COLORS[1]);
  if (active('bottom')) drawGoalGlow(GX1, world.h - borderThick, GOAL_W, borderThick, colors.bottom?? COLORS[0]);
  if (active('left')) drawGoalGlow(0, GY1, borderThick, GOAL_H, colors.left?? COLORS[3]);
  if (active('right')) drawGoalGlow(world.w - borderThick, GY1, borderThick, GOAL_H, colors.right?? COLORS[2]);
  if (active('top')) drawHatPaddle(state.paddles.top.x, state.paddles.top.y, colors.top?? COLORS[1]); if (active('bottom')) drawHatPaddle(state.paddles.bottom.x, state.paddles.bottom.y, colors.bottom?? COLORS[0]); if (active('left')) drawHatPaddle(state.paddles.left.x, state.paddles.left.y, colors.left?? COLORS[3]); if (active('right')) drawHatPaddle(state.paddles.right.x, state.paddles.right.y, colors.right?? COLORS[2]);
  if (countdown > 0) { context.save(); context.fillStyle = 'rgba(0,0,0,0.78)'; context.fillRect(0, 0, world.w, world.h); context.fillStyle = '#ff2233'; context.font = 'bold 120px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.shadowColor = '#ff2233'; context.shadowBlur = 28; context.fillText(String(countdown), world.w / 2, world.h / 2); context.shadowBlur = 0; context.restore(); }
  const screenRadius = 11 * Math.min(sx, sy); const rx = screenRadius / sx; const ry = screenRadius / sy;
  // إصلاح 2: الساحة البيضاء الكرة داكنة لا مضيئة
  context.save();
  context.shadowColor = 'rgba(0,0,0,0.35)'; context.shadowBlur = 8;
  context.fillStyle = '#111111';
  context.beginPath(); context.ellipse(state.ball.x, state.ball.y, rx, ry, 0, 0, Math.PI * 2); context.fill();
  context.shadowBlur = 0;
  context.fillStyle = '#222222';
  context.beginPath(); context.ellipse(state.ball.x, state.ball.y, rx*0.92, ry*0.92, 0, 0, Math.PI * 2); context.fill();
  // لمعة صغيرة بيضاء بسيطة
  context.fillStyle = 'rgba(255,255,255,0.55)';
  context.beginPath(); context.ellipse(state.ball.x - rx*0.22, state.ball.y - ry*0.22, rx*0.28, ry*0.28, 0, 0, Math.PI * 2); context.fill();
  context.restore();
  try { updateAndDrawStars(context); } catch {}
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
    winner?.name ? `🏆 ${winner.name} بطل السلسلة!` : '🤝 تعادل السلسلة!'
  ) : (
    winner?.name ? `🏆 ${winner.name} ${isAr ? 'فاز!' : 'Wins!'}` : (isAr ? 'انتهت' : 'Game Over')
  )}
</h1>
          {settings?.seriesType==='series' && seriesWins && (
            <div style={{background:'#000',border:'1.5px solid #ffcf5a',borderRadius:12,padding:10,marginBottom:12}}>
              <div style={{color:'#ffcf5a',fontWeight:900,fontSize:12,marginBottom:6}}>نتائج الجولات {Object.values(seriesWins as any).reduce((a:any,b:any)=>a+b,0)}/{settings.seriesRounds} • كراش</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'center'}}>
                {players.map((p:any)=><div key={p.id} style={{background: p.id===winner?.id?'#2a2200':'#111',border:`1px solid ${p.color}`,borderRadius:8,padding:'6px 10px',display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:p.color}}/><span style={{color:'#fff',fontSize:12}}>{p.name}</span><b style={{color:p.color}}>{(seriesWins as any)[p.id]??0}</b></div>)}
              </div>
              {!winner && <div style={{marginTop:8,color:'#fff',fontSize:11,background:'#222',borderRadius:999,padding:'4px 10px',display:'inline-block'}}>تعادل {Object.values(seriesWins as any).join('-')} • تعد الجولات</div>}
            </div>
          )}
          <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:16}}>
            <b style={{color:'#fff'}}>ترتيب هذه المباراة</b>
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
          <b style={{color:'#00e5ff'}}>📊 ترتيب الفائزين المحفوظ</b>
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
