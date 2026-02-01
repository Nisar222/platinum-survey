# Simple Deployment Workflow

## Your Setup (No More Sandbox Confusion!)

**Local Development:** Your Mac at `/Users/nisarkhan/Documents/dev2/platinum-survey`
**Production:** VPS at http://3.29.240.212:3000

---

## Daily Workflow

1. **Make changes on your Mac**
   - Edit files
   - Test locally by running `npm start`
   - Access at http://localhost:3000

2. **Deploy to production**
   ```bash
   ./deploy-to-vps.sh
   ```

That's it! No sandbox, no confusion, no duplicate credentials.

---

## What the Deploy Script Does

1. Commits your changes with timestamp
2. Pushes to GitHub (main branch)
3. SSHs to VPS
4. Pulls latest code
5. Installs dependencies
6. Restarts PM2
7. Shows you the logs

---

## Recent Fix

The Google Spreadsheet ID is now an environment variable instead of being hardcoded. This makes the code cleaner, but you don't need to worry about it - it's already configured in production.

---

## Going Live Monday

You're ready! Just:
1. Test everything locally
2. Run `./deploy-to-vps.sh`
3. Check http://3.29.240.212:3000
4. You're live!
