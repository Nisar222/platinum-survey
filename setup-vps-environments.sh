#!/bin/bash

# VPS Dual Environment Setup Script
# Run this ONCE on your VPS to set up both sandbox and production

echo "🚀 Setting up Sandbox and Production environments on VPS..."
echo ""

# VPS Configuration
SSH_KEY="~/.ssh/AYN3cx.pem"
VPS_USER="ubuntu"
VPS_HOST="3.29.240.212"

ssh -i ${SSH_KEY} ${VPS_USER}@${VPS_HOST} << 'ENDSSH'

echo "📁 Creating directory structure..."

# Create base directory if it doesn't exist
mkdir -p /home/ubuntu/projects/platinum-survey

# Navigate to projects directory
cd /home/ubuntu/projects/platinum-survey

# Production is already set up at:
# /home/ubuntu/projects/platinum-survey/platinum-survey

echo "✅ Production directory exists at: $(pwd)/platinum-survey"

# Clone sandbox repository
echo "📦 Setting up Sandbox environment..."

if [ -d "platinum-survey-sandbox" ]; then
  echo "⚠️  Sandbox directory already exists, skipping clone..."
else
  echo "📥 Cloning repository for sandbox..."
  git clone https://github.com/Nisar222/platinum-survey.git platinum-survey-sandbox
  cd platinum-survey-sandbox
  git checkout -b sandbox origin/sandbox || git checkout sandbox
fi

# Navigate to sandbox
cd /home/ubuntu/projects/platinum-survey/platinum-survey-sandbox

echo "📦 Installing dependencies for sandbox..."
npm install

echo "📝 Creating .env file for sandbox..."
cat > .env << 'EOF'
# Sandbox Environment Variables
# IMPORTANT: Use separate VAPI assistant and Google Sheet for sandbox!

# VAPI Configuration (Use SANDBOX assistant)
VAPI_PUBLIC_KEY=your-sandbox-public-key
VAPI_PRIVATE_KEY=your-sandbox-private-key
VAPI_ASSISTANT_ID=your-sandbox-assistant-id
VAPI_PHONE_NUMBER_ID=your-sandbox-phone-number-id

# 3CX Configuration (can use same as production or separate test system)
CX_API_URL=https://your-3cx-server.com:5001
CX_USERNAME=your-3cx-username
CX_PASSWORD=your-3cx-password

# Google Sheets (Use SEPARATE sheet for sandbox testing!)
GOOGLE_CREDENTIALS={"type":"service_account","project_id":"your-project"}
GOOGLE_SPREADSHEET_ID=your-sandbox-spreadsheet-id

# Server Port (MUST be different from production)
PORT=3001
EOF

echo "⚙️  Setting up PM2 for sandbox..."
pm2 start server/index.js --name platinum-survey-sandbox
pm2 save

echo ""
echo "✅ Setup complete!"
echo ""
echo "📊 Environment Summary:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🟢 Production:"
echo "   Path: /home/ubuntu/projects/platinum-survey/platinum-survey"
echo "   Port: 3000"
echo "   URL:  http://3.29.240.212:3000"
echo "   PM2:  platinum-survey"
echo ""
echo "🟡 Sandbox:"
echo "   Path: /home/ubuntu/projects/platinum-survey/platinum-survey-sandbox"
echo "   Port: 3001"
echo "   URL:  http://3.29.240.212:3001"
echo "   PM2:  platinum-survey-sandbox"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next Steps:"
echo "1. Edit sandbox .env file: nano /home/ubuntu/projects/platinum-survey/platinum-survey-sandbox/.env"
echo "2. Add your sandbox VAPI credentials and Google Sheet ID"
echo "3. Restart sandbox: pm2 restart platinum-survey-sandbox"
echo "4. Check status: pm2 status"
echo ""

ENDSSH

echo "✅ VPS setup complete!"
echo ""
echo "🎯 What to do next on your Mac:"
echo "1. Create sandbox branch: git checkout -b sandbox"
echo "2. Push to GitHub: git push origin sandbox"
echo "3. SSH to VPS and edit sandbox .env with proper credentials"
echo "4. Use ./deploy-to-sandbox.sh to deploy to sandbox"
echo "5. Use ./deploy-to-vps.sh to deploy to production"
