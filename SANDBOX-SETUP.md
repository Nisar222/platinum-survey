# Sandbox & Production Environment Setup

## Overview

Your VPS now hosts two separate environments:

| Environment | Port | URL | PM2 Name | Branch |
|-------------|------|-----|----------|--------|
| **Production** | 3000 | http://3.29.240.212:3000 | `platinum-survey` | `main` |
| **Sandbox** | 3001 | http://3.29.240.212:3001 | `platinum-survey-sandbox` | `sandbox` |

---

## Initial Setup (Do This Once)

### Step 1: Create Sandbox Branch on Your Mac

```bash
# Create and switch to sandbox branch
git checkout -b sandbox

# Push to GitHub
git push origin sandbox

# Switch back to main
git checkout main
```

### Step 2: Set Up VPS Environments

```bash
# Run the setup script (it will SSH into VPS and set everything up)
./setup-vps-environments.sh
```

### Step 3: Configure Sandbox Environment Variables

SSH into your VPS and edit the sandbox `.env` file:

```bash
ssh -i ~/.ssh/AYN3cx.pem ubuntu@3.29.240.212
cd /home/ubuntu/projects/platinum-survey/platinum-survey-sandbox
nano .env
```

**Important:** Use SEPARATE credentials for sandbox:
- Different VAPI Assistant ID (create a sandbox assistant in VAPI)
- Different Google Sheet (create "Platinum Survey - SANDBOX" sheet)
- Same 3CX credentials (or use a test 3CX if available)

### Step 4: Restart Sandbox

```bash
pm2 restart platinum-survey-sandbox
pm2 logs platinum-survey-sandbox
```

---

## Daily Workflow

### Working on New Features

```bash
# 1. Create feature branch from sandbox
git checkout sandbox
git pull origin sandbox
git checkout -b feature/my-new-feature

# 2. Make your changes locally
# ... code code code ...

# 3. Test locally
npm start  # Runs on localhost:3000

# 4. Deploy to sandbox for customer testing
git checkout sandbox
git merge feature/my-new-feature
./deploy-to-sandbox.sh

# 5. Share sandbox URL with customers
# URL: http://3.29.240.212:3001

# 6. After testing and approval, merge to production
git checkout main
git merge sandbox
./deploy-to-vps.sh
```

---

## Deployment Commands

### Deploy to Sandbox (Port 3001)
```bash
./deploy-to-sandbox.sh
```
- Pushes to `sandbox` branch
- Deploys to sandbox environment
- Safe for testing with customers

### Deploy to Production (Port 3000)
```bash
./deploy-to-vps.sh
```
- Pushes to `main` branch
- Deploys to production environment
- **Only use after sandbox testing!**

---

## Environment Differences

### Sandbox (.env on VPS)
```env
PORT=3001
VAPI_ASSISTANT_ID=sandbox-assistant-id
GOOGLE_CREDENTIALS={"type":"service_account",...same as production...}
GOOGLE_SPREADSHEET_ID=sandbox-sheet-id
```

### Production (.env on VPS)
```env
PORT=3000
VAPI_ASSISTANT_ID=production-assistant-id
GOOGLE_CREDENTIALS={"type":"service_account",...}
GOOGLE_SPREADSHEET_ID=production-sheet-id
```

---

## Useful PM2 Commands (on VPS)

```bash
# View both environments
pm2 status

# View logs
pm2 logs platinum-survey              # Production logs
pm2 logs platinum-survey-sandbox      # Sandbox logs

# Restart specific environment
pm2 restart platinum-survey           # Restart production
pm2 restart platinum-survey-sandbox   # Restart sandbox

# Restart all
pm2 restart all

# Stop specific environment
pm2 stop platinum-survey-sandbox      # Stop sandbox only
```

---

## Troubleshooting

### Sandbox not accessible?
Check if it's running on the correct port:
```bash
ssh -i ~/.ssh/AYN3cx.pem ubuntu@3.29.240.212
pm2 logs platinum-survey-sandbox
```

### Port already in use?
Make sure production is on 3000 and sandbox is on 3001:
```bash
pm2 status
# Check PORT in each .env file
```

### Changes not reflecting?
Make sure you pushed to the correct branch:
```bash
# For sandbox
git branch  # Should show "sandbox"
git push origin sandbox

# For production
git branch  # Should show "main"
git push origin main
```

---

## Best Practices

1. ✅ **Always test in sandbox first** before deploying to production
2. ✅ **Use separate Google Sheets** - don't mix sandbox and production data
3. ✅ **Use separate VAPI assistants** - allows different prompts for testing
4. ✅ **Share sandbox URL with customers** for feedback before going live
5. ✅ **Keep main branch stable** - only merge from sandbox after testing
6. ⚠️ **Never deploy directly to production** without sandbox testing

---

## URLs Quick Reference

- **Sandbox**: http://3.29.240.212:3001 (for testing)
- **Production**: http://3.29.240.212:3000 (for live use)

Share the sandbox URL with customers when you need feedback!
