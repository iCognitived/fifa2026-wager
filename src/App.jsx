import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

// ─── Constants ───────────────────────────────────────────────────────────────
const API_KEY            = "b282e1081132398e6941085e9218c9f3";
const FIFA_LEAGUE_ID     = 1;
const FIFA_SEASON        = 2026;
const LIVE_POLL_MS       = 60000;   // 60s when live matches are on
const IDLE_POLL_MS       = 300000;  // 5min when no live matches
const SLOW_POLL_MS       = 600000;  // 10min for upcoming/finished (rarely change)
const TOURNAMENT_START   = new Date("2026-06-11T15:00:00-04:00"); // Mexico vs South Africa, 3pm ET
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
    mid:   ["Mexico","Colombia","Ecuador","Turkey","Ukraine","Denmark","South Korea","Nigeria","Ghana"],
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getOwner(teamName) {
  const n = teamName.trim().toLowerCase();
  for (const tier of ["elite","mid","low"]) {
    if (SPLIT.akshika[tier].some(t => n.includes(t.toLowerCase()) || t.toLowerCase().includes(n))) return "Akshika";
    if (SPLIT.varun[tier].some(t   => n.includes(t.toLowerCase()) || t.toLowerCase().includes(n))) return "Varun";
  }
  return null;
}

function getTeamTier(teamName) {
  const n = teamName.trim().toLowerCase();
  for (const tier of ["elite","mid","low"]) {
    if (SPLIT.akshika[tier].some(t => t.toLowerCase() === n)) return tier;
    if (SPLIT.varun[tier].some(t   => t.toLowerCase() === n)) return tier;
  }
  return null;
}

