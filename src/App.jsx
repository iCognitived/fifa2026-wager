import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

// ─── Constants ───────────────────────────────────────────────────────────────
const API_KEY            = "b282e1081132398e6941085e9218c9f3";
const FIFA_LEAGUE_ID     = 1;
const FIFA_SEASON        = 2026;
const POLL_MS            = 60000;
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
        <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#444", marginTop:10, textAlign:"center" }}>Total pool · ₹20,000</div>
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
  const fetchFixtures = useCallback(async () => {
    setFetchStatus("loading");
    try {
      const [liveRes, finRes] = await Promise.all([
        fetch(`https://v3.football.api-sports.io/fixtures?live=all&league=${FIFA_LEAGUE_ID}&season=${FIFA_SEASON}`, { headers:{ "x-apisports-key": API_KEY } }),
        fetch(`https://v3.football.api-sports.io/fixtures?league=${FIFA_LEAGUE_ID}&season=${FIFA_SEASON}&status=FT`,  { headers:{ "x-apisports-key": API_KEY } })
      ]);
      const live     = (await liveRes.json()).response || [];
      const finished = (await finRes.json()).response  || [];
      setLiveMatches(live);
      setAllFixtures([...live, ...finished]);
      setLastUpdated(new Date());
      setFetchStatus("ok");
    } catch {
      setFetchStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchFixtures();
    pollRef.current = setInterval(fetchFixtures, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [fetchFixtures]);

  // ── Derive wager results from API data ──
  const matchResults = {};
  allFixtures.forEach(f => {
    const home    = f.teams?.home?.name || "";
    const away    = f.teams?.away?.name || "";
    const homeWon = f.teams?.home?.winner;
    const awayWon = f.teams?.away?.winner;
    const id      = String(f.fixture?.id);
    const stageKey = stageFromRound(f.league?.round);
    const winner  = homeWon ? home : awayWon ? away : null;
    if (!winner) return;
    const owner = getOwner(winner);
    if (owner) matchResults[id] = { owner, stage: stageKey, home, away, winnerTeam: winner, wager: MATCH_STAGES[stageKey]?.wager || 500 };
  });

  let akEarned = 0, vaEarned = 0;
  Object.values(matchResults).forEach(r => {
    if (r.owner === "Akshika") akEarned += r.wager * 2;
    if (r.owner === "Varun")   vaEarned += r.wager * 2;
  });
  const akNet = akEarned - 10000;
  const vaNet = vaEarned - 10000;

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
        <div style={{ marginTop:14, display:"flex", justifyContent:"center", gap:28, flexWrap:"wrap", alignItems:"center" }}>
          <ScorePill name="Akshika" earned={akEarned} net={akNet} color="#ff9fd2" />
          <div style={{ textAlign:"center" }}>
            {fetchStatus==="ok" && (
              <div style={{ display:"flex", alignItems:"center", gap:5, justifyContent:"center", fontFamily:"'Inter',sans-serif", fontSize:11, color:"#81c784" }}>
                <span className="live-dot"/> API LIVE
              </div>
            )}
            {fetchStatus==="loading" && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#f5c518" }}>↻ FETCHING</div>}
            {fetchStatus==="error"   && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#ff6b6b" }}>⚠ API ERR</div>}
            {lastUpdated && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:10, color:"#333", marginTop:2 }}>{lastUpdated.toLocaleTimeString()}</div>}
          </div>
          <ScorePill name="Varun" earned={vaEarned} net={vaNet} color="#4fc3f7" />
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
              const isAk     = r.owner === "Akshika";
              const stageMeta = MATCH_STAGES[r.stage] || MATCH_STAGES["Group Stage"];
              return (
                <div key={id} className="match-card" style={{ background: isAk ? "rgba(255,159,210,0.05)" : "rgba(79,195,247,0.05)", border:`1px solid ${isAk?"#ff9fd2":"#4fc3f7"}22` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                    <div>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"#fff", fontWeight:600 }}>{r.home} vs {r.away}</div>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#555", marginTop:3 }}>
                        <span style={{ color:stageMeta.color }}>{r.stage}</span>
                        <span style={{ marginLeft:8 }}>Winner: <span style={{ color: isAk?"#ff9fd2":"#4fc3f7", fontWeight:600 }}>{r.winnerTeam}</span></span>
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color: isAk?"#ff9fd2":"#4fc3f7", fontWeight:600 }}>{r.owner}</div>
                      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:14, color:"#81c784", fontWeight:600 }}>+₹{(r.wager*2).toLocaleString()}</div>
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
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
              {[{name:"Akshika",earned:akEarned,net:akNet,color:"#ff9fd2"},{name:"Varun",earned:vaEarned,net:vaNet,color:"#4fc3f7"}].map(p => (
                <div key={p.name} style={{ background:`${p.color}0c`, border:`1px solid ${p.color}28`, borderRadius:12, padding:18, textAlign:"center" }}>
                  <div style={{ fontSize:22, color:p.color, letterSpacing:2 }}>{p.name}</div>
                  <div style={{ fontFamily:"'Inter',sans-serif", marginTop:12 }}>
                    <div style={{ fontSize:30, fontWeight:700, color:p.color }}>{Object.values(matchResults).filter(r=>r.owner===p.name).length}</div>
                    <div style={{ fontSize:11, color:"#555", letterSpacing:1 }}>MATCH WINS</div>
                  </div>
                  <div style={{ fontFamily:"'Inter',sans-serif", marginTop:10 }}>
                    <div style={{ fontSize:20, color:"#fff" }}>₹{p.earned.toLocaleString()}</div>
                    <div style={{ fontSize:11, color:"#555", letterSpacing:1 }}>EARNED</div>
                  </div>
                  <div style={{ marginTop:10, fontFamily:"'Inter',sans-serif", fontSize:16, fontWeight:700, color: p.net>=0?"#81c784":"#ff6b6b" }}>
                    {p.net>=0?"+":""}₹{p.net.toLocaleString()} net
                  </div>
                  <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#444", marginTop:4 }}>from ₹10,000 pool</div>
                </div>
              ))}
            </div>
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:16 }}>
              <div style={{ fontSize:15, letterSpacing:2, marginBottom:12, color:"#888" }}>WAGER BY STAGE</div>
              {Object.entries(MATCH_STAGES).map(([stage,meta]) => {
                const sr  = Object.values(matchResults).filter(r => r.stage===stage);
                const aW  = sr.filter(r => r.owner==="Akshika").length;
                const vW  = sr.filter(r => r.owner==="Varun").length;
                return (
                  <div key={stage} style={{ padding:"8px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontFamily:"'Inter',sans-serif", fontSize:13 }}>
                      <span style={{ color:meta.color, fontWeight:600 }}>{stage}</span>
                      <span style={{ color:"#444" }}>₹{meta.wager.toLocaleString()} / match</span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontFamily:"'Inter',sans-serif", fontSize:12 }}>
                      <span><span style={{ color:"#ff9fd2" }}>Akshika: {aW}W</span>{aW>0&&<span style={{ color:"#81c784", marginLeft:6 }}>+₹{(aW*meta.wager*2).toLocaleString()}</span>}</span>
                      <span><span style={{ color:"#4fc3f7" }}>Varun: {vW}W</span>{vW>0&&<span style={{ color:"#81c784", marginLeft:6 }}>+₹{(vW*meta.wager*2).toLocaleString()}</span>}</span>
                    </div>
                  </div>
                );
              })}
              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#333", textAlign:"center", marginTop:12 }}>
                Scores refresh every 60s · Firebase sync live · {lastSync ? `Last sync ${lastSync.toLocaleTimeString()}` : ""}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function ScorePill({ name, earned, net, color }) {
  return (
    <div style={{ textAlign:"center" }}>
      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"#444", letterSpacing:1 }}>{name}</div>
      <div style={{ fontSize:22, letterSpacing:2, color }}>₹{earned.toLocaleString()}</div>
      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color: net>=0?"#81c784":"#ff6b6b" }}>{net>=0?"+":""}₹{net.toLocaleString()} net</div>
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
