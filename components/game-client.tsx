"use client";

import { useEffect, useMemo, useState } from "react";
import { UNIT_DEFINITIONS } from "@/game/content";
import { applyCommand, createGame, type GameCommand } from "@/game/state";
import type { CombatResult, CombatUnit, OwnedUnit, PrototypeGameState } from "@/game/types";

const CELLS = Array.from({ length: 64 }, (_, index) => ({ x: index % 8, y: Math.floor(index / 8) }));
interface OnlinePlayer {sessionId:string;nickname:string;seat:number;hp:number;wins:number;losses:number;eliminated:boolean}
interface OnlineMeta {phaseEndsAt:string;opponentSessionId:string|null;isGhost:boolean;players:OnlinePlayer[]}

async function postCommand(snapshot: PrototypeGameState, command: GameCommand, endpoint = "/api/game") {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actionId: crypto.randomUUID(), expectedVersion: snapshot.version, command }) });
  const body = await response.json() as { state?: PrototypeGameState; error?: string };
  if (!response.ok && !body.state) throw new Error(body.error ?? "서버 동기화 실패");
  return body;
}

function UnitShape({ unit, selected = false, active = false }: { unit: { baseId: keyof typeof UNIT_DEFINITIONS; starLevel: 1 | 2 | 3 }; selected?: boolean; active?: boolean }) {
  const definition = UNIT_DEFINITIONS[unit.baseId];
  return <div className={`unit-shape shape-${definition.shape} ${selected ? "selected" : ""} ${active ? "attacking" : ""}`} style={{ "--unit-color": definition.color } as React.CSSProperties}><span>{definition.name.slice(0, 1)}</span><i>{"★".repeat(unit.starLevel)}</i></div>;
}

function playbackUnits(combat: CombatResult, atMs: number) {
  const units = structuredClone(combat.initialUnits) as CombatUnit[];
  const byId = new Map(units.map((unit) => [unit.uid, unit]));
  let activeId: string | null = null;
  for (const event of combat.events) {
    if (event.atMs > atMs) break;
    if (event.type === "MOVE") { const unit = byId.get(event.unitId); if (unit) unit.position = { ...event.to }; }
    if (event.type === "DAMAGE") { const unit = byId.get(event.targetId); if (unit) unit.currentHp = event.remainingHp; }
    if (event.type === "MANA_CHANGE") { const unit = byId.get(event.unitId); if (unit) unit.currentMana = event.mana; }
    if (event.type === "SHIELD") { const unit = byId.get(event.targetId); if (unit) unit.shield = event.totalShield; }
    if (event.type === "DEATH") { const unit = byId.get(event.unitId); if (unit) unit.isAlive = false; }
    if (event.type === "ATTACK_START" || event.type === "CAST_START") activeId = event.sourceId;
  }
  return { units, activeId };
}

function BoardUnit({ unit, selected, active, onClick }: { unit: CombatUnit | OwnedUnit; selected?: boolean; active?: boolean; onClick?: () => void }) {
  const combat = "currentHp" in unit; const definition = UNIT_DEFINITIONS[unit.baseId];
  const hp = combat ? Math.max(0, unit.currentHp / unit.stats.maxHp * 100) : 100;
  const mana = combat && unit.stats.maxMana > 0 ? unit.currentMana / unit.stats.maxMana * 100 : 0;
  return <button className={`board-unit ${combat && unit.team === "ENEMY" ? "enemy" : "player"}`} onClick={onClick} aria-label={`${definition.name} ${unit.starLevel}성`}><div className="bars"><span className="hp" style={{ width: `${hp}%` }} />{mana > 0 && <span className="mana" style={{ width: `${mana}%` }} />}</div><UnitShape unit={unit} selected={selected} active={active} /><small>{definition.name}</small></button>;
}

