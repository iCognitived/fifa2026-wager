export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { type } = req.query;

  const urls = {
    live:     "https://api.football-data.org/v4/competitions/WC/matches?status=IN_PLAY&season=2026",
    upcoming: "https://api.football-data.org/v4/competitions/WC/matches?status=SCHEDULED&season=2026",
    finished: "https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED&season=2026",
  };

  const url = urls[type];
  if (!url) return res.status(400).json({ error: "Invalid type. Use live, upcoming, or finished." });

  try {
    const r = await fetch(url, {
      headers: { "X-Auth-Token": "4dc0c0ec062f45c28e7df2b90136defd" }
    });
    const data = await r.json();
    // Pass through rate limit headers so frontend can show quota
    const remaining = r.headers.get("X-Requests-Available-Minute");
    if (remaining) res.setHeader("X-Requests-Available-Minute", remaining);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed", detail: err.message });
  }
}
