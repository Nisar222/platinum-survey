# Deployment Guide

## One-Command Deployment to VPS

This project includes a deployment script that automatically pushes code to GitHub and deploys to your VPS.

## Setup (First Time Only)

1. **Edit the deployment script** with your VPS details:
   ```bash
   nano deploy-to-vps.sh
   ```

2. **Update these lines** (around line 23-25):
   ```bash
   VPS_USER="your-username"          # Replace with your VPS SSH username
   VPS_HOST="your-vps-ip"            # Replace with your VPS IP address
   PROJECT_PATH="/path/to/platinum-survey"  # Replace with actual path on VPS
   ```

3. **Also update** the path inside the SSH block (line 28):
   ```bash
   cd /path/to/platinum-survey  # Replace with actual path
   ```

4. **Ensure PM2 is set up** on your VPS:
   ```bash
   # SSH into VPS
   ssh your-username@your-vps-ip

   # Navigate to project
   cd /path/to/platinum-survey

   # Start with PM2
   pm2 start server/index.js --name platinum-survey
   pm2 save
   ```

## Usage

Every time you want to deploy changes:

```bash
./deploy-to-vps.sh
```

That's it! The script will:
1. ✅ Commit your changes
2. ✅ Push to GitHub
3. ✅ Pull on VPS
4. ✅ Install dependencies
5. ✅ Restart PM2
6. ✅ Show you the logs

## Manual Deployment

If you prefer to deploy manually:

```bash
# Push to GitHub
git add .
git commit -m "Your commit message"
git push origin main

# SSH and deploy
ssh your-username@your-vps-ip
cd /path/to/platinum-survey
git pull origin main
npm install
pm2 restart platinum-survey
```

## Troubleshooting

### Script says "Permission denied"
```bash
chmod +x deploy-to-vps.sh
```

### Git push fails
Make sure you've committed your changes first or have changes to commit.

### PM2 not found on VPS
Install PM2 globally on your VPS:
```bash
npm install -g pm2
```

### Changes not appearing
- Check PM2 logs: `pm2 logs platinum-survey`
- Verify PM2 status: `pm2 status`
- Check if server is running: `pm2 list`
