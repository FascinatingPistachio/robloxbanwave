# RBX Radar — Roblox Ban Alert Monitor

A fully static, zero-backend dashboard that monitors Reddit for Roblox ban wave alerts in real time.

## What it does

- Pulls from **r/robloxhackers** (newest posts)
- Pulls from **r/roblox** (search-filtered to ban/security keywords)
- Auto-badges any post mentioning: `ban wave`, `Byfron`, `Hyperion`, `patched`, `detected`, executor names, and more
- Auto-refreshes every 5 minutes
- Filter by source, sort by newest/top/alerts-first, and keyword search

## Deploy to Vercel (via GitHub)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "init"
gh repo create rbx-radar --public --push
# or manually create a repo on github.com and push
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New → Project**
3. Import your `rbx-radar` repository
4. Framework Preset: **Other**
5. Click **Deploy** — that's it

No environment variables, no build step, no server needed.

## How it works

Uses Reddit's **public JSON API** (`reddit.com/r/sub.json`) which is CORS-accessible directly from the browser. No API key required.

## Customising alert keywords

Edit the `BAN_KEYWORDS` array in `index.html` to add or remove trigger words.

## Files

```
index.html   — the entire app (HTML + CSS + JS)
vercel.json  — Vercel routing config
```
