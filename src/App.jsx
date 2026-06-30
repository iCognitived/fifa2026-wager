import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

// ─── Constants ───────────────────────────────────────────────────────────────
// NOTE: API_KEY here is unused now that fixtures are fetched via the
// Vercel serverless proxy at /api/fixtures (football-data.org), which
// injects its own auth token server-side. Safe to remove once confirmed.
const POLL_MS_LIVE       = 60000;   // 60s while matches are live
const POLL_MS_IDLE       = 300000;  // 5min idle
const POLL_MS_STATIC     = 600000;  // 10min for static fixture list
const TOURNAMENT_START   = new Date("2026-06-11T20:00:00-04:00");
const FIRESTORE_DOC      = "shared/fifa2026";

// ─── Fixed team allocation ────────────────────────────────────────────────────
const SPLIT = {
  akshika: {
    elite: ["Argentina","England","Germany","Netherlands","Uruguay","Morocco"],
    mid:   ["USA","Japan","Switzerland","Austria","Egypt","Senegal","Algeria","Australia","Canada"],
    low:   ["Iran","Costa Rica","Chile","Panama","Jamaica","Qatar","South Africa","Bolivia","Honduras"]
  },
  varun: {
    elite: ["Brazil","France","Spain","Portugal","Belgium","Croatia"],
    mid:   ["Mexico","Colombia","Ecuador","Turkey","Ukraine","Denmark","South Korea","Nigeria","Ghana","Norway"],
    low:   ["Poland","Paraguay","Peru","Cameroon","DR Congo","Saudi Arabia","Venezuela","Tunisia","Trinidad & Tobago"]
  }
};

const TIER_META = {
  elite: { label: "👑 Elite",    color: "#ff4d4d", bg: "#ff4d4d15" },
  mid:   { label: "⚡ Mid Tier", color: "#f5c518", bg: "#f5c51815" },
  low:   { label: "🌍 Low Tier", color: "#81c784", bg: "#81c78415" }
};

const MATCH_STAGES = {
  "Group Stage":    { wager: 500,  color: "#81c784" },
  "Round of 16":    { wager: 1000, color: "#4fc3f7" },
  "Quarter-finals": { wager: 2000, color: "#f5c518" },
  "Semi-finals":    { wager: 2500, color: "#ff9900" },
  "Final":          { wager: 3000, color: "#ff4d4d" },
};

// ─── Name normalization (football-data.org uses different naming than API-Football) ──
const NAME_ALIASES = {
  "united states": "USA",
  "united states of america": "USA",
  "usa": "USA",
  "korea republic": "South Korea",
  "republic of korea": "South Korea",
  "ivory coast": "Côte d'Ivoire",
  "cote d'ivoire": "Côte d'Ivoire",
  "dr congo": "DR Congo",
  "congo dr": "DR Congo",
  "democratic republic of the congo": "DR Congo",
  "trinidad and tobago": "Trinidad & Tobago",
  "bosnia and herzegovina": "Bosnia & Herzegovina",
};