function stageFromRound(round = "") {
  const r = round.toLowerCase();
  if (r.includes("final") && !r.includes("semi") && !r.includes("quarter")) return "Final";
  if (r.includes("semi"))    return "Semi-finals";
  if (r.includes("quarter")) return "Quarter-finals";
  if (r.includes("16"))      return "Round of 16";
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
        📅 Opening match · June 11, 2026 · Mexico City · Mexico vs South Africa
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
  const [tab, setTab]                     = useState("teams");
  const [liveMatches, setLiveMatches]     = useState([]);
  const [allFixtures, setAllFixtures]     = useState([]);
  const [upcomingMatches, setUpcomingMatches] = useState([]);
  const [lastUpdated, setLastUpdated]     = useState(null);
  const [fetchStatus, setFetchStatus]     = useState("idle");
  const [apiUsage, setApiUsage]           = useState(null); // { remaining, limit }
  const [syncStatus, setSyncStatus]       = useState("connecting");
  const [lastSync, setLastSync]           = useState(null);
  const pollRef     = useRef(null);
  const slowPollRef = useRef(null);

  // ── Firebase real-time listener ──
  useEffect(() => {
    setSyncStatus("connecting");
    const ref = doc(db, "shared", "fifa2026");
    const unsub = onSnapshot(ref,
      () => { setSyncStatus("live"); setLastSync(new Date()); },
      (err) => { console.error("Firestore error:", err); setSyncStatus("error"); }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (syncStatus !== "live") return;
    const ref = doc(db, "shared", "fifa2026");
    setDoc(ref, { lastSeen: new Date().toISOString(), app: "fifa2026-wager" }, { merge: true })
      .catch(console.error);
  }, [syncStatus]);

  // ── Live scores fetch (smart polling) ──
  const fetchLive = useCallback(async () => {
    if (Date.now() < TOURNAMENT_START) return; // don't call API before tournament
    try {
      const res  = await fetch(`https://v3.football.api-sports.io/fixtures?live=all&league=${FIFA_LEAGUE_ID}&season=${FIFA_SEASON}`, { headers:{ "x-apisports-key": API_KEY } });
      const remaining = res.headers.get("x-ratelimit-requests-remaining");
      const limit     = res.headers.get("x-ratelimit-requests-limit");
      if (remaining !== null) setApiUsage({ remaining: parseInt(remaining), limit: parseInt(limit) });
      const live = (await res.json()).response || [];
      setLiveMatches(live);
      setLastUpdated(new Date());
      setFetchStatus("ok");

      // Adjust poll speed: fast if live matches, slow otherwise
      clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchLive, live.length > 0 ? LIVE_POLL_MS : IDLE_POLL_MS);
    } catch {
      setFetchStatus("error");
    }
  }, []);

  // ── Finished + upcoming fetch (slow poll, rarely changes) ──
  const fetchStatic = useCallback(async () => {
    if (Date.now() < TOURNAMENT_START) return;
    setFetchStatus("loading");
    try {
      const [finRes, upRes] = await Promise.all([
        fetch(`https://v3.football.api-sports.io/fixtures?league=${FIFA_LEAGUE_ID}&season=${FIFA_SEASON}&status=FT`, { headers:{ "x-apisports-key": API_KEY } }),
        fetch(`https://v3.football.api-sports.io/fixtures?league=${FIFA_LEAGUE_ID}&season=${FIFA_SEASON}&status=NS&next=20`, { headers:{ "x-apisports-key": API_KEY } }),
      ]);
      const finished  = (await finRes.json()).response || [];
      const upcoming  = (await upRes.json()).response  || [];
      setAllFixtures(prev => {
        // Merge live matches with finished
        const liveIds = new Set(prev.filter(f => f.fixture?.status?.short !== "FT").map(f => String(f.fixture?.id)));
        return [...prev.filter(f => liveIds.has(String(f.fixture?.id))), ...finished];
      });
      setUpcomingMatches(upcoming);
      setFetchStatus("ok");
    } catch {
      setFetchStatus("error");
    }
  }, []);

  // ── On mount: fetch everything once, then set up smart polling ──
  useEffect(() => {
    if (Date.now() >= TOURNAMENT_START) {
      fetchStatic();
      fetchLive();
      pollRef.current     = setInterval(fetchLive,   IDLE_POLL_MS);
      slowPollRef.current = setInterval(fetchStatic, SLOW_POLL_MS);
    }
    return () => {
      clearInterval(pollRef.current);
      clearInterval(slowPollRef.current);
    };
  }, [fetchLive, fetchStatic]);

  // Keep allFixtures in sync with live matches
  useEffect(() => {
    if (liveMatches.length === 0) return;
    setAllFixtures(prev => {
      const liveIds = new Set(liveMatches.map(f => String(f.fixture?.id)));
      return [...prev.filter(f => !liveIds.has(String(f.fixture?.id))), ...liveMatches];
    });
  }, [liveMatches]);

  // ── Derive wager results ──
  const matchResults = {};
  let finalPlayed = false;
  allFixtures.forEach(f => {
    const home      = f.teams?.home?.name || "";
    const away      = f.teams?.away?.name || "";
    const homeWon   = f.teams?.home?.winner;
    const awayWon   = f.teams?.away?.winner;
    const id        = String(f.fixture?.id);
    const stageKey  = stageFromRound(f.league?.round);
    const wager     = MATCH_STAGES[stageKey]?.wager || 500;
    const homeOwner = getOwner(home);
    const awayOwner = getOwner(away);
    if (!homeOwner && !awayOwner) return;
    const winner = homeWon ? home : awayWon ? away : null;
    const loser  = homeWon ? away : awayWon ? home : null;
    if (stageKey === "Final" && winner) finalPlayed = true;
    if (homeOwner && awayOwner && homeOwner === awayOwner) {
      matchResults[id] = { owner: homeOwner, stage: stageKey, home, away, winnerTeam: winner || "TBD", loserTeam: loser || "TBD", wager, bothOwned: true, note: `${homeOwner} owns both — wins ₹${wager.toLocaleString()} regardless` };
      return;
    }
    if (!winner) return;
    const winOwner = getOwner(winner);
    if (winOwner) matchResults[id] = { owner: winOwner, stage: stageKey, home, away, winnerTeam: winner, loserTeam: loser || "", wager, bothOwned: false, note: null };
  });

  let akTotal = 0, vaTotal = 0;
  Object.values(matchResults).forEach(r => {
    if (r.owner === "Akshika") akTotal += r.wager;
    if (r.owner === "Varun")   vaTotal += r.wager;
  });
  const netAmount      = Math.abs(akTotal - vaTotal);
  const leadingPlayer  = akTotal > vaTotal ? "Akshika" : vaTotal > akTotal ? "Varun" : null;
  const trailingPlayer = leadingPlayer === "Akshika" ? "Varun" : leadingPlayer === "Varun" ? "Akshika" : null;

  const beforeStart = Date.now() < TOURNAMENT_START;
  const tabs = [["teams","👥 TEAMS"],["live","🔴 LIVE"],["schedule","📅 SCHEDULE"],["results","✅ RESULTS"],["summary","📊 SUMMARY"]];

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
          {/* API quota badge */}
          {apiUsage && (
            <span style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color: apiUsage.remaining < 20 ? "#ff6b6b" : "#444" }}>
              API: {apiUsage.remaining}/{apiUsage.limit} req left today
            </span>
          )}
        </div>
        {lastSync && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color:"#333", marginTop:3 }}>Last sync {lastSync.toLocaleTimeString()}</div>}

        {/* Score strip */}
        <div style={{ marginTop:14, display:"flex", justifyContent:"center", gap:20, flexWrap:"wrap", alignItems:"center" }}>
          <ScorePill name="Akshika" total={akTotal} color="#ff9fd2" leading={leadingPlayer==="Akshika"} />
          <div style={{ textAlign:"center" }}>
            {fetchStatus==="ok" && (
              <div style={{ display:"flex", alignItems:"center", gap:5, justifyContent:"center", fontFamily:"'Inter',sans-serif", fontSize:11, color: liveMatches.length > 0 ? "#ff4d4d" : "#81c784" }}>
                {liveMatches.length > 0 ? <><span className="live-dot"/> LIVE POLLING 60s</> : <>● POLLING 5min</>}
              </div>
            )}
            {fetchStatus==="loading" && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#f5c518" }}>↻ FETCHING</div>}
            {fetchStatus==="error"   && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#ff6b6b" }}>⚠ API ERR</div>}
            {lastUpdated && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color:"#333", marginTop:2 }}>{lastUpdated.toLocaleTimeString()}</div>}
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
        <div style={{ display:"flex", gap:6, marginBottom:16, overflowX:"auto", paddingBottom:2 }}>
          {tabs.map(([t,label]) => (
            <button key={t} className="tab-btn" onClick={() => setTab(t)}
              style={{ flex:"0 0 auto", padding:"9px 10px", borderRadius:8, letterSpacing:1, fontSize:11,
                background: tab===t ? "#ff4d4d" : "rgba(255,255,255,0.05)",
                border:     tab===t ? "none"     : "1px solid rgba(255,255,255,0.08)",
                color:      tab===t ? "#fff"     : "#777", whiteSpace:"nowrap" }}>
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
              <button onClick={fetchLive} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#aaa", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:12 }}>↻ Refresh</button>
            </div>
            {liveMatches.length === 0 ? (
              beforeStart ? <Countdown /> :
              <div style={{ textAlign:"center", padding:"50px 20px", fontFamily:"'Inter',sans-serif", color:"#444", fontSize:14 }}>
                {fetchStatus==="loading" ? "Fetching live matches…" : "No live matches right now — check back soon"}
              </div>
            ) : liveMatches.map(f => {
              const home = f.teams?.home?.name || "?";
              const away = f.teams?.away?.name || "?";
              const hg   = f.goals?.home ?? "-";
              const ag   = f.goals?.away ?? "-";
              const min  = f.fixture?.status?.elapsed;
              return (
                <div key={f.fixture.id} className="match-card" style={{ background:"rgba(255,77,77,0.05)", border:"1px solid rgba(255,77,77,0.18)" }}>
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

        {/* ── SCHEDULE TAB ── */}
        {tab==="schedule" && (
          <div className="fade-in">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontSize:16, letterSpacing:2 }}>📅 UPCOMING MATCHES</div>
              <button onClick={fetchStatic} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#aaa", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:12 }}>↻ Refresh</button>
            </div>
            {/* API usage tip */}
            <div style={{ background:"rgba(245,197,24,0.06)", border:"1px solid rgba(245,197,24,0.15)", borderRadius:8, padding:"8px 12px", marginBottom:12, fontFamily:"'Inter',sans-serif", fontSize:11, color:"#888" }}>
              ⚡ Schedule refreshes every 10 min · Live scores every {liveMatches.length > 0 ? "60s" : "5 min"}
              {apiUsage && <span style={{ marginLeft:8, color: apiUsage.remaining < 20 ? "#ff6b6b" : "#555" }}>· {apiUsage.remaining} API calls left today</span>}
            </div>
            {beforeStart ? <Countdown /> : upcomingMatches.length === 0 ? (
              <div style={{ textAlign:"center", padding:"50px 20px", fontFamily:"'Inter',sans-serif", color:"#444", fontSize:14 }}>
                {fetchStatus==="loading" ? "Loading schedule…" : "No upcoming fixtures found"}
              </div>
            ) : upcomingMatches.map(f => {
              const home      = f.teams?.home?.name || "?";
              const away      = f.teams?.away?.name || "?";
              const kickoff   = f.fixture?.date ? new Date(f.fixture.date) : null;
              const venue     = f.fixture?.venue?.city || "";
              const stageKey  = stageFromRound(f.league?.round || "");
              const stageMeta = MATCH_STAGES[stageKey] || MATCH_STAGES["Group Stage"];
              const homeOwner = getOwner(home);
              const awayOwner = getOwner(away);
              const bothSame  = homeOwner && awayOwner && homeOwner === awayOwner;
              const isYours   = homeOwner || awayOwner;
              return (
                <div key={f.fixture.id} className="match-card" style={{
                  background: isYours ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
                  border: isYours ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(255,255,255,0.05)",
                  opacity: isYours ? 1 : 0.55
                }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, flexWrap:"wrap" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"#fff", fontWeight:600 }}>{home} vs {away}</div>
                      <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:5, alignItems:"center" }}>
                        <span className="pill" style={{ background:stageMeta.color+"22", color:stageMeta.color }}>{stageKey}</span>
                        {homeOwner && <span className="pill" style={{ background: homeOwner==="Akshika"?"rgba(255,159,210,0.12)":"rgba(79,195,247,0.12)", color: homeOwner==="Akshika"?"#ff9fd2":"#4fc3f7" }}>{home}: {homeOwner}</span>}
                        {awayOwner && <span className="pill" style={{ background: awayOwner==="Akshika"?"rgba(255,159,210,0.12)":"rgba(79,195,247,0.12)", color: awayOwner==="Akshika"?"#ff9fd2":"#4fc3f7" }}>{away}: {awayOwner}</span>}
                        {bothSame && <span className="pill" style={{ background:"rgba(245,197,24,0.15)", color:"#f5c518" }}>⚡ {homeOwner} auto-wins ₹{stageMeta.wager.toLocaleString()}</span>}
                      </div>
                      {venue && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#444", marginTop:4 }}>📍 {venue}</div>}
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      {kickoff && (
                        <>
                          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"#666" }}>{kickoff.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})}</div>
                          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:14, color:"#f5c518", fontWeight:600 }}>{kickoff.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</div>
                        </>
                      )}
                      {isYours && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"#81c784", marginTop:3 }}>₹{stageMeta.wager.toLocaleString()}</div>}
                    </div>
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

            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:16 }}>
              <div style={{ fontSize:15, letterSpacing:2, marginBottom:12, color:"#888" }}>BREAKDOWN BY STAGE</div>
              {Object.entries(MATCH_STAGES).map(([stage,meta]) => {
                const sr   = Object.values(matchResults).filter(r => r.stage===stage);
                const aW   = sr.filter(r => r.owner==="Akshika").length;
                const vW   = sr.filter(r => r.owner==="Varun").length;
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
                Live: 60s poll · Idle: 5min poll · Schedule: 10min poll · Firebase sync live
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
