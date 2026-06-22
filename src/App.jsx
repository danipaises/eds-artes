import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Crown, MonitorPlay, Radio, RotateCcw, Trophy, Users, XCircle } from 'lucide-react';
import { QUESTION_BANK } from './questions';
import { resetLocalRooms, saveRoom, subscribeRooms, useLocal } from './sync';
import './styles.css';

const DIFFICULTY_POINTS = { 'Fácil': 10, 'Médio': 15, 'Difícil': 25 };
const QUESTIONS_PER_PLAYER_PER_MATCH = 3;

function normalizeText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function generateRoundRobin(players) {
  const entries = [...players];
  if (entries.length % 2 !== 0) entries.push(null);
  const rounds = [];
  for (let round = 0; round < entries.length - 1; round += 1) {
    const matches = [];
    for (let i = 0; i < entries.length / 2; i += 1) {
      const home = entries[i];
      const away = entries[entries.length - 1 - i];
      if (home && away) matches.push({ id: `${round}-${i}`, homeId: home.id, awayId: away.id, completed: false });
    }
    rounds.push(matches);
    entries.splice(1, 0, entries.pop());
  }
  return rounds;
}

function createQuestionSet() {
  return ['Fácil', 'Médio', 'Difícil'].map((difficulty) => {
    const pool = QUESTION_BANK.filter((question) => question.difficulty === difficulty);
    return pool[Math.floor(Math.random() * pool.length)];
  });
}

function createMatchQuestions(match) {
  return {
    [match.homeId]: createQuestionSet(),
    [match.awayId]: createQuestionSet()
  };
}

function sortStandings(standings) {
  return [...standings].sort((a, b) =>
    b.leaguePoints - a.leaguePoints ||
    (b.quizFor - b.quizAgainst) - (a.quizFor - a.quizAgainst) ||
    b.quizFor - a.quizFor ||
    a.name.localeCompare(b.name, 'pt-BR')
  );
}

function makeRoomId() {
  const saved = sessionStorage.getItem('quiz-room-id');
  if (saved) return saved;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  sessionStorage.setItem('quiz-room-id', id);
  return id;
}

