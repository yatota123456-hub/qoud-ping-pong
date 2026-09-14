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
const PADDLE_MOVE_ZONE = 220;
const PADDLE_SIZE = 42;
const defaultSettings = { players: 2, vsComputer: true, difficulty: 'normal', start: 'center', mode: 'time', duration: 180, goal: 7, speed: 'never_reset', ballSpeed: 10, sound: true, graphics: '2d', arenaSize: 'medium', seriesType: 'single', seriesRounds: 3 } as Settings;

function randomRoom(existing: string[] = []) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do { code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); } while (existing.includes(code));
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
  const [isSocketConnecting, setIsSocketConnecting] = useState(false);
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

 // هذا هو الـ useEffect المصحح كامل - انسخ هذا واستبدل الـ useEffect القديم كله في App.tsx

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
      // 5 ثواني للاحتفال بالجولة
      setTimeout(() => {
        setCelebrating(null);
      }, 5000);
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
    // مراقبة حالة الاتصال بالخادم
    const onConnect = () => setIsSocketConnecting(false);
    const onDisconnect = () => setIsSocketConnecting(true);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // التحقق المبدئي
    if (!socket.connected) setIsSocketConnecting(true);

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
    try {
      const roomCode = randomRoom();
      const colyseusRoom = await colyseus.create('qoud', { code: roomCode, maxPlayers: allPlayers.length, settings, player: allPlayers[0], computerPlayers: allPlayers.slice(1).filter(p=>p.computer), name: allPlayers[0].name, });
      socket.attach(colyseusRoom); setRoom(roomCode); setIsHost(true); setError(''); setScreen('waiting');
    } catch (cause) { setError(cause instanceof Error? cause.message : (isAr? 'تعذر انشاء الغرفة' : 'Could not create room')); }
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
    
    const isOffline = !socket.connected; // ✅ فقط انقطاع الاتصال الحقيقي
    const currentPlayers = isOffline ? makePlayers() : (playersRef.current.length > 0 ? playersRef.current : makePlayers());
    
    if (socket.connected) socket.emit('start-game', { code: roomRef.current }); // ✅ أرسل دائمًا عند الاتصال
    
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

  if (isSocketConnecting) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white z-50">
        <div className="text-2xl font-black mb-4">جاري الاتصال بالخادم...</div>
        <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
      </div>
    );
  }

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
  return <SetupScreen settings={settings} names={names} roomsCount={roomsCount} joinCode={joinCode} joinName={joinName} setJoinName={setJoinName} computers={computers} error={error} onChangeName={(index: number, value: string) => setNames((current) => current.map((name, item) => item === index? value : name))} onChangeSettings={updateSettings} onToggleComputer={(idx: number) => { if (idx === 0) return; setComputers(prev => prev.map((c, i) => i === idx?!c : c)); }} onJoinCodeChange={setJoinCode} onJoin={joinByCode} onCreate={enterWaiting} />;
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
        <div className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-4 text-center">
          <div className="text-[11px] font-black tracking-[0.18em] opacity-50 mb-1.5">طاولة LED</div>
          <h1 className="font-black text-[26px] leading-[1.05] tracking-tight">صمم مباراتك<br/>البطولية</h1>
        </div>
        {error && <div className="bg-[#ff2d2d] text-white border-[2.5px] border-black rounded-[14px] p-3 font-black text-[13px] text-center">{error}</div>}
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onChangeSettings({ graphics: '2d' })} className={`h-11 rounded-full border-[2.5px] border-black font-black text-[14px] transition-colors ${settings.graphics==='2d'?'bg-black text-white':'bg-white text-black'}`}>2D LED</button>
            <button onClick={() => onChangeSettings({ graphics: '3d' })} className={`h-11 rounded-full border-[2.5px] border-black font-black text-[14px] transition-colors ${settings.graphics==='3d'?'bg-black text-white':'bg-white text-black'}`}>3D LED</button>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-black text-[14px]">عدد اللاعبين</span>
            <div className="flex items-center gap-1.5 bg-black text-white rounded-full px-1.5 h-9 border-[2.5px] border-black">
              <button onClick={() => onChangeSettings({ players: Math.min(4, settings.players + 1) })} className="w-7 h-7 grid place-items-center rounded-full hover:bg-white/10 transition"><Plus size={16} strokeWidth={3} /></button>
              <span className="w-7 text-center font-black text-[15px]">{settings.players}</span>
              <button onClick={() => onChangeSettings({ players: Math.max(2, settings.players - 1) })} className="w-7 h-7 grid place-items-center rounded-full hover:bg-white/10 transition"><Minus size={16} strokeWidth={3} /></button>
            </div>
          </div>
        </section>
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
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
        <section className="bg-black border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="bg-[#ffcf5a] text-black text-[11px] font-black px-3 h-7 rounded-full grid place-items-center">JOIN ROOM</span>
            <span className="font-black text-[14px] text-[#f6f0d2]">انضم لغرفة موجودة؟</span>
          </div>
          <div className="grid grid-cols-[1fr_90px_48px] gap-2">
            <input value={joinName} onChange={(e)=>{const v=e.target.value.slice(0,15); setJoinName(v); localStorage.setItem('qoud_name',v); onChangeName(0,v);}} placeholder="اسمك" className="w-full h-11 rounded-full border-[2px] border-white/20 bg-[#1a1a1a] text-white px-4 font-bold text-[14px] placeholder:text-white/40 outline-none focus:border-white/40" />
            <input value={joinCode} onChange={(e)=>onJoinCodeChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4))} placeholder="BZYF" className="w-full h-11 rounded-full border-[2px] border-white bg-white text-black text-center font-black text-[15px] tracking-[0.2em] outline-none" />
            <button onClick={()=>onJoin(joinName)} className="w-12 h-11 rounded-full border-[2px] border-white bg-[#ff2d2d] grid place-items-center text-white hover:bg-[#ff4444] active:scale-95 transition"><LogIn size={18} strokeWidth={2.5} /></button>
          </div>
          <div className="text-[11px] font-bold text-white/50 text-center">اكتب اسمك + كود الغرفة 4 حروف ثم انضم</div>
        </section>
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
              <div className="text-[11px] font-bold bg-black text-white rounded-full px-3 h-7 grid place-items-center text-center">الأكثر فوزا هو البطل • {settings.seriesRounds%2===0?'تعادل ممكن':'لا يوجد تعادل'}</div>
            </div>
          )}
        </section>
        <section className="bg-[#fff9dc] border-[2.5px] border-black rounded-[20px] p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="font-black text-[14px]">📐 حجم الساحة</span><div className="w-6 h-6 rounded-full border-[2px] border-black bg-white grid place-items-center text-[11px] font-black">2</div></div>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={()=>onChangeSettings({arenaSize:'small'})} className={`h-10 rounded-full border-[2px] border-black font-black text-[13px] ${settings.arenaSize==='small'?'bg-black text-white':'bg-white text-black'}`}>S</button>
            <button onClick={()=>onChangeSettings({arenaSize:'medium'})} className={`h-10 rounded-full border-[2px] border-black font-black text-[13px] ${settings.arenaSize==='medium'?'bg-black text-white':'bg-white text-black'}`}>M</button>
            <button onClick={()=>onChangeSettings({arenaSize:'large'})} className={`h-10 rounded-full border-[2px] border-black font-black text-[13px] ${settings.arenaSize==='large'?'bg-black text-white':'bg-white text-black'}`}>L</button>
            <button onClick={()=>onChangeSettings({arenaSize:'xlarge'})} className={`h-10 rounded-full border-[2px] border-black font-black text-[13px] ${settings.arenaSize==='xlarge'?'bg-black text-white':'bg-white text-black'}`}>XL</button>
          </div>
        </section>
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
              <div className="flex justify-between text-[11px] font-black opacity-50"><span>30 ثانية</span><span>30 دقيقة</span></div>
            </div>
          ) : (
            <div className="animate-[fadeIn_.2s] flex flex-col gap-2">
              <div className="flex items-center justify-between bg-white border-[2px] border-black rounded-full h-11 px-2">
                <button onClick={()=>onChangeSettings({goal: Math.max(2, settings.goal-1)})} className="w-8 h-8 rounded-full border-[2px] border-black bg-white grid place-items-center"><Minus size={14} strokeWidth={2.5} /></button>
                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-[#ffcf5a] border border-black grid place-items-center text-[11px]">🎯</span><span className="font-black text-[13px] bg-black text-white px-3 h-7 rounded-full grid place-items-center">{settings.goal} / 100</span></div>
                <button onClick={()=>onChangeSettings({goal: Math.min(100, settings.goal+1)})} className="w-8 h-8 rounded-full border-[2px] border-black bg-white grid place-items-center"><Plus size={14} strokeWidth={2.5} /></button>
              </div>
              <input type="range" min={2} max={100} step={1} value={settings.goal} onChange={e=>onChangeSettings({goal:Number(e.target.value)})} className="w-full" />
              <div className="flex justify-between text-[11px] font-black opacity-50"><span>2</span><span>100 هدف</span></div>
            </div>
          )}
        </section>
        <div className="grid grid-cols-3 gap-2">
          <div className="h-9 rounded-full border-[2px] border-black bg-white flex items-center justify-center gap-1 font-black text-[11px]"><span className="w-2 h-2 bg-[#ff2d2d] rounded-full" /> كود الغرفة</div>
          <div className="h-9 rounded-full border-[2px] border-black bg-white flex items-center justify-center font-black text-[11px]">{settings.ballSpeed} / 20 سرعة</div>
          <div className="h-9 rounded-full border-[2px] border-black bg-white flex items-center justify-center font-black text-[11px]">LED طاولة خشب</div>
        </div>
        <button onClick={onCreate} className="h-[52px] rounded-[16px] border-[2.5px] border-black bg-black text-[#f6f0d2] font-black text-[16px] active:scale-[0.98] transition hover:bg-[#1a1a1a]">انشئ غرفة و سرعة {settings.ballSpeed} • 50</button>
        <div className="text-center text-[11px] font-black opacity-50">طاولة LED - تصميم البطولة</div>
        <div className="h-6" />
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
  const [countdownSide, setCountdownSide] = useState('');
  const soundRef = useRef(sound);
  const onTimeUpRef = useRef(onTimeUp);
  const onGoalRef = useRef(onGoal);
  const pausedRef = useRef(paused);
  const celebratingRef = useRef(celebrating);
  const gameEndedRef = useRef(false);
  const world = useMemo(() => getArenaWorld(players.length, settings.arenaSize), [players.length, settings.arenaSize]);
  const mySide = useMemo(() => (players.find((p:any)=>p.socketId===socket.id)?.side || players[0]?.side || 'bottom') as Player['side'], [players]);
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
      const bufferSize = ctx.sampleRate*8; const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate); const data = buffer.getChannelData(0);
      for(let i=0;i<bufferSize;i++) data[i]=(Math.random()*2-1)*0.65;
      const crowd = ctx.createBufferSource(); crowd.buffer=buffer;
      const filter = ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=900; filter.Q.value=1;
      const gCrowd=ctx.createGain(); gCrowd.gain.setValueAtTime(0,t); gCrowd.gain.linearRampToValueAtTime(0.95,t+0.25); gCrowd.gain.setValueAtTime(0.95,t+6.8); gCrowd.gain.linearRampToValueAtTime(0,t+8);
      crowd.connect(filter).connect(gCrowd).connect(master); crowd.start(t);
      const whistle = (delay:number, f1:number, f2:number, vol:number)=>{
        const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='sine';
        o.frequency.setValueAtTime(f1,t+delay); o.frequency.linearRampToValueAtTime(f2,t+delay+0.7);
        g.gain.setValueAtTime(0,t+delay); g.gain.linearRampToValueAtTime(vol,t+delay+0.04); g.gain.exponentialRampToValueAtTime(0.001,t+delay+1.4);
        o.connect(g).connect(master); o.start(t+delay); o.stop(t+delay+1.5);
      };
      whistle(0.1,1800,3800,1.3); whistle(0.9,2200,4200,1.2); whistle(2.3,1600,3500,1.1); whistle(3.5,2000,3900,1.0);
      [523,659,783,1046,1318].forEach((freq,i)=>{ const o=ctx.createOscillator(); const g2=ctx.createGain(); o.type='square'; o.frequency.value=freq; g2.gain.setValueAtTime(0,t+i*0.12); g2.gain.linearRampToValueAtTime(0.75,t+i*0.12+0.02); g2.gain.exponentialRampToValueAtTime(0.001,t+i*0.12+0.8); o.connect(g2).connect(master); o.start(t+i*0.12); o.stop(t+i*0.12+0.9); });
    }catch{}
  },[]);
  const requestLaunch = useCallback(() => { if (servingRef.current.active) servingRef.current.requested = true; }, []);
  const getInitialSpeed = useCallback(() => 1.5 + settings.ballSpeed * 0.2, [settings.ballSpeed]);
  const stateRef = useRef({
    ball: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    ballTarget: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    paddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 },
    targetPaddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 },
    prevPaddles: { top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, right: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2 },
    last: performance.now(), elapsed: 0, rally: 0, speedMult: 1, countdown: 3, countdownStart: performance.now(), countdownSide: null as Player['side'] | null, effects: [] as { x: number; y: number; born: number; color: string; power: number }[]
  });
  const ballBuffer = useRef<Array<{x:number,y:number,vx:number,vy:number,t:number}>>([]);
  const isOfflineMode = players.length <= 1; // ضد الكمبيوتر = محلي حتى على Render
  const getWorldFromClient = useCallback((clientX:number, clientY:number)=>{
    const arena = arenaRef.current; if(!arena) return {x:world.w/2,y:world.h/2};
    const rect = arena.getBoundingClientRect();
    let wx = ((clientX-rect.left)/rect.width)*world.w;
    let wy = ((clientY-rect.top)/rect.height)*world.h;
    const cos = Math.cos(-myAngle); const sin = Math.sin(-myAngle);
    const dx = wx-world.w/2; const dy = wy-world.h/2;
    return { x: dx*cos - dy*sin + world.w/2, y: dx*sin + dy*cos + world.h/2 };
  }, [world, myAngle]);

  // ===== Render Fix: تجاهل السيرفر في وضع ضد الكمبيوتر =====
  useEffect(() => {
    const handleGameState = (data: any) => {
      if (!data) return;
      if (players.length <= 1) return; // ضد الكمبيوتر = لا تنتظر Render
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
          if (side === mySide) return; // ✅
          const p = data.paddles[side];
          if (stateRef.current.targetPaddles[side as Player['side']]) {
            stateRef.current.targetPaddles[side as Player['side']].x = p.x;
            stateRef.current.targetPaddles[side as Player['side']].y = p.y;
          }
        });
      }
      if (data.countdown !== undefined) { stateRef.current.countdown = data.countdown; setCountdown(data.countdown); }
      if (data.countdownSide !== undefined) { setCountdownSide(data.countdownSide || ''); } // 🔥 جديد
      if (data.rally !== undefined) setRally(data.rally);
    };
    socket.on('game-state', handleGameState);
    return () => { socket.off('game-state', handleGameState); };
  }, [mySide]);

  useEffect(() => {
    const canvas = canvasRef.current; const arena = arenaRef.current; if (!canvas ||!arena) return; const context = canvas.getContext('2d'); if (!context) return; const state = stateRef.current;
    const launchBall = (fromPaddle = false) => {
      const spd = getInitialSpeed() * (state.speedMult || 1); const ang = fromPaddle? (Math.random() - 0.5) * Math.PI * 0.6 : Math.random() * Math.PI * 2;
      if (fromPaddle) { const side = servingRef.current.side; if (side === 'bottom') { state.ball.vx = Math.sin(ang) * spd; state.ball.vy = -Math.abs(Math.cos(ang) * spd) - 1; } else if (side === 'top') { state.ball.vx = Math.sin(ang) * spd; state.ball.vy = Math.abs(Math.cos(ang) * spd) + 1; } else if (side === 'left') { state.ball.vx = Math.abs(Math.cos(ang) * spd) + 1; state.ball.vy = Math.sin(ang) * spd; } else { state.ball.vx = -Math.abs(Math.cos(ang) * spd) - 1; state.ball.vy = Math.sin(ang) * spd; } } else { state.ball.vx = Math.cos(ang) * spd; state.ball.vy = Math.sin(ang) * spd; if (Math.abs(state.ball.vx) < 2) state.ball.vx = state.ball.vx < 0? -2.5 : 2.5; if (Math.abs(state.ball.vy) < 2) state.ball.vy = state.ball.vy < 0? -2.5 : 2.5; }
    };
    // لا نقوم بفيزياء محلية، فقط نعرض الحالة من الخادم
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
      state.countdown = 3; state.countdownStart = performance.now(); state.countdownSide = scorerSide as any; setCountdown(3); setCountdownName(scorer? scorer.name : '');
      state.ball.x = world.w / 2; state.ball.y = world.h / 2; state.ballTarget.x = world.w/2; state.ballTarget.y = world.h/2; state.ball.vx = 0; state.ball.vy = 0; state.rally = 0; setRally(0); state.speedMult = 1; hasDraggedRef.current=false; noDragStartRef.current=performance.now(); if(hintDotRef.current) hintDotRef.current.style.display='none'; if(hintTextRef.current) hintTextRef.current.style.display='none';
    };
    const clamp = (v: number, mn: number, mx: number) => Math.max(mn, Math.min(mx, v));
    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2); state.last = now;
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
        // تحديث مضرب اللاعب محلياً وإرساله للخادم
        if (drag.current.side === mySide) {
          state.targetPaddles[mySide].x = clamp(drag.current.x, 50, world.w - 50);
          if(mySide==='bottom' || mySide==='top'){
            const minY = mySide==='bottom'? world.h - PADDLE_MOVE_ZONE - 60 : 40;
            const maxY = mySide==='bottom'? world.h - 40 : 40 + PADDLE_MOVE_ZONE;
            state.targetPaddles[mySide].y = clamp(drag.current.y, minY, maxY);
          } else {
            state.targetPaddles[mySide].y = clamp(drag.current.y, 50, world.h - 50);
            const minX = mySide==='left'? 40 : world.w - PADDLE_MOVE_ZONE - 60;
            const maxX = mySide==='left'? 40 + PADDLE_MOVE_ZONE : world.w - 40;
            state.targetPaddles[mySide].x = clamp(drag.current.x, minX, maxX);
          }
          // إرسال الموقع إلى الخادم عبر sendPaddleTarget
          socket.sendPaddleTarget(state.targetPaddles[mySide].x, state.targetPaddles[mySide].y);
        }

        // ===== Render Optimized: محلي سريع ضد الكمبيوتر =====
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
          const BALL_R = 14, PADDLE_R = 26, HIT_DIST = BALL_R + PADDLE_R;
          const predX = ball.x + ball.vx * 8;
          const predY = ball.y + ball.vy * 8;
          const diffMax = settings.difficulty === 'easy' ? 1.0 : settings.difficulty === 'hard' ? 3.0 : 2.0;
          const chase = (cur: number, target: number) => {
            const diff = target - cur;
            if (Math.abs(diff) < 1) return cur;
            return cur + Math.max(-diffMax, Math.min(diffMax, diff * 0.12)) * delta;
          };
          (['top','bottom','right','left'] as const).forEach(side => {
            if (!active(side) || side === mySide) return;
            const p = state.paddles[side];
            if (side === 'top' || side === 'bottom') p.x = Math.max(60, Math.min(w - 60, chase(p.x, predX)));
            else p.y = Math.max(60, Math.min(h - 60, chase(p.y, predY)));
            state.targetPaddles[side].x = p.x;
            state.targetPaddles[side].y = p.y;
          });
          ball.x += ball.vx * delta * 0.5;
          ball.y += ball.vy * delta * 0.5;
          (['top','bottom','right','left'] as const).forEach(side => {
            if (!active(side)) return;
            const paddle = state.paddles[side];
            const dx = ball.x - paddle.x, dy = ball.y - paddle.y, d = Math.hypot(dx, dy);
            if (d < HIT_DIST && d > 0.5) {
              const nx = dx / d, ny = dy / d;
              ball.x = paddle.x + nx * (HIT_DIST + 1);
              ball.y = paddle.y + ny * (HIT_DIST + 1);
              const baseSpeed = getInitialSpeed() + state.rally * 0.2;
              if (side === 'bottom') { ball.vy = -Math.abs(baseSpeed); ball.vx = (ball.x - paddle.x) * 0.15; }
              else if (side === 'top') { ball.vy = Math.abs(baseSpeed); ball.vx = (ball.x - paddle.x) * 0.15; }
              else if (side === 'left') { ball.vx = Math.abs(baseSpeed); ball.vy = (ball.y - paddle.y) * 0.15; }
              else { ball.vx = -Math.abs(baseSpeed); ball.vy = (ball.y - paddle.y) * 0.15; }
              state.rally++; setRally(state.rally);
            }
          });
          const goalW = 300;
          const gx1 = (w - goalW) / 2, gx2 = gx1 + goalW, gy1 = (h - goalW) / 2, gy2 = gy1 + goalW;
          if (ball.y < 18) { if (active('top') && ball.x >= gx1 && ball.x <= gx2) { onGoalRef.current(playerForSide('bottom')); resetBall('top'); } else { ball.y = 18; ball.vy = Math.abs(ball.vy); } }
          if (ball.y > h - 18) { if (active('bottom') && ball.x >= gx1 && ball.x <= gx2) { onGoalRef.current(playerForSide('top')); resetBall('bottom'); } else { ball.y = h - 18; ball.vy = -Math.abs(ball.vy); } }
          if (ball.x < 18) { if (active('left') && ball.y >= gy1 && ball.y <= gy2) { onGoalRef.current(playerForSide('right')); resetBall('left'); } else { ball.x = 18; ball.vx = Math.abs(ball.vx); } }
          if (ball.x > w - 18) { if (active('right') && ball.y >= gy1 && ball.y <= gy2) { onGoalRef.current(playerForSide('left')); resetBall('right'); } else { ball.x = w - 18; ball.vx = -Math.abs(ball.vx); } }
          const cur = state.paddles[mySide]; const tgt = state.targetPaddles[mySide];
          cur.x += (tgt.x - cur.x) * 0.5; cur.y += (tgt.y - cur.y) * 0.5;
        } else {
          const nowMs = performance.now();
          // ============================================
          // حركة الكرة بتقسيم الخطوات (Sub-stepping) لمنع الاختراق
          // ============================================
          const SUBSTEPS = 4;
          const stepDelta = delta / SUBSTEPS;

          for (let i = 0; i < SUBSTEPS; i++) {
            state.ball.x += state.ball.vx * stepDelta;
            state.ball.y += state.ball.vy * stepDelta;

            // كشف التصادم مع المضارب في كل خطوة صغيرة
            const HIT_DIST = 40;
            (['top','bottom','right','left'] as const).forEach(side => {
              if (!active(side)) return;
              const paddle = state.paddles[side];
              const dx = state.ball.x - paddle.x;
              const dy = state.ball.y - paddle.y;
              const dist = Math.hypot(dx, dy);

              if (dist < HIT_DIST) {
                const overlap = HIT_DIST - dist;
                state.ball.x += (dx / dist) * overlap;
                state.ball.y += (dy / dist) * overlap;
                // ارتداد خفيف
                state.ball.vx *= -1;
                state.ball.vy *= -1;
              }
            });
          }

          // مزامنة الموقع مع الخادم تدريجياً
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
        if (!hasDraggedRef.current && hintDotRef.current && hintTextRef.current && arenaRef.current) {
          const elapsed = now - noDragStartRef.current;
          if (elapsed > 3000 && state.countdown === 0) {
            const p = state.paddles[mySide];
            const GRAB_OFFSET = 130;
            let hx = p.x, hy = p.y;
            if (mySide === 'bottom') hy = p.y + GRAB_OFFSET;
            else if (mySide === 'top') hy = p.y - GRAB_OFFSET;
            else if (mySide === 'left') hx = p.x - GRAB_OFFSET;
            else hx = p.x + GRAB_OFFSET;
            const cosA = Math.cos(myAngle), sinA = Math.sin(myAngle);
            const dx = hx - world.w / 2, dy = hy - world.h / 2;
            const rx = dx * cosA - dy * sinA + world.w / 2;
            const ry = dx * sinA + dy * cosA + world.h / 2;
            const rect = arenaRef.current.getBoundingClientRect();
            const sx = (rx / world.w) * rect.width;
            const sy = (ry / world.h) * rect.height;
            hintDotRef.current.style.left = `${sx}px`;
            hintDotRef.current.style.top = `${sy}px`;
            hintDotRef.current.style.display = 'block';
            hintTextRef.current.style.left = `${sx + 18}px`;
            hintTextRef.current.style.top = `${sy - 12}px`;
            hintTextRef.current.style.display = 'block';
          }
        }
      }
      // رسم
      draw(context, state, players, now, false, world, myAngle);
      
      // التعديل: إذا كانت اللعبة متوقفة، لا تستمر في تحديث الإطارات للحركة، 
      // بل استمر في الرسم فقط ليبقى المشهد ثابتاً
      if (pausedRef.current || gameEndedRef.current) {
        frame = requestAnimationFrame(tick);
        return;
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
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
    const isTouch = (event as any).pointerType==='touch'; const OFFSET = isTouch? 130 : 50;
    let tx=pt.x, ty=pt.y; if(mySide==='bottom') ty=pt.y-OFFSET; if(mySide==='top') ty=pt.y+OFFSET; if(mySide==='left') tx=pt.x+OFFSET; if(mySide==='right') tx=pt.x-OFFSET;
    hasDraggedRef.current=true; if(hintDotRef.current) hintDotRef.current.style.display='none'; if(hintTextRef.current) hintTextRef.current.style.display='none';
    drag.current = { side: mySide, x: tx, y: ty };
    stateRef.current.targetPaddles[mySide].x = tx; stateRef.current.targetPaddles[mySide].y = ty;
    socket.sendPaddleTarget(tx, ty);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current.side) return;
    const pt = getWorldFromClient(event.clientX, event.clientY);
    const isTouch = (event as any).pointerType==='touch'; const OFFSET = isTouch? 130 : 50;
    let tx=pt.x, ty=pt.y; if(mySide==='bottom') ty=pt.y-OFFSET; if(mySide==='top') ty=pt.y+OFFSET; if(mySide==='left') tx=pt.x+OFFSET; if(mySide==='right') tx=pt.x-OFFSET;
    drag.current.x = tx; drag.current.y = ty;
    stateRef.current.targetPaddles[mySide].x = tx; stateRef.current.targetPaddles[mySide].y = ty;
    socket.sendPaddleTarget(tx, ty);
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
      {/* --- الغاء الزر --- */}
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
    <div
      className="arena-frame"
      ref={arenaRef}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        touchAction: 'none',
        position: 'relative',
        width: `min(95vw, 760px, ${(88 * (world.w / world.h)).toFixed(2)}vh)`,
        aspectRatio: `${world.w} / ${world.h}`,
        margin: '0 auto',
        borderRadius: '32px',
        overflow: 'hidden',
        background: '#000',
        boxShadow: '0 0 0 2px #111, 0 0 40px rgba(0,229,255,0.25)',
      }}
    >
      <canvas ref={canvasRef} style={{ touchAction: 'none', width: '100%', height: '100%' }} />
      <div ref={hintDotRef} style={{ position: 'absolute', width: '14px', height: '14px', borderRadius: '50%', background: '#00e5ff', border: '2px solid #fff', display: 'none', zIndex: 20, pointerEvents: 'none', animation: 'hintPulse 1.2s infinite' }} />
      <div ref={hintTextRef} style={{ position: 'absolute', background: '#00e5ff', color: '#000', padding: '6px 12px', borderRadius: 999, fontSize: '12px', fontWeight: 900, display: 'none', zIndex: 20, pointerEvents: 'none', whiteSpace: 'nowrap' }}>👆 حرك المضرب من هنا</div>
      {/* زر خروج للجوال */}
      <button 
        onClick={() => window.location.reload()} 
        style={{ 
          position: 'absolute', top: 12, left: 12, zIndex: 100, 
          background: 'rgba(255, 45, 45, 0.9)', color: 'white', 
          border: 'none', padding: '8px 12px', borderRadius: 8, 
          fontSize: '12px', fontWeight: 800, cursor: 'pointer' 
        }}
      >
        {isAr ? 'خروج' : 'Exit'}
      </button>


      {countdown > 0 && (
        <div style={{ position: 'absolute', inset: 0, background: countdownSide ? 'rgba(0,0,0,0.75)' : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'none' }}>
          <span style={{ fontSize: '110px', fontWeight: 900, color: '#ff2233', textShadow: '0 0 25px rgba(0,0,0,0.9)' }}>{countdown}</span>
          {countdownSide && (
            <span style={{ background: '#222', color: '#fff', padding: '8px 18px', borderRadius: 999, fontWeight: 800 }}>
              {players.find((p: any) => p.side === countdownSide)?.name || ''} سجل!
            </span>
          )}
        </div>
      )}

      {lastGoal && !celebrating && (
        <div style={{ position: 'absolute', top: '48%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,34,51,0.92)', color: '#fff', padding: '12px 22px', borderRadius: 12, fontWeight: 900, zIndex: 11 }}>
          هدف! {lastGoal}
        </div>
      )}

      {celebrating && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, gap: '8px' }}>
          <div style={{ fontSize: '48px', fontWeight: 900, color: '#ffcf5a', textShadow: '0 0 20px #ffcf5a' }}>
            {celebrating?.name ?? 'لاعب'} {isAr ? 'فاز بالجولة' : 'wins the round'}!
          </div>
          <div style={{ fontSize: '24px', color: '#fff', background: '#222', padding: '8px 24px', borderRadius: '999px' }}>
            {isAr ? 'الجولة' : 'Round'} {currentRound} / {settings.seriesRounds}
          </div>
          <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
            {players.filter(Boolean).map((p: any) => (
              <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.color }} />
                <span>{p.name}</span>
                <strong style={{ color: p.color }}>{(seriesWins[p.id] ?? 0)}</strong>
              </span>
            ))}
          </div>
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
  const active = (side: Player['side']) => { if (players.some((player) => player.side === side)) return true; const count = Math.max(2, players.length || 2); const req = count === 2 ? ['bottom','top'] : ['bottom','top','right','left']; return (req as string[]).includes(side); };
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
