export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { type } = req.query;

  const BASE = "https://api.football-data.org/v4/competitions/WC/matches";
  const headers = { "X-Auth-Token": "4dc0c0ec062f45c28e7df2b90136defd" };

  // FIX: "live" now fetches both IN_PLAY and PAUSED (half-time) and merges them
  // so matches don't disappear from the Live tab during the break
  if (type === "live") {
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${BASE}?status=IN_PLAY&season=2026`,  { headers }),
        fetch(`${BASE}?status=PAUSED&season=2026`,   { headers }),
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      const matches = [...(d1.matches || []), ...(d2.matches || [])];
      return res.status(200).json({ matches });
    } catch (err) {
      return res.status(500).json({ error: "Fetch failed", detail: err.message });
    }
  }

  const urls = {
    upcoming: `${BASE}?status=SCHEDULED&season=2026`,
    finished: `${BASE}?status=FINISHED&season=2026`,
  };

  const url = urls[type];
  if (!url) return res.status(400).json({ error: "Invalid type. Use live, upcoming, or finished." });

  try {
    const r = await fetch(url, { headers });
    const data = await r.json();
    const remaining = r.headers.get("X-Requests-Available-Minute");
    if (remaining) res.setHeader("X-Requests-Available-Minute", remaining);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed", detail: err.message });
  }
}