export default function GameClient({ gameKey, roomName, onComplete }: { gameKey?: string; roomName?: string; onComplete?: (game: PrototypeGameState) => Promise<void> }) {
  const endpoint = gameKey ? `/api/online-games/${gameKey}` : "/api/game";
  const [game, setGame] = useState<PrototypeGameState>(() => createGame("prototype-alpha"));
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [message, setMessage] = useState("유닛을 구매한 뒤 벤치에서 선택하세요.");
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState(2);
  const [connection, setConnection] = useState<"LOADING" | "ONLINE" | "OFFLINE">("LOADING");
  const [busy, setBusy] = useState(true);
  const [onlineMeta,setOnlineMeta]=useState<OnlineMeta|null>(null);

  const dispatch = async (command: GameCommand) => {
    if (busy) return;
    if (gameKey && connection !== "ONLINE") { setMessage("서버 연결을 복구한 뒤 다시 시도하세요."); return; }
    const snapshot = game; const result = applyCommand(snapshot, command);
    if (command.type === "START_COMBAT" || command.type === "RESET") setElapsed(0);
    if (result.error) { setMessage(result.error); return; }
    setGame(result.state);
    if (connection === "OFFLINE") { setMessage("로컬 모드에서 진행 중입니다."); return; }
    setBusy(true);
    try { const body = await postCommand(snapshot, command, endpoint); if (body.state) setGame(body.state); setConnection("ONLINE"); }
    catch { setConnection("OFFLINE"); if (gameKey) { setGame(snapshot); setMessage("명령을 저장하지 못해 서버 상태로 되돌렸습니다."); } else setMessage("DB 연결 없이 로컬 모드로 계속합니다."); }
    finally { setBusy(false); }
    if (command.type !== "FINISH_COMBAT") setMessage("명령이 적용되었습니다.");
    if (["MOVE", "BENCH", "SELL"].includes(command.type)) setSelectedUid(null);
  };

  useEffect(() => {
    let cancelled = false;
    void fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("load failed");
      const body = await response.json() as { state: PrototypeGameState;game?:OnlineMeta };
      const loaded = { ...body.state, combatHistory: body.state.combatHistory ?? [] };
      if (gameKey) sessionStorage.setItem("wa_active_game", gameKey);
      if (!cancelled) { setGame(loaded);setOnlineMeta(body.game??null); setConnection("ONLINE"); setBusy(false); }
    }).catch(() => { if (!cancelled) { setConnection("OFFLINE"); setMessage(gameKey?"공용 게임 연결에 실패했습니다. 새로고침해 다시 연결하세요.":"DB 연결 없이 로컬 모드로 계속합니다."); setBusy(false); } });
    return () => { cancelled = true; };
  }, [endpoint, gameKey]);

  useEffect(()=>{if(!gameKey)return;const timer=window.setInterval(()=>{if(document.visibilityState!=="visible")return;void fetch(endpoint,{cache:"no-store"}).then(async(response)=>{if(!response.ok)throw new Error("poll failed");const body=await response.json() as {state:PrototypeGameState;game:OnlineMeta};setGame({...body.state,combatHistory:body.state.combatHistory??[]});setOnlineMeta(body.game);setConnection("ONLINE")}).catch(()=>setConnection("OFFLINE"))},1500);return()=>window.clearInterval(timer)},[endpoint,gameKey]);

  useEffect(() => {
    if (game.phase !== "COMBAT" || !game.combat) return;
    const timer = window.setInterval(() => setElapsed((current) => {
      const next = current + 50 * speed;
      if (next >= game.combat!.durationMs + 450) {
        window.clearInterval(timer);
        if(gameKey)return game.combat!.durationMs+450;
        const command = { type: "FINISH_COMBAT" } as const;
        const result = applyCommand(game, command);
        setGame(result.state);
        if (connection !== "OFFLINE") void postCommand(game, command, endpoint).then((body) => { if (body.state) setGame(body.state); setConnection("ONLINE"); }).catch(() => setConnection("OFFLINE"));
      }
      return next;
    }), 50);
    return () => window.clearInterval(timer);
  }, [game, speed, connection, endpoint, gameKey]);

  const playback = useMemo(() => game.combat ? playbackUnits(game.combat, elapsed) : null, [game.combat, elapsed]);
  const boardOwned = game.units.filter((unit) => unit.location === "BOARD");
  const bench = Array.from({ length: 9 }, (_, slot) => game.units.find((unit) => unit.location === "BENCH" && unit.benchSlot === slot) ?? null);
  const selected = game.units.find((unit) => unit.uid === selectedUid) ?? null;
  const boardUnits = game.phase === "COMBAT" && playback ? playback.units : boardOwned;
  const cellUnit = (x: number, y: number) => boardUnits.find((unit) => unit.position?.x === x && unit.position?.y === y && (!("isAlive" in unit) || unit.isAlive));
  const phaseLabel = { SHOP: "준비", COMBAT: "전투", RESULT: "결과", GAME_OVER: "게임 종료" }[game.phase];
  const currentOpponent=onlineMeta?.players.find((player)=>player.sessionId===onlineMeta.opponentSessionId);

  return <main className="game-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">WA</span><div><strong>WEB AUTOBATTLER</strong><small>{roomName??"SERVERLESS PROTOTYPE"}</small></div></div>
      <div className="round"><small>ROUND</small><strong>{game.round}</strong><span>{phaseLabel}</span></div>
      <div className="resources"><span>❤ <b>{game.hp}</b></span><span>◆ <b>{game.gold}</b></span><span>LV <b>{game.level}</b></span></div>
    </header>

    <section className="arena-layout">
      <aside className="side-panel opponents"><h2>{onlineMeta?"온라인 순위":"전투 기록"}</h2>{onlineMeta?<>{onlineMeta.players.map((player,index)=><div className={`score-card ${player.sessionId===onlineMeta.opponentSessionId?"enemy-score":""} ${player.eliminated?"eliminated":""}`} key={player.sessionId}><span>#{index+1} {player.nickname}{player.sessionId===onlineMeta.opponentSessionId?onlineMeta.isGhost?" · 유령":" · 상대":""}</span><b>{player.wins}승 {player.losses}패</b><em>{player.eliminated?"탈락":`${player.hp} HP`}</em></div>)}{currentOpponent&&<small className="opponent-note">현재 상대: {currentOpponent.nickname}{onlineMeta.isGhost?"의 유령":""}</small>}</>:<><div className="score-card"><span>나</span><b>{game.wins}승 {game.losses}패</b><em>{game.hp} HP</em></div><div className="score-card enemy-score"><span>훈련 봇</span><b>적응형 덱</b><em>{game.enemyHp} HP</em></div></>}<div className="engine-card"><span className={`live-dot ${connection === "OFFLINE" ? "offline" : ""}`} />{connection === "ONLINE" ? "NEON ONLINE" : connection === "LOADING" ? "CONNECTING" : gameKey?"RECONNECTING":"LOCAL FALLBACK"}<small>{game.combat ? `checksum ${game.combat.checksum}` : "결정론적 전투 대기"}</small></div></aside>

      <div className="battle-stage">
        <div className="stage-header"><div><b>{game.phase === "COMBAT" ? `${(Math.min(game.combat?.durationMs ?? 0, elapsed) / 1000).toFixed(1)}s` : `${boardOwned.length} / ${game.level}`}</b><small>{game.phase === "COMBAT" ? "전투 시간" : "배치 유닛"}</small></div>{game.phase === "COMBAT" && <div className="speed-control">속도 {[1, 2, 4].map((value) => <button key={value} className={speed === value ? "active" : ""} onClick={() => setSpeed(value)}>×{value}</button>)}</div>}</div>
        <div className="board-wrap"><div className="board" role="grid" aria-label="8 x 8 전투 보드">{CELLS.map((cell) => { const unit = cellUnit(cell.x, cell.y); const deployable = cell.y >= 4 && game.phase === "SHOP"; return <button key={`${cell.x}-${cell.y}`} className={`cell ${deployable ? "deployable" : "enemy-zone"}`} onClick={() => selectedUid && deployable && dispatch({ type: "MOVE", uid: selectedUid, x: cell.x, y: cell.y })} aria-label={`${cell.x}, ${cell.y} 셀`}>{cell.y === 3 && cell.x === 0 && <span className="zone-label">적 진영</span>}{cell.y === 4 && cell.x === 0 && <span className="zone-label ally">아군 진영</span>}{unit && <BoardUnit unit={unit} selected={unit.uid === selectedUid} active={playback?.activeId === unit.uid} onClick={() => game.phase === "SHOP" && setSelectedUid(unit.uid)} />}</button>; })}</div><div className="board-glow" /></div>
        <div className="message-line">{game.lastResult ?? message}</div>
      </div>

      <aside className="side-panel inspector"><h2>유닛 정보</h2>{selected ? <><div className="portrait"><UnitShape unit={selected} selected /></div><h3>{UNIT_DEFINITIONS[selected.baseId].name} {"★".repeat(selected.starLevel)}</h3><p>{UNIT_DEFINITIONS[selected.baseId].role}</p><dl><div><dt>HP</dt><dd>{UNIT_DEFINITIONS[selected.baseId].stats.maxHp}</dd></div><div><dt>공격력</dt><dd>{UNIT_DEFINITIONS[selected.baseId].stats.attackDamage}</dd></div><div><dt>사거리</dt><dd>{UNIT_DEFINITIONS[selected.baseId].stats.range}</dd></div></dl><strong className="ability">{UNIT_DEFINITIONS[selected.baseId].abilityName}</strong><small>{UNIT_DEFINITIONS[selected.baseId].abilityDescription}</small><div className="inspect-actions"><button onClick={() => dispatch({ type: "BENCH", uid: selected.uid })}>벤치로</button><button className="danger" onClick={() => dispatch({ type: "SELL", uid: selected.uid })}>판매</button></div></> : <p className="empty-copy">유닛을 선택하면 능력치와 스킬을 확인할 수 있습니다.</p>}</aside>
    </section>

    <section className="management">
      <div className="bench-row"><span className="section-label">BENCH</span>{bench.map((unit, slot) => <button key={slot} className={`bench-slot ${unit?.uid === selectedUid ? "selected" : ""}`} onClick={() => unit && setSelectedUid(unit.uid)}>{unit ? <UnitShape unit={unit} selected={unit.uid === selectedUid} /> : <span>{slot + 1}</span>}</button>)}</div>
      <div className="shop-row"><div className="shop-title"><span>상점</span><button disabled={Boolean(gameKey)} title={gameKey?"공유 풀 새로고침 트랜잭션 연결 중":undefined} onClick={() => dispatch({ type: "REROLL" })}>↻ 2</button></div>{game.shop.map((item) => { const def = UNIT_DEFINITIONS[item.baseId]; return <button key={item.slot} disabled={item.purchased || game.phase !== "SHOP"} className="shop-card" onClick={() => dispatch({ type: "BUY", slot: item.slot })}><UnitShape unit={{ baseId: item.baseId, starLevel: 1 }} /><div><strong>{def.name}</strong><small>{def.role}</small></div><b>◆ {def.cost}</b>{item.purchased && <em>구매 완료</em>}</button>; })}</div>
      <div className="primary-actions">{game.phase === "SHOP" && (gameKey?<button className="combat-button" disabled>서버 전투 대기 <span>◷</span></button>:<button className="combat-button" onClick={() => dispatch({ type: "START_COMBAT" })}>전투 시작 <span>▶</span></button>)}{game.phase === "RESULT" && !gameKey&&<button className="combat-button" onClick={() => dispatch({ type: "NEXT_ROUND" })}>다음 라운드 <span>→</span></button>}{game.phase === "GAME_OVER" && <button className="combat-button" onClick={() => onComplete ? void onComplete(game) : void dispatch({ type: "RESET" })}>{onComplete?"기록하고 로비로":game.hp > 0 ? "승리 · 다시 하기" : "패배 · 다시 하기"}</button>}</div>
    </section>
  </main>;
}
