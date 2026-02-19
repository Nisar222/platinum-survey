# Platinum Survey — Claude Code Instructions

## VPS / Deployment
- **Production VPS**: `root@23.95.110.150`
- **SSH**: Key-based auth configured (no password needed)
- **App directory**: `~/Projects/platinum-survey`
- **App URL**: `https://platinum-survey.ayndigital.com`
- **Process manager**: PM2 — process name `platinum-survey`

### Standard deploy command
```bash
ssh root@23.95.110.150 "cd ~/Projects/platinum-survey && git pull && pm2 restart platinum-survey"
```

### DB location
- **Production DB**: `/var/data/platinum-survey/batches.db` (outside project folder, safe from git pull)
- **Local backups**: `~/Documents/dev2/platinum-survey/backups/batches-YYYYMMDD.db`
- VPS cron: daily backup at 2 AM GST to `/var/data/platinum-survey/backups/`
- Mac cron: daily pull at 8 AM via SCP to local backups folder
- **Never commit or overwrite the DB file**

## Stack
- Node.js / Express backend
- SQLite via `better-sqlite3`
- VAPI for outbound calling
- Socket.IO for real-time UI updates
- nginx reverse proxy with SSL (Let's Encrypt)
- PM2 for process management

## Key Files
- `server/index.js` — main Express app, webhook handler, socket.io
- `server/routes/campaigns.js` — campaign API routes (fixed-path routes MUST be before `/:id` wildcard)
- `server/lib/campaign-processor.js` — call queue, VAPI integration, webhook/poller mutex
- `server/lib/retry-scheduler.js` — callback/retry scheduling
- `server/lib/business-hours.js` — timezone: Asia/Dubai, business hours 9-18
- `public/js/campaign-manager.js` — frontend logic
- `config/settings.json` — default settings (phoneNumberId etc.)

## Important Rules
- **Never auto-commit** unless explicitly asked
- **Never overwrite batches.db**
- Route ordering in campaigns.js: fixed paths before `/:id` wildcard
- Timezone is Asia/Dubai (GST, UTC+4) throughout
- Default phone number: Platinum SIM 1 (+971521453017), ID: `51df639c-77e9-418a-92f2-90fbeb2ddccd`
