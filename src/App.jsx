import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

const LIVE_POLL_MS     = 60000;
const IDLE_POLL_MS     = 300000;
const SLOW_POLL_MS     = 600000;
const TOURNAMENT_START = new Date("2026-06-11T15:00:00-04:00");
const WC_EMBLEM        = "https://crests.football-data.org/wm26.png";

const SPLIT = {
  akshika: {
    elite: ["Argentina","England","Germany","Netherlands","Uruguay","Morocco","USA"],
    mid:   ["Japan","Switzerland","Austria","Egypt","Senegal","Algeria","Australia","Canada"],
    low:   ["Iran","Costa Rica","Chile","Panama","Jamaica","Qatar","South Africa","Bolivia","Honduras"]
  },
  varun: {
    elite: ["Brazil","France","Spain","Portugal","Belgium","Croatia"],
    mid:   ["Mexico","Colombia","Ecuador","Turkey","Ukraine","Denmark","South Korea","Nigeria","Ghana","Norway"],
    low:   ["Poland","Paraguay","Peru","Cameroon","DR Congo","Saudi Arabia","Venezuela","Tunisia","Trinidad & Tobago"]
  }
};

const TIER_META = {
  elite: { label:"👑 Elite",    color:"#ff4d4d", bg:"#ff4d4d15" },
  mid:   { label:"⚡ Mid Tier", color:"#f5c518", bg:"#f5c51815" },
  low:   { label:"🌍 Low Tier", color:"#81c784", bg:"#81c78415" }
};

const MATCH_STAGES = {
  "Group Stage":    { wager:500,  color:"#81c784" },
  "Round of 32":    { wager:750,  color:"#66bb9a" },
  "Round of 16":    { wager:1000, color:"#4fc3f7" },
  "Quarter-finals": { wager:2000, color:"#f5c518" },
  "Third Place":    { wager:2000, color:"#9575cd" },
  "Semi-finals":    { wager:2500, color:"#ff9900" },
  "Final":          { wager:3000, color:"#ff4d4d" },
};

const BOTH_OWNED_STAGES = ["Semi-finals","Final"];

const ALIASES = {
  "united states":"usa","u.s.a.":"usa","u.s.":"usa",
  "korea republic":"south korea","republic of korea":"south korea",
  "dr congo":"dr congo","congo dr":"dr congo","democratic republic of congo":"dr congo","democratic republic of the congo":"dr congo",
  "trinidad and tobago":"trinidad & tobago",
  "türkiye":"turkey","turkiye":"turkey",
};

function norm(name) {
  if (!name) return "";
  const n = name.trim().toLowerCase();
  return ALIASES[n] || n;
}

function getOwner(teamName) {
  if (!teamName) return null;
  const n = norm(teamName);
  for (const tier of ["elite","mid","low"]) {
    if (SPLIT.akshika[tier].some(t => { const tn=norm(t); return n===tn||n.includes(tn)||tn.includes(n); })) return "Akshika";
    if (SPLIT.varun[tier].some(t   => { const tn=norm(t); return n===tn||n.includes(tn)||tn.includes(n); })) return "Varun";
  }
  return null;
}

function getTeamTier(teamName) {
  if (!teamName) return null;
  const n = norm(teamName);
  for (const tier of ["elite","mid","low"]) {
    if (SPLIT.akshika[tier].some(t => norm(t)===n)) return tier;
    if (SPLIT.varun[tier].some(t   => norm(t)===n)) return tier;
  }
  return null;
}

const ROUND_CUTOFFS = [
  { after: "2026-07-14T00:00:00Z", stage: "Semi-finals" },
  { after: "2026-07-09T00:00:00Z", stage: "Quarter-finals" },
  { after: "2026-07-04T00:00:00Z", stage: "Round of 16" },
  { after: "2026-06-28T00:00:00Z", stage: "Round of 32" },
];

// FIX 1: normalize underscores → spaces so "ROUND_OF_16" matches "round of 16"
function stageFromStage(stage="", utcDate=null) {
  const s = stage.toLowerCase().replace(/_/g," ");
  if (s.includes("third")) return "Third Place";
  if (s.includes("final")&&!s.includes("semi")&&!s.includes("quarter")) return "Final";
  if (s.includes("semi"))    return "Semi-finals";
  if (s.includes("quarter")) return "Quarter-finals";
  if (s.includes("round of 16")||s.includes("last 16")) return "Round of 16";
  if (s.includes("round of 32")||s.includes("last 32")) return "Round of 32";
  if (utcDate) {
    const d = new Date(utcDate).getTime();
    if (d >= new Date("2026-07-18T00:00:00Z").getTime() && d < new Date("2026-07-19T00:00:00Z").getTime()) return "Third Place";
    for (const { after, stage: cutoffStage } of ROUND_CUTOFFS) {
      if (d >= new Date(after).getTime()) return cutoffStage;
    }
  }
  return "Group Stage";
}

