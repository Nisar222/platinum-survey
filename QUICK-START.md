# Quick Start Guide - Sandbox & Production Setup

## 🚀 Get Started in 5 Minutes

### Step 1: Create Sandbox Branch (On Your Mac)
```bash
cd /Users/nisarkhan/Documents/dev2/platinum-survey
git checkout -b sandbox
git push origin sandbox
git checkout main
```

### Step 2: Run VPS Setup Script (On Your Mac)
```bash
./setup-vps-environments.sh
```

This will:
- ✅ Clone sandbox repository on VPS
- ✅ Install dependencies
- ✅ Create sandbox .env template
- ✅ Set up PM2 for sandbox

### Step 3: Configure Sandbox Credentials (On VPS)

**You need to update the sandbox `.env` file with SEPARATE credentials!**

SSH into VPS:
```bash
ssh -i ~/.ssh/AYN3cx.pem ubuntu@3.29.240.212
```

Edit sandbox environment file:
```bash
nano /home/ubuntu/projects/platinum-survey/platinum-survey-sandbox/.env
```

**Required Changes:**
1. Create a NEW VAPI assistant for sandbox (in VAPI dashboard)
2. Create a NEW Google Sheet called "Platinum Survey - SANDBOX"
3. Update the .env with these new values:

```env
PORT=3001
VAPI_PUBLIC_KEY=your-sandbox-public-key
VAPI_PRIVATE_KEY=your-sandbox-private-key
VAPI_ASSISTANT_ID=your-sandbox-assistant-id
VAPI_PHONE_NUMBER_ID=your-phone-number-id
GOOGLE_CREDENTIALS={"type":"service_account",...your credentials...}
GOOGLE_SPREADSHEET_ID=your-sandbox-sheet-id
CX_API_URL=https://your-3cx-server.com:5001
CX_USERNAME=your-username
CX_PASSWORD=your-password
```

Save and restart:
```bash
pm2 restart platinum-survey-sandbox
pm2 logs platinum-survey-sandbox
```

### Step 4: Test Both Environments

- **Sandbox**: http://3.29.240.212:3001
- **Production**: http://3.29.240.212:3000

---

## 📦 Daily Usage

### Deploy to Sandbox (for testing)
```bash
./deploy-to-sandbox.sh
```

### Deploy to Production (after sandbox testing)
```bash
./deploy-to-vps.sh
```

---

## 📋 Checklist

- [ ] Created `sandbox` branch on GitHub
- [ ] Ran `./setup-vps-environments.sh`
- [ ] Created separate VAPI assistant for sandbox
- [ ] Created separate Google Sheet for sandbox
- [ ] Updated sandbox `.env` on VPS
- [ ] Restarted sandbox with `pm2 restart platinum-survey-sandbox`
- [ ] Tested sandbox URL: http://3.29.240.212:3001
- [ ] Tested production URL: http://3.29.240.212:3000

---

## 🆘 Need Help?

See detailed documentation: [SANDBOX-SETUP.md](SANDBOX-SETUP.md)
