# ⚽ FIFA 2026 Wager Tracker

A real-time wager tracker for Akshika vs Varun — FIFA World Cup 2026.

## Features
- 🔒 Fixed team allocation (locked, no changes)
- ☁ Firebase Firestore real-time sync (both devices stay live)
- 🔴 Live scores via API-Football (auto-refreshes every 60s)
- ⏳ Countdown to tournament start (June 11, 2026)
- 📊 Full summary with earnings & net per stage

---

## Deploy to Vercel (5 minutes)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "FIFA 2026 wager tracker"
git remote add origin https://github.com/YOUR_USERNAME/fifa2026-wager.git
git push -u origin main
```

### 2. Deploy on Vercel
1. Go to https://vercel.com → New Project
2. Import your GitHub repo
3. Framework: **Vite** (auto-detected)
4. Click **Deploy** — done!

### 3. Share the URL
Send your Vercel URL to Akshika — she opens it on any device, Firebase keeps you both in sync.

---

## Local Development
```bash
npm install
npm run dev
```

---

## Firebase Security (important!)
Once deployed, restrict your API key:
1. Go to https://console.firebase.google.com
2. Project Settings → API restrictions
3. Restrict to your Vercel domain only (e.g. `fifa2026-wager.vercel.app`)

Also update Firestore rules to read-only:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true; // open for now, restrict post-tournament
    }
  }
}
```
