#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting deployment to VPS...${NC}\n"

# Step 1: Push to GitHub
echo -e "${BLUE}📤 Pushing to GitHub...${NC}"
git add .
git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')"
git push origin main

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to push to GitHub${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Pushed to GitHub${NC}\n"

# Step 2: Deploy to VPS
echo -e "${BLUE}🔄 Deploying to VPS...${NC}"

# VPS Configuration
SSH_KEY="~/.ssh/AYN3cx.pem"
VPS_USER="ubuntu"
VPS_HOST="3.29.240.212"
PROJECT_PATH="/home/ubuntu/projects/platinum-survey/platinum-survey"

ssh -i ${SSH_KEY} ${VPS_USER}@${VPS_HOST} << 'ENDSSH'
  cd /home/ubuntu/projects/platinum-survey/platinum-survey

  echo "📥 Pulling latest code from GitHub..."
  git pull origin main

  if [ $? -ne 0 ]; then
    echo "❌ Failed to pull from GitHub"
    exit 1
  fi

  echo "📦 Installing dependencies..."
  npm install

  echo "🔄 Restarting PM2 application..."
  pm2 restart platinum-survey

  echo "📊 Checking application status..."
  pm2 status platinum-survey

  echo ""
  echo "📝 Last 20 lines of logs:"
  pm2 logs platinum-survey --lines 20 --nostream

  echo ""
  echo "✅ Deployment completed successfully!"
ENDSSH

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✅ Deployment complete!${NC}"
    echo -e "${GREEN}🌐 Your app should now be running on the VPS${NC}"
else
    echo -e "\n${RED}❌ Deployment failed. Check the errors above.${NC}"
    exit 1
fi