export default function App() {
  const [mode, setMode] = useState('SELECT');
  const [screen, setScreen] = useState('SETUP');
  const [roomId] = useState(makeRoomId);
  const [groupName, setGroupName] = useState('');
  const [players, setPlayers] = useState([
    { id: 'p1', name: '' },
    { id: 'p2', name: '' },
    { id: 'p3', name: '' },
    { id: 'p4', name: '' }
  ]);
  const [rounds, setRounds] = useState([]);
  const [standings, setStandings] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchQuestions, setMatchQuestions] = useState(null);
  const [questionCursor, setQuestionCursor] = useState(0);
  const [matchScores, setMatchScores] = useState({});
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [syncError, setSyncError] = useState('');
  const feedbackTimer = useRef(null);

  const currentMatch = rounds[roundIndex]?.[matchIndex] ?? null;
  const orderedStandings = useMemo(() => sortStandings(standings), [standings]);

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  useEffect(() => {
    if (mode !== 'TV') return undefined;
    return subscribeRooms(setRooms, (error) => setSyncError(error.message || 'Falha na sincronização.'));
  }, [mode]);

  useEffect(() => {
    if (mode !== 'STUDENT' || !['GAME', 'RESULTS'].includes(screen)) return;
    const payload = {
      id: roomId,
      groupName,
      status: screen === 'RESULTS' ? 'finished' : 'playing',
      standings: orderedStandings,
      round: roundIndex + 1,
      totalRounds: rounds.length,
      match: currentMatch ? {
        homeName: standings.find((p) => p.id === currentMatch.homeId)?.name,
        awayName: standings.find((p) => p.id === currentMatch.awayId)?.name,
        homeScore: matchScores[currentMatch.homeId] || 0,
        awayScore: matchScores[currentMatch.awayId] || 0
      } : null
    };
    saveRoom(payload).catch((error) => setSyncError(error.message || 'Falha ao enviar placar.'));
  }, [mode, screen, roomId, groupName, orderedStandings, roundIndex, rounds.length, currentMatch, matchScores, standings]);

  function updatePlayer(index, name) {
    setPlayers((current) => current.map((player, i) => i === index ? { ...player, name } : player));
  }

  function addPlayer() {
    setPlayers((current) => current.length >= 8 ? current : [...current, { id: `p${Date.now()}`, name: '' }]);
  }

  function removePlayer(index) {
    setPlayers((current) => current.length <= 2 ? current : current.filter((_, i) => i !== index));
  }

  function startGroupStage() {
    const validPlayers = players.map((p) => ({ ...p, name: p.name.trim() })).filter((p) => p.name);
    if (!groupName.trim()) return alert('Digite o nome da mesa.');
    if (validPlayers.length < 2) return alert('Adicione pelo menos dois jogadores.');
    const schedule = generateRoundRobin(validPlayers);
    setPlayers(validPlayers);
    setStandings(validPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      leaguePoints: 0,
      quizFor: 0,
      quizAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      played: 0
    })));
    setRounds(schedule);
    setRoundIndex(0);
    setMatchIndex(0);
    setMatchQuestions(createMatchQuestions(schedule[0][0]));
    setQuestionCursor(0);
    setMatchScores({ [schedule[0][0].homeId]: 0, [schedule[0][0].awayId]: 0 });
    setAnswer('');
    setFeedback(null);
    setScreen('GAME');
  }

  function advanceAfterMatch(finalScores) {
    const homeId = currentMatch.homeId;
    const awayId = currentMatch.awayId;
    const homeScore = finalScores[homeId] || 0;
    const awayScore = finalScores[awayId] || 0;
    setStandings((current) => current.map((entry) => {
      if (![homeId, awayId].includes(entry.id)) return entry;
      const isHome = entry.id === homeId;
      const scored = isHome ? homeScore : awayScore;
      const conceded = isHome ? awayScore : homeScore;
      const won = scored > conceded;
      const draw = scored === conceded;
      return {
        ...entry,
        leaguePoints: entry.leaguePoints + (won ? 3 : draw ? 1 : 0),
        quizFor: entry.quizFor + scored,
        quizAgainst: entry.quizAgainst + conceded,
        wins: entry.wins + (won ? 1 : 0),
        draws: entry.draws + (draw ? 1 : 0),
        losses: entry.losses + (!won && !draw ? 1 : 0),
        played: entry.played + 1
      };
    }));

    const isLastMatch = matchIndex === rounds[roundIndex].length - 1;
    const isLastRound = roundIndex === rounds.length - 1;
    if (isLastMatch && isLastRound) {
      setScreen('RESULTS');
      return;
    }
    const nextRound = isLastMatch ? roundIndex + 1 : roundIndex;
    const nextMatch = isLastMatch ? 0 : matchIndex + 1;
    const match = rounds[nextRound][nextMatch];
    setRoundIndex(nextRound);
    setMatchIndex(nextMatch);
    setMatchQuestions(createMatchQuestions(match));
    setQuestionCursor(0);
    setMatchScores({ [match.homeId]: 0, [match.awayId]: 0 });
    setAnswer('');
  }

  function submitAnswer() {
    if (!answer || feedback) return;
    const answeringId = questionCursor < QUESTIONS_PER_PLAYER_PER_MATCH ? currentMatch.homeId : currentMatch.awayId;
    const localQuestionIndex = questionCursor % QUESTIONS_PER_PLAYER_PER_MATCH;
    const question = matchQuestions[answeringId][localQuestionIndex];
    const correct = normalizeText(answer) === normalizeText(question.correct);
    const earned = correct ? DIFFICULTY_POINTS[question.difficulty] : 0;
    const nextScores = {
      ...matchScores,
      [answeringId]: (matchScores[answeringId] || 0) + earned
    };
    setMatchScores(nextScores);
    setFeedback({ correct, correctAnswer: question.correct, earned });
    feedbackTimer.current = setTimeout(() => {
      setFeedback(null);
      setAnswer('');
      if (questionCursor === 5) advanceAfterMatch(nextScores);
      else setQuestionCursor((cursor) => cursor + 1);
    }, 900);
  }

  function restart() {
    setScreen('SETUP');
    setRounds([]);
    setStandings([]);
    setRoundIndex(0);
    setMatchIndex(0);
  }

  if (mode === 'SELECT') {
    return <main className="landing">
      <div className="hero-icon"><Trophy size={76} /></div>
      <h1>Arte, Denúncia & Ambiente</h1>
      <p>Campeonato de quiz em tempo real</p>
      <div className="mode-grid">
        <button className="mode-card blue" onClick={() => setMode('TV')}><MonitorPlay size={52}/><strong>Painel do professor</strong><span>Acompanhar mesas e classificações.</span></button>
        <button className="mode-card green" onClick={() => { setMode('STUDENT'); setScreen('SETUP'); }}><Users size={52}/><strong>Entrar como mesa</strong><span>Configurar alunos e iniciar os confrontos.</span></button>
      </div>
      {useLocal && <small className="test-badge">Modo de teste local ativo</small>}
    </main>;
  }

  if (mode === 'TV') {
    return <main className="teacher-page">
      <header className="topbar"><div><h1>Central do campeonato</h1><span className="online"><Radio size={15}/> AO VIVO</span></div><button className="secondary" onClick={() => setMode('SELECT')}>Voltar</button></header>
      {syncError && <div className="error-banner">{syncError}</div>}
      {useLocal && <button className="secondary reset-test" onClick={resetLocalRooms}><RotateCcw size={16}/> Limpar teste</button>}
      <section className="room-grid">
        {!rooms.length && <div className="empty"><MonitorPlay size={84}/><h2>Aguardando mesas...</h2></div>}
        {rooms.map((room) => <article className="room-card" key={room.id} data-testid={`teacher-room-${room.groupName}`}>
          <div className="room-heading"><h2>{room.groupName}</h2><span className={room.status}>{room.status === 'finished' ? 'Finalizado' : 'Jogando'}</span></div>
          {room.match && room.status !== 'finished' && <div className="live-match"><strong>Rodada {room.round}/{room.totalRounds}</strong><span>{room.match.homeName} {room.match.homeScore} × {room.match.awayScore} {room.match.awayName}</span></div>}
          <Standings standings={room.standings || []}/>
        </article>)}
      </section>
    </main>;
  }

  if (screen === 'SETUP') {
    return <main className="setup-page"><section className="panel setup-panel">
      <div className="panel-title"><div><h1>Configurar mesa</h1><p>Com quatro jogadores, todos se enfrentam em exatamente três rodadas.</p></div><button className="secondary" onClick={() => setMode('SELECT')}>Voltar</button></div>
      <label>Nome da mesa<input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Ex.: Mesa 1" data-testid="group-name"/></label>
      <div className="rules"><strong>Regras</strong><span>3 perguntas por jogador em cada confronto</span><span>Vitória: 3 pts · Empate: 1 pt · Derrota: 0 pt</span><span>Desempate: saldo de pontos do quiz</span></div>
      <div className="players-heading"><h2>Jogadores</h2><button className="secondary" onClick={addPlayer}>+ Adicionar</button></div>
      <div className="player-inputs">{players.map((player, index) => <div className="player-row" key={player.id}><b>{index + 1}</b><input value={player.name} onChange={(e) => updatePlayer(index, e.target.value)} placeholder={`Jogador ${index + 1}`} data-testid={`player-${index}`}/><button aria-label="Remover" onClick={() => removePlayer(index)}><XCircle/></button></div>)}</div>
      <button className="primary start" onClick={startGroupStage} data-testid="start-game">Começar fase de grupos</button>
    </section></main>;
  }

  if (screen === 'RESULTS') {
    return <main className="results-page"><section className="panel results-panel"><Trophy size={74}/><h1>Fim da fase de grupos</h1><p>Os dois primeiros estão classificados.</p><Standings standings={orderedStandings} highlightTopTwo/><button className="primary" onClick={restart}>Nova fase</button></section></main>;
  }

  const answeringId = questionCursor < 3 ? currentMatch.homeId : currentMatch.awayId;
  const localQuestionIndex = questionCursor % 3;
  const question = matchQuestions?.[answeringId]?.[localQuestionIndex];
  const home = standings.find((p) => p.id === currentMatch.homeId);
  const away = standings.find((p) => p.id === currentMatch.awayId);
  const answering = standings.find((p) => p.id === answeringId);

  return <main className="game-page">
    <header className="topbar"><div><h1>{groupName}</h1><span className="online"><Radio size={15}/> Sincronizado</span></div><div className="round-label">Rodada {roundIndex + 1}/{rounds.length} · Partida {matchIndex + 1}/{rounds[roundIndex].length}</div></header>
    {syncError && <div className="error-banner">{syncError}</div>}
    <div className="game-layout">
      <aside><h2>Classificação</h2><Standings standings={orderedStandings}/></aside>
      <section className="quiz-panel">
        <div className="versus"><div><strong>{home.name}</strong><b>{matchScores[home.id] || 0}</b></div><span>×</span><div><b>{matchScores[away.id] || 0}</b><strong>{away.name}</strong></div></div>
        <div className="turn">Vez de <strong>{answering.name}</strong> · Pergunta {localQuestionIndex + 1}/3</div>
        <div className={`difficulty ${question.difficulty.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`}>{question.difficulty} · {DIFFICULTY_POINTS[question.difficulty]} pontos</div>
        <h2 className="question">{question.text}</h2>
        <AnswerArea question={question} answer={answer} setAnswer={setAnswer} disabled={Boolean(feedback)} submit={submitAnswer}/>
        {feedback && <div className={`feedback ${feedback.correct ? 'correct' : 'wrong'}`}>{feedback.correct ? <><CheckCircle2/> Correto! +{feedback.earned}</> : <><XCircle/> Incorreto. Resposta: {feedback.correctAnswer}</>}</div>}
      </section>
    </div>
  </main>;
}

