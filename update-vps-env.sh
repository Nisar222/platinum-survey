#!/bin/bash

# This script helps you update the .env files on VPS to include GOOGLE_SPREADSHEET_ID
# Run this AFTER deploying the code changes

echo "🔧 Updating VPS environment variables..."
echo ""
echo "⚠️  IMPORTANT: You need to add GOOGLE_SPREADSHEET_ID to both environments"
echo ""

# VPS Configuration
SSH_KEY="~/.ssh/AYN3cx.pem"
VPS_USER="ubuntu"
VPS_HOST="3.29.240.212"

echo "📝 Instructions:"
echo ""
echo "1. SSH into your VPS:"
echo "   ssh -i ${SSH_KEY} ${VPS_USER}@${VPS_HOST}"
echo ""
echo "2. Update PRODUCTION .env:"
echo "   cd /home/ubuntu/projects/platinum-survey/platinum-survey"
echo "   nano .env"
echo "   # Add this line:"
echo "   GOOGLE_SPREADSHEET_ID=1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio"
echo "   # Save and exit (Ctrl+X, Y, Enter)"
echo ""
echo "3. Update SANDBOX .env:"
echo "   cd /home/ubuntu/projects/platinum-survey/platinum-survey-sandbox"
echo "   nano .env"
echo "   # Add this line with your SANDBOX sheet ID:"
echo "   GOOGLE_SPREADSHEET_ID=your-sandbox-spreadsheet-id"
echo "   # Save and exit (Ctrl+X, Y, Enter)"
echo ""
echo "4. Restart both environments:"
echo "   pm2 restart platinum-survey"
echo "   pm2 restart platinum-survey-sandbox"
echo "   pm2 logs --lines 50"
echo ""
echo "💡 Tip: Create a new Google Sheet for sandbox testing!"
echo "   Name it 'Platinum Survey - SANDBOX' to avoid confusion"
echo ""
