# ChargeFinder ⚡

EV charge planner — find DC fast charging stations near you and calculate time to 80% based on your vehicle profile and current battery level.

## Features

- Ford EV vehicle presets (Mustang Mach-E, F-150 Lightning, E-Transit) + custom EV support
- Live location-based DC fast charger search via Open Charge Map API
- Per-station charge math: arrival %, time to 80%, effective kW
- Map view (Leaflet, dark Carto tiles) + list view
- Out-of-range flagging with estimated remaining miles

## Tech

- Next.js 14 (App Router)
- TypeScript
- Leaflet.js (loaded client-side)
- Open Charge Map API (free, no key required)

---

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploy to Vercel

### Option A — Vercel CLI (fastest)

```bash
npm install -g vercel
vercel
```

Follow the prompts. Vercel auto-detects Next.js — no configuration needed.

### Option B — GitHub + Vercel dashboard

1. Push this folder to a new GitHub repo:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/chargefinder.git
git push -u origin main
```

2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo
3. Leave all build settings as defaults — Vercel detects Next.js automatically
4. Click **Deploy**

Your app will be live at `https://chargefinder-xxx.vercel.app` in ~60 seconds.

---

## Notes

- Charge time estimates assume a steady DC rate to 80%. Real-world curves taper slightly near 80%, so actual times may be a few minutes longer at high SOC.
- Open Charge Map is community-maintained; real-time stall availability requires network-specific APIs (ChargePoint, EVGO, Electrify America).