function AnswerArea({ question, answer, setAnswer, disabled, submit }) {
  if (question.type === 'text_input') return <div className="text-answer"><input autoFocus value={answer} disabled={disabled} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Digite a resposta" data-testid="text-answer"/><button className="primary" disabled={!answer || disabled} onClick={submit}>Confirmar</button></div>;
  return <div className={`answers ${question.options.length === 2 ? 'two' : ''}`}>{question.options.map((option, index) => <button key={option} disabled={disabled} className={answer === option ? 'selected' : ''} onClick={() => setAnswer(option)} onDoubleClick={() => { setAnswer(option); }} data-testid={`option-${index}`}><span>{question.options.length > 2 ? `${String.fromCharCode(65 + index)}.` : ''}</span>{option}</button>)}<button className="primary confirm" disabled={!answer || disabled} onClick={submit} data-testid="confirm-answer">Confirmar resposta</button></div>;
}

function Standings({ standings, highlightTopTwo = false }) {
  const sorted = sortStandings(standings);
  return <div className="standings"><div className="standing header"><span>#</span><span>Jogador</span><span>J</span><span>PTS</span><span>SP</span></div>{sorted.map((entry, index) => <div className={`standing ${highlightTopTwo && index < 2 ? 'qualified' : ''}`} key={entry.id}><span>{index + 1}{index < 2 && highlightTopTwo ? <Crown size={13}/> : null}</span><strong>{entry.name}</strong><span>{entry.played}</span><b>{entry.leaguePoints}</b><span>{entry.quizFor - entry.quizAgainst > 0 ? '+' : ''}{entry.quizFor - entry.quizAgainst}</span></div>)}</div>;
}
