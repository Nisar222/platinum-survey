# Credentials Guide - Sandbox vs Production

## What You Were Worried About (FIXED!)

You were absolutely right to be concerned! The Google Spreadsheet ID **was** hardcoded in `server/index.js`, which meant both sandbox and production would write to the same sheet. **This has now been FIXED.**

---

## What Changed

### Before (BROKEN):
```javascript
// server/index.js line 287 and 454
const SPREADSHEET_ID = '1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio'; // Hardcoded!
```

### After (FIXED):
```javascript
// server/index.js line 287 and 454
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio';
```

Now each environment can use its own Google Sheet!

---

## Credentials: SAME vs DIFFERENT

### ✅ SAME for Both Environments
These credentials are **identical** between sandbox and production:

| Credential | Why Same? |
|------------|-----------|
| `GOOGLE_CREDENTIALS` | Same Google service account can access both sheets |
| `CX_API_URL` | Same 3CX phone system |
| `CX_USERNAME` | Same 3CX login |
| `CX_PASSWORD` | Same 3CX password |
| `VAPI_PUBLIC_KEY` | Same VAPI account |
| `VAPI_PRIVATE_KEY` | Same VAPI account |
| `VAPI_PHONE_NUMBER_ID` | Can use same phone number (or different if you prefer) |

### ⚠️ DIFFERENT for Each Environment
These **MUST be different** to keep sandbox and production separate:

| Credential | Production | Sandbox | Why Different? |
|------------|------------|---------|----------------|
| `PORT` | `3000` | `3001` | Can't run both on same port |
| `GOOGLE_SPREADSHEET_ID` | `1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio` | Create new sheet | Keep test data separate |
| `VAPI_ASSISTANT_ID` | Your production assistant | Create new assistant | Test different prompts |

---

## Step-by-Step: What You Need to Do

### Step 1: Deploy the Fix ✅ (DONE)
The code changes are already pushed to GitHub on both `main` and `sandbox` branches.

### Step 2: Create Sandbox Google Sheet (DO THIS NOW)

1. Go to Google Sheets: https://sheets.google.com
2. Create a new sheet named: **"Platinum Survey - SANDBOX"**
3. Copy the exact same header row from your production sheet:
   - Customer Name
   - Call Timestamp
   - Policy Used
   - Rating
   - Customer Feedback
   - Feedback Sentiment
   - Call Summary
   - Callback
   - Callback Schedule
   - Callback Attempt
   - Phone Number
   - Next Callback Date
   - Extension
4. Copy the new sheet ID from the URL:
   - URL looks like: `https://docs.google.com/spreadsheets/d/XXXXXXXXXXXXX/edit`
   - The `XXXXXXXXXXXXX` part is your new sandbox sheet ID
5. Share this sheet with your Google service account (same email as production sheet)

### Step 3: Create Sandbox VAPI Assistant (DO THIS NOW)

1. Go to VAPI dashboard: https://vapi.ai
2. Create a new assistant named: **"Platinum Survey - SANDBOX"**
3. Copy all settings from your production assistant
4. Copy the new assistant ID

### Step 4: Pull Updates and Add Environment Variables on VPS

SSH into your VPS and run these commands:

```bash
# SSH to VPS
ssh -i ~/.ssh/AYN3cx.pem ubuntu@3.29.240.212

# Update PRODUCTION environment
cd /home/ubuntu/projects/platinum-survey/platinum-survey
git pull origin main
npm install

# Edit production .env
nano .env

# Add this line (if not already there):
# GOOGLE_SPREADSHEET_ID=1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio

# Save and exit (Ctrl+X, Y, Enter)

# Update SANDBOX environment
cd /home/ubuntu/projects/platinum-survey/platinum-survey-sandbox
git pull origin sandbox
npm install

# Edit sandbox .env
nano .env

# Add these lines with YOUR new sandbox values:
# VAPI_ASSISTANT_ID=your-new-sandbox-assistant-id
# GOOGLE_SPREADSHEET_ID=your-new-sandbox-sheet-id

# Save and exit (Ctrl+X, Y, Enter)

# Restart both environments
pm2 restart platinum-survey
pm2 restart platinum-survey-sandbox

# Check logs to verify everything works
pm2 logs --lines 50
```

### Step 5: Test Both Environments

1. **Test Production** (should still work exactly as before):
   - URL: http://3.29.240.212:3000
   - Check that data still goes to original Google Sheet

2. **Test Sandbox**:
   - URL: http://3.29.240.212:3001
   - Make a test call
   - Verify data goes to NEW sandbox Google Sheet

---

## Why This Fix Matters

**Before:** Both sandbox and production wrote to the same Google Sheet, so testing in sandbox would pollute your production data.

**After:** Each environment writes to its own sheet, so you can:
- Test new features in sandbox without affecting production data
- Share sandbox URL with customers for testing
- Keep production data clean and accurate
- Easily identify which environment generated which data

---

## Quick Checklist

- [x] Code updated to use environment variable (DONE)
- [x] Code pushed to GitHub main and sandbox branches (DONE)
- [ ] Create new Google Sheet for sandbox
- [ ] Copy sheet ID from URL
- [ ] Share sheet with Google service account
- [ ] Create new VAPI assistant for sandbox
- [ ] Copy new assistant ID
- [ ] SSH to VPS
- [ ] Pull latest code on production (git pull origin main)
- [ ] Pull latest code on sandbox (git pull origin sandbox)
- [ ] Add GOOGLE_SPREADSHEET_ID to production .env
- [ ] Add GOOGLE_SPREADSHEET_ID and VAPI_ASSISTANT_ID to sandbox .env
- [ ] Restart both PM2 processes
- [ ] Test production URL
- [ ] Test sandbox URL
- [ ] Verify data goes to correct sheets

---

## Need Help?

If you get stuck, check:
1. PM2 logs: `pm2 logs --lines 100`
2. Environment status: `pm2 status`
3. Environment variables: `cat .env` (in each project directory)

**Remember:** This fix prevents the "hours of troubleshooting" you were worried about! Now sandbox and production are truly separate.