function groupLabel(g="") {
  return g.replace("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
}

function durationBadge(duration) {
  if (duration==="EXTRA_TIME")       return { label:"AET",  color:"#f5c518" };
  if (duration==="PENALTY_SHOOTOUT") return { label:"PSO",  color:"#ff9900" };
  return null;
}

function normaliseMatch(m) {
  const home      = m.homeTeam?.name || m.homeTeam?.shortName || "TBD";
  const away      = m.awayTeam?.name || m.awayTeam?.shortName || "TBD";
  const homeCrest = m.homeTeam?.crest || null;
  const awayCrest = m.awayTeam?.crest || null;
  const homeTLA   = m.homeTeam?.tla  || null;
  const awayTLA   = m.awayTeam?.tla  || null;
  const homeGoals = m.score?.fullTime?.home ?? null;
  const awayGoals = m.score?.fullTime?.away ?? null;
  const winner    = m.score?.winner;
  const duration  = m.score?.duration || "REGULAR";
  const stage     = stageFromStage(m.stage || "", m.utcDate);
  const group     = m.group ? groupLabel(m.group) : null;
  const matchday  = m.matchday || null;
  const elapsed   = m.minute  || null;
  return { id:String(m.id), home, away, homeCrest, awayCrest, homeTLA, awayTLA, homeGoals, awayGoals, winner, duration, stage, group, matchday, elapsed, date:m.utcDate, venue:m.venue||"", status:m.status };
}

function useCountdown() {
  const [t,setT] = useState(null);
  useEffect(()=>{
    const tick=()=>{
      const diff=TOURNAMENT_START-Date.now();
      if(diff<=0) return setT(null);
      setT({d:Math.floor(diff/86400000),h:Math.floor((diff%86400000)/3600000),m:Math.floor((diff%3600000)/60000),s:Math.floor((diff%60000)/1000)});
    };
    tick(); const id=setInterval(tick,1000); return ()=>clearInterval(id);
  },[]);
  return t;
}

function Countdown() {
  const t = useCountdown();
  if (!t) return null;
  return (
    <div style={{textAlign:"center",padding:"40px 16px 32px"}}>
      <div style={{fontFamily:"'Inter',sans-serif",fontSize:12,color:"#555",letterSpacing:3,marginBottom:20}}>TOURNAMENT STARTS IN</div>
      <div style={{display:"flex",justifyContent:"center",gap:10,flexWrap:"wrap"}}>
        {[["DAYS",t.d],["HRS",t.h],["MIN",t.m],["SEC",t.s]].map(([label,val])=>(
          <div key={label} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"14px 18px",minWidth:68,textAlign:"center"}}>
            <div style={{fontSize:34,letterSpacing:2,color:"#ff4d4d",lineHeight:1}}>{String(val).padStart(2,"0")}</div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:"#555",letterSpacing:2,marginTop:5}}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{fontFamily:"'Inter',sans-serif",fontSize:12,color:"#444",marginTop:18}}>📅 Opening match · June 11, 2026 · Mexico City · Mexico vs South Africa</div>
      <div style={{marginTop:28,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"16px 20px",maxWidth:320,margin:"28px auto 0"}}>
        <div style={{fontSize:14,letterSpacing:2,marginBottom:10,color:"#888"}}>WAGER AT STAKE</div>
        {Object.entries(MATCH_STAGES).map(([stage,meta])=>(
          <div key={stage} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",fontFamily:"'Inter',sans-serif",fontSize:12}}>
            <span style={{color:meta.color}}>{stage}</span>
            <span style={{color:"#555"}}>₹{meta.wager.toLocaleString()} / match</span>
          </div>
        ))}
        <div style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#444",marginTop:10,textAlign:"center"}}>Net settlement after the Final · July 19, 2026</div>
      </div>
    </div>
  );
}