function normalizeName(name = "") {
  const key = name.trim().toLowerCase();
  return NAME_ALIASES[key] || name.trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getOwner(teamName) {
  const n = normalizeName(teamName).toLowerCase();
  for (const tier of ["elite","mid","low"]) {
    if (SPLIT.akshika[tier].some(t => n.includes(t.toLowerCase()) || t.toLowerCase().includes(n))) return "Akshika";
    if (SPLIT.varun[tier].some(t   => n.includes(t.toLowerCase()) || t.toLowerCase().includes(n))) return "Varun";
  }
  return null;
}

function getTeamTier(teamName) {
  const n = normalizeName(teamName).toLowerCase();
  for (const tier of ["elite","mid","low"]) {
    if (SPLIT.akshika[tier].some(t => t.toLowerCase() === n)) return tier;
    if (SPLIT.varun[tier].some(t   => t.toLowerCase() === n)) return tier;
  }
  return null;
}

// football-data.org v4 uses `stage` (e.g. "GROUP_STAGE", "ROUND_OF_16",
// "QUARTER_FINALS", "SEMI_FINALS", "FINAL") rather than a free-text "round" string.
function stageFromApiStage(stage = "") {
  const s = stage.toUpperCase();
  if (s === "FINAL")          return "Final";
  if (s.includes("SEMI"))     return "Semi-finals";
  if (s.includes("QUARTER"))  return "Quarter-finals";
  if (s.includes("16"))       return "Round of 16";
  return "Group Stage";
}

// ─── Countdown hook ───────────────────────────────────────────────────────────
function useCountdown() {
  const [t, setT] = useState(null);
  useEffect(() => {
    const tick = () => {
      const diff = TOURNAMENT_START - Date.now();
      if (diff <= 0) return setT(null);
      setT({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000)  / 60000),
        s: Math.floor((diff % 60000)    / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

// ─── Countdown component ──────────────────────────────────────────────────────
function Countdown() {
  const t = useCountdown();
  if (!t) return null;
  return (
    <div style={{ textAlign:"center", padding:"40px 16px 32px" }}>
      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"#555", letterSpacing:3, marginBottom:20 }}>
        TOURNAMENT STARTS IN
      </div>
      <div style={{ display:"flex", justifyContent:"center", gap:10, flexWrap:"wrap" }}>
        {[["DAYS",t.d],["HRS",t.h],["MIN",t.m],["SEC",t.s]].map(([label,val]) => (
          <div key={label} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"14px 18px", minWidth:68, textAlign:"center" }}>
            <div style={{ fontSize:34, letterSpacing:2, color:"#ff4d4d", lineHeight:1 }}>{String(val).padStart(2,"0")}</div>
            <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color:"#555", letterSpacing:2, marginTop:5 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"#444", marginTop:18 }}>
        📅 Opening match · June 11, 2026 · Toronto
      </div>
      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"#444", marginTop:5 }}>
        Live scores will auto-populate once the tournament begins ⚽
      </div>
      <div style={{ marginTop:28, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:"16px 20px", maxWidth:320, margin:"28px auto 0" }}>
        <div style={{ fontSize:14, letterSpacing:2, marginBottom:10, color:"#888" }}>WAGER AT STAKE</div>
        {Object.entries(MATCH_STAGES).map(([stage,meta]) => (
          <div key={stage} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.04)", fontFamily:"'Inter',sans-serif", fontSize:12 }}>
            <span style={{ color:meta.color }}>{stage}</span>
            <span style={{ color:"#555" }}>₹{meta.wager.toLocaleString()} / match</span>
          </div>
        ))}
        <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#444", marginTop:10, textAlign:"center" }}>Net settlement after the Final · July 19, 2026</div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]                 = useState("teams");
  const [liveMatches, setLiveMatches] = useState([]);
  const [allFixtures, setAllFixtures] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [fetchStatus, setFetchStatus] = useState("idle");
  const [syncStatus, setSyncStatus]   = useState("connecting"); // connecting | live | error
  const [lastSync, setLastSync]       = useState(null);
  const pollRef  = useRef(null);
  const isSaving = useRef(false);

  // ── Firebase real-time listener ──
  useEffect(() => {
    setSyncStatus("connecting");
    const ref = doc(db, "shared", "fifa2026");
    const unsub = onSnapshot(ref,
      (snap) => {
        setSyncStatus("live");
        setLastSync(new Date());
        // State is fixed (teams don't change), just use snapshot for future extensibility
      },
      (err) => {
        console.error("Firestore error:", err);
        setSyncStatus("error");
      }
    );
    return () => unsub();
  }, []);

  // ── Ping Firestore to record last-seen (so both users see activity) ──
  useEffect(() => {
    if (syncStatus !== "live") return;
    const ref = doc(db, "shared", "fifa2026");
    setDoc(ref, { lastSeen: new Date().toISOString(), app: "fifa2026-wager" }, { merge: true })
      .catch(console.error);
  }, [syncStatus]);

  // ── API fixture fetch ──
  // Calls our own Vercel serverless proxy (api/fixtures.js), which talks to
  // football-data.org server-side (avoids CORS + hides the auth token).
  // The proxy requires a `type` query param: live | upcoming | finished
  // Each call returns the raw football-data.org payload: { matches: [...] }
  const fetchFixtures = useCallback(async () => {
    setFetchStatus("loading");
    try {
      const [liveRes, finRes] = await Promise.all([
        fetch(`/api/fixtures?type=live`),
        fetch(`/api/fixtures?type=finished`)
      ]);
      if (!liveRes.ok) throw new Error(`Proxy (live) returned ${liveRes.status}`);
      if (!finRes.ok)  throw new Error(`Proxy (finished) returned ${finRes.status}`);

      const liveData = await liveRes.json();
      const finData  = await finRes.json();

      const live     = liveData.matches || [];
      const finished = finData.matches  || [];

      setLiveMatches(live);
      setAllFixtures([...live, ...finished]);
      setLastUpdated(new Date());
      setFetchStatus("ok");
    } catch (err) {
      console.error("Fixture fetch error:", err);
      setFetchStatus("error");
    }
  }, []);

  // ── Smart polling: faster while matches are live, slower when idle ──
  useEffect(() => {
    fetchFixtures();
    return () => clearInterval(pollRef.current);
  }, [fetchFixtures]);

  useEffect(() => {
    clearInterval(pollRef.current);
    const interval = liveMatches.length > 0
      ? POLL_MS_LIVE
      : (allFixtures.length > 0 ? POLL_MS_IDLE : POLL_MS_STATIC);
    pollRef.current = setInterval(fetchFixtures, interval);
    return () => clearInterval(pollRef.current);
  }, [liveMatches.length, allFixtures.length, fetchFixtures]);

  // ── Derive wager results from API data ──
  // football-data.org v4 match shape (relevant fields):
  //   m.id
  //   m.stage              → "GROUP_STAGE" | "ROUND_OF_16" | "QUARTER_FINALS" | "SEMI_FINALS" | "FINAL" | ...
  //   m.status              → "FINISHED" | "LIVE" | "IN_PLAY" | "PAUSED" | "SCHEDULED" | "TIMED" | "POSTPONED" | ...
  //   m.homeTeam.name / m.awayTeam.name
  //   m.score.winner         → "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null   (works for regulation, AET, AND penalties)
  //   m.score.duration        → "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT"
  //   m.score.fullTime.{home,away}
  //   m.score.penalties.{home,away}   (present only if duration === "PENALTY_SHOOTOUT")
  const matchResults = {};
  let finalPlayed = false;

  allFixtures.forEach(m => {
    // Only process matches that are actually finished
    if (m.status !== "FINISHED") return;

    const home      = m.homeTeam?.name || "";
    const away      = m.awayTeam?.name || "";
    const id        = String(m.id);
    const stageKey  = stageFromApiStage(m.stage);
    const wager     = MATCH_STAGES[stageKey]?.wager || 500;
    const homeOwner = getOwner(home);
    const awayOwner = getOwner(away);

    // Only process matches where at least one team is owned
    if (!homeOwner && !awayOwner) return;

    // ── Winner detection — covers regulation, extra time, AND penalty shootouts ──
    const scoreWinner = m.score?.winner; // 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
    const homeWon = scoreWinner === "HOME_TEAM";
    const awayWon = scoreWinner === "AWAY_TEAM";
    const winner  = homeWon ? home : awayWon ? away : null;
    const loser   = homeWon ? away : awayWon ? home : null;
    const decidedByPSO = m.score?.duration === "PENALTY_SHOOTOUT";
    const decidedByAET = m.score?.duration === "EXTRA_TIME";

    if (stageKey === "Final" && winner) finalPlayed = true;

    // ── Both teams owned by same person → they win full wager regardless ──
    if (homeOwner && awayOwner && homeOwner === awayOwner) {
      matchResults[id] = {
        owner: homeOwner,
        stage: stageKey, home, away,
        winnerTeam: winner || "TBD",
        loserTeam:  loser  || "TBD",
        wager,
        bothOwned: true,
        decidedByPSO, decidedByAET,
        note: `${homeOwner} owns both — wins ₹${wager.toLocaleString()} regardless`
      };
      return;
    }

    // ── Normal match — only credit once result is in ──
    // (winner can be null on a true draw in group stage — that's fine, no wager)
    if (!winner) return;
    const winOwner = getOwner(winner);
    if (winOwner) {
      matchResults[id] = {
        owner: winOwner,
        stage: stageKey, home, away,
        winnerTeam: winner,
        loserTeam:  loser || "",
        wager,
        bothOwned: false,
        decidedByPSO, decidedByAET,
        note: null
      };
    }
  });

  // Net settlement: each win adds that wager to your side
  // At the end, loser pays winner the difference
  let akTotal = 0, vaTotal = 0;
  Object.values(matchResults).forEach(r => {
    if (r.owner === "Akshika") akTotal += r.wager;
    if (r.owner === "Varun")   vaTotal += r.wager;
  });
  const netAmount    = Math.abs(akTotal - vaTotal);
  const leadingPlayer = akTotal > vaTotal ? "Akshika" : vaTotal > akTotal ? "Varun" : null;
  const trailingPlayer = leadingPlayer === "Akshika" ? "Varun" : leadingPlayer === "Varun" ? "Akshika" : null;

  const beforeStart = Date.now() < TOURNAMENT_START;
  const tabs = [["teams","👥 TEAMS"],["live","🔴 LIVE"],["results","✅ RESULTS"],["summary","📊 SUMMARY"]];

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#080810 0%,#0d1520 60%,#080810 100%)", fontFamily:"'Bebas Neue','Impact',sans-serif", color:"#fff", overflowX:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@300;400;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#080810}
        ::-webkit-scrollbar{width:4px;background:#111}
        ::-webkit-scrollbar-thumb{background:#ff4d4d44;border-radius:2px}
        .tab-btn{background:none;border:none;cursor:pointer;transition:all 0.2s}
        .tab-btn:hover{opacity:0.8}
        .team-chip{display:inline-block;padding:4px 10px;border-radius:20px;font-family:'Inter',sans-serif;font-size:12px;margin:3px;cursor:default;transition:transform 0.15s}
        .team-chip:hover{transform:scale(1.05)}
        .fade-in{animation:fadeIn 0.4s ease}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .live-dot{width:8px;height:8px;border-radius:50%;background:#ff4d4d;display:inline-block;animation:blink 1.2s infinite}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
        .sync-dot{width:7px;height:7px;border-radius:50%;display:inline-block}
        .match-card{border-radius:10px;padding:13px 15px;margin-bottom:8px;transition:transform 0.15s}
        .match-card:hover{transform:translateY(-1px)}
        .pill{border-radius:6px;padding:2px 8px;font-family:'Inter',sans-serif;font-size:11px;font-weight:600}
      `}</style>

      {/* ── Header ── */}
      <div style={{ background:"linear-gradient(90deg,#ff4d4d1a,#f5c5181a,#ff4d4d1a)", borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"16px 20px", textAlign:"center" }}>
        <div style={{ fontSize:38, letterSpacing:5 }}>⚽ FIFA 2026</div>
        <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#555", letterSpacing:2, marginTop:2, display:"flex", alignItems:"center", justifyContent:"center", gap:12, flexWrap:"wrap" }}>
          <span>AKSHIKA vs VARUN · 🔒 LOCKED</span>
          <span style={{ display:"flex", alignItems:"center", gap:5 }}>
            <span className="sync-dot" style={{ background: syncStatus==="live"?"#81c784": syncStatus==="connecting"?"#f5c518":"#ff4d4d" }}/>
            <span style={{ color: syncStatus==="live"?"#81c784": syncStatus==="connecting"?"#f5c518":"#ff4d4d", fontSize:10 }}>
              {syncStatus==="live"?"FIREBASE LIVE": syncStatus==="connecting"?"CONNECTING…":"SYNC ERROR"}
            </span>
          </span>
        </div>
        {lastSync && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color:"#333", marginTop:3 }}>Last sync {lastSync.toLocaleTimeString()}</div>}

        {/* Score strip */}
        <div style={{ marginTop:14, display:"flex", justifyContent:"center", gap:20, flexWrap:"wrap", alignItems:"center" }}>
          <ScorePill name="Akshika" total={akTotal} color="#ff9fd2" leading={leadingPlayer==="Akshika"} />
          <div style={{ textAlign:"center" }}>
            {fetchStatus==="ok" && (
              <div style={{ display:"flex", alignItems:"center", gap:5, justifyContent:"center", fontFamily:"'Inter',sans-serif", fontSize:11, color:"#81c784" }}>
                <span className="live-dot"/> API LIVE
              </div>
            )}
            {fetchStatus==="loading" && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#f5c518" }}>↻ FETCHING</div>}
            {fetchStatus==="error"   && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#ff6b6b" }}>⚠ API ERR</div>}
            {lastUpdated && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color:"#333", marginTop:2 }}>{lastUpdated.toLocaleTimeString()}</div>}
            {/* Net settlement badge */}
            {netAmount > 0 && (
              <div style={{ marginTop:6, fontFamily:"'Inter',sans-serif", fontSize:11, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:20, padding:"3px 10px", color:"#fff" }}>
                {finalPlayed
                  ? <span>🏆 <span style={{ color: leadingPlayer==="Akshika"?"#ff9fd2":"#4fc3f7" }}>{trailingPlayer}</span> owes <span style={{ color:"#81c784" }}>₹{netAmount.toLocaleString()}</span></span>
                  : <span><span style={{ color: leadingPlayer==="Akshika"?"#ff9fd2":"#4fc3f7" }}>{leadingPlayer}</span> leads by <span style={{ color:"#f5c518" }}>₹{netAmount.toLocaleString()}</span></span>
                }
              </div>
            )}
          </div>
          <ScorePill name="Varun" total={vaTotal} color="#4fc3f7" leading={leadingPlayer==="Varun"} />
        </div>
      </div>

      <div style={{ maxWidth:720, margin:"0 auto", padding:"16px 14px" }}>

        {/* ── Tabs ── */}
        <div style={{ display:"flex", gap:7, marginBottom:16 }}>
          {tabs.map(([t,label]) => (
            <button key={t} className="tab-btn" onClick={() => setTab(t)}
              style={{ flex:1, padding:"9px 4px", borderRadius:8, letterSpacing:1, fontSize:11,
                background: tab===t ? "#ff4d4d" : "rgba(255,255,255,0.05)",
                border:     tab===t ? "none"     : "1px solid rgba(255,255,255,0.08)",
                color:      tab===t ? "#fff"     : "#777" }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── TEAMS TAB ── */}
        {tab==="teams" && (
          <div className="fade-in">
            <div style={{ background:"rgba(255,77,77,0.06)", border:"1px solid rgba(255,77,77,0.15)", borderRadius:10, padding:"9px 14px", marginBottom:16, fontFamily:"'Inter',sans-serif", fontSize:12, color:"#ff8080", textAlign:"center" }}>
              🔒 Teams are fixed — synced live via Firebase
            </div>
            {/* Allocation summary */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
              {[{name:"Akshika",color:"#ff9fd2",key:"akshika"},{name:"Varun",color:"#4fc3f7",key:"varun"}].map(p => (
                <div key={p.name} style={{ background:`${p.color}0c`, border:`1px solid ${p.color}22`, borderRadius:10, padding:14, textAlign:"center" }}>
                  <div style={{ fontSize:20, color:p.color, letterSpacing:2, marginBottom:8 }}>{p.name}</div>
                  {["elite","mid","low"].map(t => (
                    <div key={t} style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:TIER_META[t].color, marginTop:3 }}>
                      {TIER_META[t].label}: {SPLIT[p.key][t].length} teams
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {/* Teams by tier */}
            {["elite","mid","low"].map(tier => (
              <div key={tier} style={{ marginBottom:16 }}>
                <div style={{ fontSize:16, letterSpacing:2, color:TIER_META[tier].color, marginBottom:8, borderBottom:`1px solid ${TIER_META[tier].color}22`, paddingBottom:6 }}>
                  {TIER_META[tier].label}
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  {[{name:"Akshika",color:"#ff9fd2",key:"akshika"},{name:"Varun",color:"#4fc3f7",key:"varun"}].map(p => (
                    <div key={p.name} style={{ background:`${p.color}0a`, border:`1px solid ${p.color}18`, borderRadius:10, padding:12 }}>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:p.color, fontWeight:600, marginBottom:8 }}>{p.name}</div>
                      <div>
                        {SPLIT[p.key][tier].map(tm => (
                          <span key={tm} className="team-chip" style={{ background:TIER_META[tier].bg, color:TIER_META[tier].color, border:`1px solid ${TIER_META[tier].color}22` }}>{tm}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── LIVE TAB ── */}
        {tab==="live" && (
          <div className="fade-in">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontSize:16, letterSpacing:2 }}>🔴 LIVE MATCHES</div>
              <button onClick={fetchFixtures} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#aaa", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:12 }}>↻ Refresh</button>
            </div>
            {liveMatches.length === 0 ? (
              beforeStart ? <Countdown /> :
              <div style={{ textAlign:"center", padding:"50px 20px", fontFamily:"'Inter',sans-serif", color:"#444", fontSize:14 }}>
                {fetchStatus==="loading" ? "Fetching live matches…" : "No live matches right now — check back soon"}
              </div>
            ) : liveMatches.map(m => {
              const home = m.homeTeam?.name || "?";
              const away = m.awayTeam?.name || "?";
              const hg   = m.score?.fullTime?.home ?? "-";
              const ag   = m.score?.fullTime?.away ?? "-";
              const min  = m.minute;
              return (
                <div key={m.id} className="match-card" style={{ background:"rgba(255,77,77,0.05)", border:"1px solid rgba(255,77,77,0.18)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                    <TeamBlock name={home} align="left"  />
                    <div style={{ textAlign:"center", minWidth:72 }}>
                      <div style={{ fontSize:26, letterSpacing:3, color:"#fff" }}>{hg}:{ag}</div>
                      {min && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#ff4d4d", marginTop:2 }}>{min}'</div>}
                    </div>
                    <TeamBlock name={away} align="right" />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── RESULTS TAB ── */}
        {tab==="results" && (
          <div className="fade-in">
            <div style={{ fontSize:16, letterSpacing:2, marginBottom:12 }}>✅ COMPLETED MATCHES</div>
            {Object.keys(matchResults).length === 0 ? (
              beforeStart ? <Countdown /> :
              <div style={{ textAlign:"center", padding:"50px 20px", fontFamily:"'Inter',sans-serif", color:"#444", fontSize:14 }}>
                {fetchStatus==="loading" ? "Loading results…" : "No completed matches yet"}
              </div>
            ) : Object.entries(matchResults).map(([id,r]) => {
              const isAk      = r.owner === "Akshika";
              const stageMeta = MATCH_STAGES[r.stage] || MATCH_STAGES["Group Stage"];
              return (
                <div key={id} className="match-card" style={{ background: isAk ? "rgba(255,159,210,0.05)" : "rgba(79,195,247,0.05)", border:`1px solid ${isAk?"#ff9fd2":"#4fc3f7"}22` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                    <div>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"#fff", fontWeight:600 }}>{r.home} vs {r.away}</div>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#555", marginTop:3, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                        <span style={{ color:stageMeta.color }}>{r.stage}</span>
                        {r.decidedByPSO && <span style={{ background:"rgba(245,197,24,0.12)", color:"#f5c518", border:"1px solid rgba(245,197,24,0.25)", borderRadius:4, padding:"1px 6px" }}>PSO</span>}
                        {r.decidedByAET && <span style={{ background:"rgba(79,195,247,0.12)", color:"#4fc3f7", border:"1px solid rgba(79,195,247,0.25)", borderRadius:4, padding:"1px 6px" }}>AET</span>}
                        {r.bothOwned
                          ? <span style={{ background:"rgba(245,197,24,0.12)", color:"#f5c518", border:"1px solid rgba(245,197,24,0.25)", borderRadius:4, padding:"1px 6px" }}>⚡ Both owned by {r.owner}</span>
                          : <span>Winner: <span style={{ color: isAk?"#ff9fd2":"#4fc3f7", fontWeight:600 }}>{r.winnerTeam}</span></span>
                        }
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color: isAk?"#ff9fd2":"#4fc3f7", fontWeight:600 }}>{r.owner}</div>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:14, color:"#81c784", fontWeight:600 }}>+₹{r.wager.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── SUMMARY TAB ── */}
        {tab==="summary" && (
          <div className="fade-in">

            {/* Settlement banner */}
            <div style={{ borderRadius:12, padding:"18px 20px", marginBottom:14, textAlign:"center",
              background: finalPlayed ? "rgba(129,199,132,0.08)" : "rgba(245,197,24,0.06)",
              border: `1px solid ${finalPlayed ? "rgba(129,199,132,0.25)" : "rgba(245,197,24,0.2)"}` }}>
              {finalPlayed ? (
                <>
                  <div style={{ fontSize:22, letterSpacing:2, color:"#81c784", marginBottom:6 }}>🏆 TOURNAMENT OVER</div>
                  <div style={{ fontFamily:"'Inter',sans-serif", fontSize:14, color:"#fff" }}>
                    <span style={{ color: leadingPlayer==="Akshika"?"#ff9fd2":"#4fc3f7", fontWeight:700 }}>{trailingPlayer}</span>
                    {" pays "}
                    <span style={{ color: leadingPlayer==="Akshika"?"#ff9fd2":"#4fc3f7", fontWeight:700 }}>{leadingPlayer}</span>
                  </div>
                  <div style={{ fontSize:36, letterSpacing:2, color:"#81c784", marginTop:8 }}>₹{netAmount.toLocaleString()}</div>
                  <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#555", marginTop:4 }}>
                    {leadingPlayer} won ₹{(leadingPlayer==="Akshika"?akTotal:vaTotal).toLocaleString()} · {trailingPlayer} won ₹{(trailingPlayer==="Akshika"?akTotal:vaTotal).toLocaleString()} · net difference = ₹{netAmount.toLocaleString()}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize:16, letterSpacing:2, color:"#f5c518", marginBottom:6 }}>
                    {leadingPlayer ? `${leadingPlayer} LEADS` : "ALL SQUARE"}
                  </div>
                  <div style={{ fontSize:30, letterSpacing:2, color: leadingPlayer==="Akshika"?"#ff9fd2":leadingPlayer==="Varun"?"#4fc3f7":"#fff" }}>
                    {netAmount > 0 ? `₹${netAmount.toLocaleString()}` : "₹0"}
                  </div>
                  <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#555", marginTop:6 }}>
                    Running tally · winner declared after the Final
                  </div>
                </>
              )}
            </div>

            {/* Per-player totals */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
              {[{name:"Akshika",total:akTotal,color:"#ff9fd2"},{name:"Varun",total:vaTotal,color:"#4fc3f7"}].map(p => {
                const wins = Object.values(matchResults).filter(r=>r.owner===p.name).length;
                const isLeading = leadingPlayer === p.name;
                return (
                  <div key={p.name} style={{ background:`${p.color}0c`, border:`1px solid ${p.color}${isLeading?"44":"22"}`, borderRadius:12, padding:16, textAlign:"center", position:"relative" }}>
                    {isLeading && <div style={{ position:"absolute", top:10, right:10, fontSize:14 }}>🔝</div>}
                    <div style={{ fontSize:20, color:p.color, letterSpacing:2 }}>{p.name}</div>
                    <div style={{ fontFamily:"'Inter',sans-serif", marginTop:10 }}>
                      <div style={{ fontSize:28, fontWeight:700, color:p.color }}>{wins}</div>
                      <div style={{ fontSize:11, color:"#555", letterSpacing:1 }}>MATCH WINS</div>
                    </div>
                    <div style={{ fontFamily:"'Inter',sans-serif", marginTop:10 }}>
                      <div style={{ fontSize:20, color:"#fff" }}>₹{p.total.toLocaleString()}</div>
                      <div style={{ fontSize:11, color:"#555", letterSpacing:1 }}>WAGERS WON</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Stage breakdown */}
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:16 }}>
              <div style={{ fontSize:15, letterSpacing:2, marginBottom:12, color:"#888" }}>BREAKDOWN BY STAGE</div>
              {Object.entries(MATCH_STAGES).map(([stage,meta]) => {
                const sr = Object.values(matchResults).filter(r => r.stage===stage);
                const aW = sr.filter(r => r.owner==="Akshika").length;
                const vW = sr.filter(r => r.owner==="Varun").length;
                const aAmt = aW * meta.wager;
                const vAmt = vW * meta.wager;
                return (
                  <div key={stage} style={{ padding:"8px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontFamily:"'Inter',sans-serif", fontSize:13 }}>
                      <span style={{ color:meta.color, fontWeight:600 }}>{stage}</span>
                      <span style={{ color:"#444" }}>₹{meta.wager.toLocaleString()} / match</span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontFamily:"'Inter',sans-serif", fontSize:12 }}>
                      <span><span style={{ color:"#ff9fd2" }}>Akshika: {aW}W</span>{aAmt>0&&<span style={{ color:"#81c784", marginLeft:6 }}>+₹{aAmt.toLocaleString()}</span>}</span>
                      <span><span style={{ color:"#4fc3f7" }}>Varun: {vW}W</span>{vAmt>0&&<span style={{ color:"#81c784", marginLeft:6 }}>+₹{vAmt.toLocaleString()}</span>}</span>
                    </div>
                  </div>
                );
              })}
              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#333", textAlign:"center", marginTop:12 }}>
                Scores refresh every {liveMatches.length > 0 ? "60s (live)" : "5-10min (idle)"} · Firebase sync live · {lastSync ? `Last sync ${lastSync.toLocaleTimeString()}` : ""}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function ScorePill({ name, total, color, leading }) {
  return (
    <div style={{ textAlign:"center" }}>
      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#444", letterSpacing:1 }}>{name}</div>
      <div style={{ fontSize:22, letterSpacing:2, color }}>₹{total.toLocaleString()}</div>
      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color:"#555" }}>wagers won</div>
      {leading && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color:"#81c784", marginTop:2 }}>● LEADING</div>}
    </div>
  );
}

function TeamBlock({ name, align }) {
  const owner = getOwner(name);
  const tier  = getTeamTier(name);
  return (
    <div style={{ flex:1, textAlign:align }}>
      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:14, fontWeight:600, color:"#fff" }}>{name}</div>
      <div style={{ display:"flex", gap:5, marginTop:4, flexWrap:"wrap", justifyContent: align==="right"?"flex-end":"flex-start" }}>
        {owner && <span className="pill" style={{ background: owner==="Akshika"?"rgba(255,159,210,0.15)":"rgba(79,195,247,0.15)", color: owner==="Akshika"?"#ff9fd2":"#4fc3f7" }}>{owner}</span>}
        {tier  && <span className="pill" style={{ background:TIER_META[tier].bg, color:TIER_META[tier].color }}>{TIER_META[tier].label}</span>}
      </div>
    </div>
  );
}