function Crest({src, tla, size=28}) {
  const [err,setErr] = useState(false);
  if (!src||err) return <div style={{width:size,height:size,borderRadius:4,background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',sans-serif",fontSize:9,color:"#555",flexShrink:0}}>{tla||"?"}</div>;
  return <img src={src} alt={tla} onError={()=>setErr(true)} style={{width:size,height:size,objectFit:"contain",flexShrink:0}} />;
}

function MatchCard({ m, wagerResult, dim=false }) {
  const stageMeta = MATCH_STAGES[m.stage] || MATCH_STAGES["Group Stage"];
  const badge     = durationBadge(m.duration);
  const hasScore  = m.homeGoals !== null && m.awayGoals !== null;
  const isAk      = wagerResult?.owner === "Akshika";
  const borderColor = wagerResult
    ? (isAk ? "#ff9fd2" : "#4fc3f7")
    : "rgba(255,255,255,0.08)";

  return (
    <div className="match-card" style={{
      background: wagerResult ? (isAk?"rgba(255,159,210,0.05)":"rgba(79,195,247,0.05)") : "rgba(255,255,255,0.02)",
      border:`1px solid ${borderColor}`,
      borderLeft: wagerResult ? `3px solid ${borderColor}` : `1px solid ${borderColor}`,
      opacity: dim ? 0.45 : 1,
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:4}}>
        <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
          {m.group && <span className="pill" style={{background:"rgba(255,255,255,0.05)",color:"#555"}}>{m.group}</span>}
          <span className="pill" style={{background:stageMeta.color+"18",color:stageMeta.color}}>{m.stage}</span>
          {badge && <span className="pill" style={{background:badge.color+"22",color:badge.color}}>{badge.label}</span>}
        </div>
        {m.date && <span style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#444"}}>{new Date(m.date).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span>}
      </div>

      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{flex:1,display:"flex",alignItems:"center",gap:7}}>
          <Crest src={m.homeCrest} tla={m.homeTLA} />
          <div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:13,fontWeight:600,color:"#fff"}}>{m.home}</div>
            {getOwner(m.home) && <div style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:getOwner(m.home)==="Akshika"?"#ff9fd2":"#4fc3f7",marginTop:1}}>{getOwner(m.home)}</div>}
          </div>
        </div>

        <div style={{textAlign:"center",minWidth:60}}>
          {hasScore
            ? <div style={{fontSize:22,letterSpacing:3,color:"#fff",fontWeight:700}}>{m.homeGoals}<span style={{color:"#444",margin:"0 2px"}}>:</span>{m.awayGoals}</div>
            : <div style={{fontFamily:"'Inter',sans-serif",fontSize:13,color:"#555"}}>vs</div>
          }
          {m.elapsed && <div style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#ff4d4d",marginTop:2}}>{m.elapsed}'</div>}
        </div>

        <div style={{flex:1,display:"flex",alignItems:"center",gap:7,justifyContent:"flex-end"}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:13,fontWeight:600,color:"#fff"}}>{m.away}</div>
            {getOwner(m.away) && <div style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:getOwner(m.away)==="Akshika"?"#ff9fd2":"#4fc3f7",marginTop:1}}>{getOwner(m.away)}</div>}
          </div>
          <Crest src={m.awayCrest} tla={m.awayTLA} />
        </div>
      </div>

      {wagerResult && (
        <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#555"}}>
            {wagerResult.bothOwned ? `⚡ Both owned by ${wagerResult.owner}` : `🏆 ${wagerResult.winnerTeam} wins`}
          </span>
          <span style={{fontFamily:"'Inter',sans-serif",fontSize:12,color:isAk?"#ff9fd2":"#4fc3f7",fontWeight:600}}>
            {wagerResult.owner} +₹{wagerResult.wager.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

function UpcomingCard({ m }) {
  const homeOwner = getOwner(m.home);
  const awayOwner = getOwner(m.away);
  const bothSame  = homeOwner && awayOwner && homeOwner === awayOwner;
  const bothDiff  = homeOwner && awayOwner && homeOwner !== awayOwner;
  const hasWager  = bothDiff || (bothSame && BOTH_OWNED_STAGES.includes(m.stage));
  const stageMeta = MATCH_STAGES[m.stage] || MATCH_STAGES["Group Stage"];
  const kickoff   = m.date ? new Date(m.date) : null;

  return (
    <div className="match-card" style={{
      background: hasWager?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.015)",
      border:"1px solid rgba(255,255,255,0.07)",
      opacity: hasWager ? 1 : 0.45,
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:4}}>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          {m.group && <span className="pill" style={{background:"rgba(255,255,255,0.05)",color:"#555"}}>{m.group}</span>}
          <span className="pill" style={{background:stageMeta.color+"18",color:stageMeta.color}}>{m.stage}</span>
          {bothSame && BOTH_OWNED_STAGES.includes(m.stage) && <span className="pill" style={{background:"rgba(245,197,24,0.15)",color:"#f5c518"}}>⚡ {homeOwner} auto-wins</span>}
        </div>
        {kickoff && (
          <div style={{textAlign:"right"}}>
            <span style={{fontFamily:"'Inter',sans-serif",fontSize:12,color:"#666"}}>{kickoff.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})} </span>
            <span style={{fontFamily:"'Inter',sans-serif",fontSize:13,color:"#f5c518",fontWeight:600}}>{kickoff.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</span>
          </div>
        )}
      </div>

      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{flex:1,display:"flex",alignItems:"center",gap:7}}>
          <Crest src={m.homeCrest} tla={m.homeTLA} />
          <div>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:13,fontWeight:600,color:"#fff"}}>{m.home}</div>
            {homeOwner && <div style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:homeOwner==="Akshika"?"#ff9fd2":"#4fc3f7",marginTop:1}}>{homeOwner}</div>}
          </div>
        </div>
        <div style={{textAlign:"center",minWidth:40}}>
          <div style={{fontFamily:"'Inter',sans-serif",fontSize:12,color:"#444"}}>vs</div>
          {hasWager && <div style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#81c784",marginTop:2}}>₹{stageMeta.wager.toLocaleString()}</div>}
        </div>
        <div style={{flex:1,display:"flex",alignItems:"center",gap:7,justifyContent:"flex-end"}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'Inter',sans-serif",fontSize:13,fontWeight:600,color:"#fff"}}>{m.away}</div>
            {awayOwner && <div style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:awayOwner==="Akshika"?"#ff9fd2":"#4fc3f7",marginTop:1}}>{awayOwner}</div>}
          </div>
          <Crest src={m.awayCrest} tla={m.awayTLA} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab,setTab]                         = useState("teams");
  const [liveMatches,setLiveMatches]         = useState([]);
  const [finishedMatches,setFinishedMatches] = useState([]);
  const [upcomingMatches,setUpcomingMatches] = useState([]);
  const [lastUpdated,setLastUpdated]         = useState(null);
  const [fetchStatus,setFetchStatus]         = useState("idle");
  const [syncStatus,setSyncStatus]           = useState("connecting");
  const [lastSync,setLastSync]               = useState(null);
  const pollRef     = useRef(null);
  const slowPollRef = useRef(null);

  useEffect(()=>{
    setSyncStatus("connecting");
    const ref=doc(db,"shared","fifa2026");
    const unsub=onSnapshot(ref,()=>{setSyncStatus("live");setLastSync(new Date())},()=>setSyncStatus("error"));
    return ()=>unsub();
  },[]);

  useEffect(()=>{
    if(syncStatus!=="live") return;
    setDoc(doc(db,"shared","fifa2026"),{lastSeen:new Date().toISOString()},{merge:true}).catch(console.error);
  },[syncStatus]);

  // FIX 2: fetch both IN_PLAY and PAUSED so half-time matches show in Live tab
  const fetchLive = useCallback(async()=>{
    if(Date.now()<TOURNAMENT_START) return;
    try {
      const [r1,r2] = await Promise.all([
        fetch("/api/fixtures?type=live"),
        fetch("/api/fixtures?type=paused"),
      ]);
      const [d1,d2] = await Promise.all([r1.json(),r2.json()]);
      const matches = [...(d1.matches||[]),...(d2.matches||[])].map(normaliseMatch);
      setLiveMatches(matches);
      setLastUpdated(new Date());
      setFetchStatus("ok");
      clearInterval(pollRef.current);
      pollRef.current=setInterval(fetchLive,matches.length>0?LIVE_POLL_MS:IDLE_POLL_MS);
    } catch { setFetchStatus("error"); }
  },[]);

  const fetchStatic = useCallback(async()=>{
    if(Date.now()<TOURNAMENT_START) return;
    setFetchStatus("loading");
    try {
      const [finRes,upRes]=await Promise.all([
        fetch("/api/fixtures?type=finished"),
        fetch("/api/fixtures?type=upcoming"),
      ]);
      const finData=await finRes.json();
      const upData=await upRes.json();
      setFinishedMatches((finData.matches||[]).map(normaliseMatch));
      setUpcomingMatches((upData.matches||[]).map(normaliseMatch));
      setFetchStatus("ok");
    } catch { setFetchStatus("error"); }
  },[]);

  useEffect(()=>{
    if(Date.now()>=TOURNAMENT_START){
      fetchLive(); fetchStatic();
      pollRef.current=setInterval(fetchLive,IDLE_POLL_MS);
      slowPollRef.current=setInterval(fetchStatic,SLOW_POLL_MS);
    }
    return ()=>{clearInterval(pollRef.current);clearInterval(slowPollRef.current);};
  },[fetchLive,fetchStatic]);

  const matchResults = {};
  let finalPlayed = false;
  finishedMatches.forEach(m=>{
    if(m.status!=="FINISHED") return;
    const {id,home,away,winner,stage,homeGoals,awayGoals,duration} = m;
    const wager=MATCH_STAGES[stage]?.wager||500;
    const homeOwner=getOwner(home), awayOwner=getOwner(away);
    if(stage==="Final"&&winner) finalPlayed=true;
    if(homeOwner&&awayOwner&&homeOwner===awayOwner){
      if(!BOTH_OWNED_STAGES.includes(stage)) return;
      matchResults[id]={owner:homeOwner,stage,home,away,homeCrest:m.homeCrest,awayCrest:m.awayCrest,homeTLA:m.homeTLA,awayTLA:m.awayTLA,winnerTeam:winner==="HOME_TEAM"?home:away,wager,bothOwned:true,duration,date:m.date};
      return;
    }
    if(!homeOwner||!awayOwner) return;
    const winTeam=winner==="HOME_TEAM"?home:winner==="AWAY_TEAM"?away:null;
    if(!winTeam) return;
    const winOwner=getOwner(winTeam);
    if(winOwner) matchResults[id]={owner:winOwner,stage,home,away,homeCrest:m.homeCrest,awayCrest:m.awayCrest,homeTLA:m.homeTLA,awayTLA:m.awayTLA,winnerTeam:winTeam,wager,bothOwned:false,score:homeGoals!==null?`${homeGoals}–${awayGoals}`:null,duration,date:m.date};
  });

  let akTotal=0,vaTotal=0;
  Object.values(matchResults).forEach(r=>{
    if(r.owner==="Akshika") akTotal+=r.wager;
    else if(r.owner==="Varun") vaTotal+=r.wager;
  });

  // FIX 3: build knockedOutTeams from finishedMatches directly (not matchResults)
  // so same-owner matches (e.g. Netherlands vs Morocco) don't get skipped
  const KNOCKOUT_STAGES = ["Round of 32","Round of 16","Quarter-finals","Semi-finals","Third Place","Final"];
  const knockedOutTeams = new Set();
  finishedMatches.forEach(m=>{
    if(!KNOCKOUT_STAGES.includes(m.stage)) return;
    const winner = m.winner;
    if(!winner) return;
    const loser = winner==="HOME_TEAM" ? m.away : m.home;
    if(loser) knockedOutTeams.add(norm(loser));
  });

  const NON_QUALIFIERS = new Set([
    "chile","costa rica","jamaica","bolivia","honduras",
    "poland","peru","cameroon","venezuela","tunisia","trinidad & tobago",
    "ukraine","denmark","nigeria","ghana",
  ]);

  const GROUP_ELIMINATED = new Set([
    "australia","egypt","algeria","iran","qatar","panama",
    "turkey","south korea","saudi arabia",
  ]);

  const netAmount=Math.abs(akTotal-vaTotal);
  const leadingPlayer=akTotal>vaTotal?"Akshika":vaTotal>akTotal?"Varun":null;
  const trailingPlayer=leadingPlayer==="Akshika"?"Varun":leadingPlayer==="Varun"?"Akshika":null;
  const beforeStart=Date.now()<TOURNAMENT_START;

  const tabs=[["teams","👥 TEAMS"],["live","🔴 LIVE"],["schedule","📅 SCHEDULE"],["completed","🕐 COMPLETED"],["results","✅ RESULTS"],["summary","📊 SUMMARY"]];

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#080810 0%,#0d1520 60%,#080810 100%)",fontFamily:"'Bebas Neue','Impact',sans-serif",color:"#fff",overflowX:"hidden"}}>
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

      <div style={{background:"linear-gradient(90deg,#ff4d4d1a,#f5c5181a,#ff4d4d1a)",borderBottom:"1px solid rgba(255,255,255,0.07)",padding:"16px 20px",textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginBottom:4}}>
          <img src={WC_EMBLEM} alt="FIFA WC 2026" style={{width:32,height:32,objectFit:"contain"}} onError={e=>e.target.style.display="none"} />
          <div style={{fontSize:38,letterSpacing:5}}>FIFA 2026</div>
          <img src={WC_EMBLEM} alt="" style={{width:32,height:32,objectFit:"contain"}} onError={e=>e.target.style.display="none"} />
        </div>
        <div style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#555",letterSpacing:2,display:"flex",alignItems:"center",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
          <span>AKSHIKA vs VARUN · 🔒 LOCKED</span>
          <span style={{display:"flex",alignItems:"center",gap:5}}>
            <span className="sync-dot" style={{background:syncStatus==="live"?"#81c784":syncStatus==="connecting"?"#f5c518":"#ff4d4d"}}/>
            <span style={{color:syncStatus==="live"?"#81c784":syncStatus==="connecting"?"#f5c518":"#ff4d4d",fontSize:10}}>
              {syncStatus==="live"?"FIREBASE LIVE":syncStatus==="connecting"?"CONNECTING…":"SYNC ERROR"}
            </span>
          </span>
        </div>
        {lastSync&&<div style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:"#333",marginTop:3}}>Last sync {lastSync.toLocaleTimeString()}</div>}

        <div style={{marginTop:14,display:"flex",justifyContent:"center",gap:20,flexWrap:"wrap",alignItems:"center"}}>
          <ScorePill name="Akshika" total={akTotal} color="#ff9fd2" leading={leadingPlayer==="Akshika"} />
          <div style={{textAlign:"center"}}>
            {fetchStatus==="ok"&&<div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"center",fontFamily:"'Inter',sans-serif",fontSize:11,color:liveMatches.length>0?"#ff4d4d":"#81c784"}}>
              {liveMatches.length>0?<><span className="live-dot"/> LIVE 60s</>:<>● IDLE 5min</>}
            </div>}
            {fetchStatus==="loading"&&<div style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#f5c518"}}>↻ FETCHING</div>}
            {fetchStatus==="error"&&<div style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#ff6b6b"}}>⚠ API ERR</div>}
            {lastUpdated&&<div style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:"#333",marginTop:2}}>{lastUpdated.toLocaleTimeString()}</div>}
            {netAmount>0&&(
              <div style={{marginTop:6,fontFamily:"'Inter',sans-serif",fontSize:11,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,padding:"3px 10px",color:"#fff"}}>
                {finalPlayed
                  ?<span>🏆 <span style={{color:leadingPlayer==="Akshika"?"#ff9fd2":"#4fc3f7"}}>{trailingPlayer}</span> owes <span style={{color:"#81c784"}}>₹{netAmount.toLocaleString()}</span></span>
                  :<span><span style={{color:leadingPlayer==="Akshika"?"#ff9fd2":"#4fc3f7"}}>{leadingPlayer}</span> leads by <span style={{color:"#f5c518"}}>₹{netAmount.toLocaleString()}</span></span>
                }
              </div>
            )}
          </div>
          <ScorePill name="Varun" total={vaTotal} color="#4fc3f7" leading={leadingPlayer==="Varun"} />
        </div>
      </div>

      <div style={{maxWidth:720,margin:"0 auto",padding:"16px 14px"}}>
        <div style={{display:"flex",gap:5,marginBottom:16,overflowX:"auto",paddingBottom:2}}>
          {tabs.map(([t,label])=>(
            <button key={t} className="tab-btn" onClick={()=>setTab(t)}
              style={{flex:"0 0 auto",padding:"9px 8px",borderRadius:8,letterSpacing:1,fontSize:10,whiteSpace:"nowrap",
                background:tab===t?"#ff4d4d":"rgba(255,255,255,0.05)",
                border:tab===t?"none":"1px solid rgba(255,255,255,0.08)",
                color:tab===t?"#fff":"#777"}}>
              {label}
            </button>
          ))}
        </div>

        {/* TEAMS */}
        {tab==="teams"&&(
          <div className="fade-in">
            <div style={{background:"rgba(255,77,77,0.06)",border:"1px solid rgba(255,77,77,0.15)",borderRadius:10,padding:"9px 14px",marginBottom:16,fontFamily:"'Inter',sans-serif",fontSize:12,color:"#ff8080",textAlign:"center"}}>
              🔒 Teams are fixed — synced live via Firebase
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              {[{name:"Akshika",color:"#ff9fd2",key:"akshika"},{name:"Varun",color:"#4fc3f7",key:"varun"}].map(p=>(
                <div key={p.name} style={{background:`${p.color}0c`,border:`1px solid ${p.color}22`,borderRadius:10,padding:14,textAlign:"center"}}>
                  <div style={{fontSize:20,color:p.color,letterSpacing:2,marginBottom:8}}>{p.name}</div>
                  {["elite","mid","low"].map(t=>{
                    const total = SPLIT[p.key][t].length;
                    const active = SPLIT[p.key][t].filter(tm=>!knockedOutTeams.has(norm(tm))&&!NON_QUALIFIERS.has(norm(tm))&&!GROUP_ELIMINATED.has(norm(tm))).length;
                    return (
                      <div key={t} style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:TIER_META[t].color,marginTop:3}}>
                        {TIER_META[t].label}: {active}/{total} active
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {["elite","mid","low"].map(tier=>(
              <div key={tier} style={{marginBottom:16}}>
                <div style={{fontSize:16,letterSpacing:2,color:TIER_META[tier].color,marginBottom:8,borderBottom:`1px solid ${TIER_META[tier].color}22`,paddingBottom:6}}>{TIER_META[tier].label}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {[{name:"Akshika",color:"#ff9fd2",key:"akshika"},{name:"Varun",color:"#4fc3f7",key:"varun"}].map(p=>(
                    <div key={p.name} style={{background:`${p.color}0a`,border:`1px solid ${p.color}18`,borderRadius:10,padding:12}}>
                      <div style={{fontFamily:"'Inter',sans-serif",fontSize:12,color:p.color,fontWeight:600,marginBottom:8}}>{p.name}</div>
                      <div>{SPLIT[p.key][tier].map(tm=>{
                        const dead = knockedOutTeams.has(norm(tm))||NON_QUALIFIERS.has(norm(tm))||GROUP_ELIMINATED.has(norm(tm));
                        return (
                          <span key={tm} className="team-chip" style={{
                            background:TIER_META[tier].bg,
                            color:TIER_META[tier].color,
                            border:`1px solid ${TIER_META[tier].color}22`,
                            opacity: dead ? 0.45 : 1,
                            textDecoration: dead ? "line-through" : "none",
                          }}>{tm}</span>
                        );
                      })}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* LIVE */}
        {tab==="live"&&(
          <div className="fade-in">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:16,letterSpacing:2}}>🔴 LIVE MATCHES</div>
              <button onClick={fetchLive} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",borderRadius:6,padding:"5px 12px",cursor:"pointer",fontFamily:"'Inter',sans-serif",fontSize:12}}>↻ Refresh</button>
            </div>
            {liveMatches.length===0?(
              beforeStart?<Countdown/>:
              <div style={{textAlign:"center",padding:"50px 20px",fontFamily:"'Inter',sans-serif",color:"#444",fontSize:14}}>
                {fetchStatus==="loading"?"Fetching live matches…":"No live matches right now"}
              </div>
            ):liveMatches.map(m=><MatchCard key={m.id} m={m} wagerResult={null} />)}
          </div>
        )}

        {/* SCHEDULE */}
        {tab==="schedule"&&(
          <div className="fade-in">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:16,letterSpacing:2}}>📅 UPCOMING MATCHES</div>
              <button onClick={fetchStatic} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",borderRadius:6,padding:"5px 12px",cursor:"pointer",fontFamily:"'Inter',sans-serif",fontSize:12}}>↻ Refresh</button>
            </div>
            <div style={{background:"rgba(245,197,24,0.06)",border:"1px solid rgba(245,197,24,0.15)",borderRadius:8,padding:"8px 12px",marginBottom:12,fontFamily:"'Inter',sans-serif",fontSize:11,color:"#666"}}>
              ⚡ Refreshes every 10 min · Dimmed = no wager stake
            </div>
            {beforeStart?<Countdown/>:upcomingMatches.length===0?(
              <div style={{textAlign:"center",padding:"50px 20px",fontFamily:"'Inter',sans-serif",color:"#444",fontSize:14}}>
                {fetchStatus==="loading"?"Loading schedule…":"No upcoming fixtures found"}
              </div>
            ):upcomingMatches.map(m=><UpcomingCard key={m.id} m={m} />)}
          </div>
        )}

        {/* COMPLETED */}
        {tab==="completed"&&(
          <div className="fade-in">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:16,letterSpacing:2}}>🕐 ALL COMPLETED MATCHES</div>
              <button onClick={fetchStatic} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",borderRadius:6,padding:"5px 12px",cursor:"pointer",fontFamily:"'Inter',sans-serif",fontSize:12}}>↻ Refresh</button>
            </div>
            <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,padding:"8px 12px",marginBottom:12,fontFamily:"'Inter',sans-serif",fontSize:11,color:"#555"}}>
              Full match archive · Highlighted left border = had a wager
            </div>
            {finishedMatches.length===0?(
              <div style={{textAlign:"center",padding:"50px 20px",fontFamily:"'Inter',sans-serif",color:"#444",fontSize:14}}>
                {fetchStatus==="loading"?"Loading…":"No completed matches yet"}
              </div>
            ):[...finishedMatches].reverse().map(m=>{
              const result=matchResults[m.id]||null;
              return <MatchCard key={m.id} m={m} wagerResult={result} dim={!result} />;
            })}
          </div>
        )}

        {/* RESULTS */}
        {tab==="results"&&(
          <div className="fade-in">
            <div style={{fontSize:16,letterSpacing:2,marginBottom:12}}>✅ WAGER RESULTS</div>
            {Object.keys(matchResults).length===0?(
              beforeStart?<Countdown/>:
              <div style={{textAlign:"center",padding:"50px 20px",fontFamily:"'Inter',sans-serif",color:"#444",fontSize:14}}>
                {fetchStatus==="loading"?"Loading results…":"No wager results yet"}
              </div>
            ):Object.values(matchResults).sort((a,b)=>new Date(b.date)-new Date(a.date)).map(r=>{
              const m={id:r.id||Math.random(),home:r.home,away:r.away,homeCrest:r.homeCrest,awayCrest:r.awayCrest,homeTLA:r.homeTLA,awayTLA:r.awayTLA,homeGoals:r.score?parseInt(r.score):null,awayGoals:r.score?parseInt(r.score.split("–")[1]):null,stage:r.stage,group:null,date:null,duration:r.duration||"REGULAR",elapsed:null,status:"FINISHED"};
              return <MatchCard key={r.home+r.away+r.stage} m={m} wagerResult={r} />;
            })}
          </div>
        )}

        {/* SUMMARY */}
        {tab==="summary"&&(
          <div className="fade-in">
            <div style={{borderRadius:12,padding:"18px 20px",marginBottom:14,textAlign:"center",
              background:finalPlayed?"rgba(129,199,132,0.08)":"rgba(245,197,24,0.06)",
              border:`1px solid ${finalPlayed?"rgba(129,199,132,0.25)":"rgba(245,197,24,0.2)"}`}}>
              {finalPlayed?(
                <>
                  <div style={{fontSize:22,letterSpacing:2,color:"#81c784",marginBottom:6}}>🏆 TOURNAMENT OVER</div>
                  <div style={{fontFamily:"'Inter',sans-serif",fontSize:14,color:"#fff"}}>
                    <span style={{color:leadingPlayer==="Akshika"?"#ff9fd2":"#4fc3f7",fontWeight:700}}>{trailingPlayer}</span> pays <span style={{color:leadingPlayer==="Akshika"?"#ff9fd2":"#4fc3f7",fontWeight:700}}>{leadingPlayer}</span>
                  </div>
                  <div style={{fontSize:36,letterSpacing:2,color:"#81c784",marginTop:8}}>₹{netAmount.toLocaleString()}</div>
                </>
              ):(
                <>
                  <div style={{fontSize:16,letterSpacing:2,color:"#f5c518",marginBottom:6}}>{leadingPlayer?`${leadingPlayer} LEADS`:"ALL SQUARE"}</div>
                  <div style={{fontSize:30,letterSpacing:2,color:leadingPlayer==="Akshika"?"#ff9fd2":leadingPlayer==="Varun"?"#4fc3f7":"#fff"}}>
                    {netAmount>0?`₹${netAmount.toLocaleString()}`:"₹0"}
                  </div>
                  <div style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#555",marginTop:6}}>Running tally · winner declared after the Final</div>
                </>
              )}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              {[{name:"Akshika",total:akTotal,color:"#ff9fd2"},{name:"Varun",total:vaTotal,color:"#4fc3f7"}].map(p=>{
                const wins=Object.values(matchResults).filter(r=>r.owner===p.name).length;
                const isLeading=leadingPlayer===p.name;
                return (
                  <div key={p.name} style={{background:`${p.color}0c`,border:`1px solid ${p.color}${isLeading?"44":"22"}`,borderRadius:12,padding:16,textAlign:"center",position:"relative"}}>
                    {isLeading&&<div style={{position:"absolute",top:10,right:10,fontSize:14}}>🔝</div>}
                    <div style={{fontSize:20,color:p.color,letterSpacing:2}}>{p.name}</div>
                    <div style={{fontFamily:"'Inter',sans-serif",marginTop:10}}>
                      <div style={{fontSize:28,fontWeight:700,color:p.color}}>{wins}</div>
                      <div style={{fontSize:11,color:"#555",letterSpacing:1}}>MATCH WINS</div>
                    </div>
                    <div style={{fontFamily:"'Inter',sans-serif",marginTop:10}}>
                      <div style={{fontSize:20,color:"#fff"}}>₹{p.total.toLocaleString()}</div>
                      <div style={{fontSize:11,color:"#555",letterSpacing:1}}>WAGERS WON</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:16}}>
              <div style={{fontSize:15,letterSpacing:2,marginBottom:12,color:"#888"}}>BREAKDOWN BY STAGE</div>
              {Object.entries(MATCH_STAGES).map(([stage,meta])=>{
                const sr=Object.values(matchResults).filter(r=>r.stage===stage);
                const aW=sr.filter(r=>r.owner==="Akshika").length;
                const vW=sr.filter(r=>r.owner==="Varun").length;
                return (
                  <div key={stage} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Inter',sans-serif",fontSize:13}}>
                      <span style={{color:meta.color,fontWeight:600}}>{stage}</span>
                      <span style={{color:"#444"}}>₹{meta.wager.toLocaleString()} / match</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontFamily:"'Inter',sans-serif",fontSize:12}}>
                      <span><span style={{color:"#ff9fd2"}}>Akshika: {aW}W</span>{aW>0&&<span style={{color:"#81c784",marginLeft:6}}>+₹{(aW*meta.wager).toLocaleString()}</span>}</span>
                      <span><span style={{color:"#4fc3f7"}}>Varun: {vW}W</span>{vW>0&&<span style={{color:"#81c784",marginLeft:6}}>+₹{(vW*meta.wager).toLocaleString()}</span>}</span>
                    </div>
                  </div>
                );
              })}
              <div style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#333",textAlign:"center",marginTop:12}}>
                Via football-data.org · Live 60s · Idle 5min · Schedule 10min
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScorePill({name,total,color,leading}) {
  return (
    <div style={{textAlign:"center"}}>
      <div style={{fontFamily:"'Inter',sans-serif",fontSize:11,color:"#444",letterSpacing:1}}>{name}</div>
      <div style={{fontSize:22,letterSpacing:2,color}}>₹{total.toLocaleString()}</div>
      <div style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:"#555"}}>wagers won</div>
      {leading&&<div style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:"#81c784",marginTop:2}}>● LEADING</div>}
    </div>
  );
}
