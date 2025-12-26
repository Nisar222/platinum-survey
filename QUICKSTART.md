# Quick Start Guide - AYN Digital Vapi Web Call App

## 🚀 Get Started in 3 Steps

### Step 1: Install Dependencies
```bash
cd vapi-web-call-app
npm install
```

### Step 2: Verify Configuration
The `.env` file is already configured with your Vapi credentials:
- ✅ Public Key
- ✅ Assistant ID  
- ✅ Phone Number ID

### Step 3: Run the Application
```bash
npm start
```

Then open your browser to: **http://localhost:3000**

---

## 📱 Using the Application

### Make a Web Call
1. Enter customer name in the input field
2. Click "Start Web Call"
3. Watch the magic happen! 🎉

The app will:
- ✅ Connect to your Vapi assistant
- ✅ Greet the customer by name
- ✅ Show real-time call status
- ✅ Display live transcript
- ✅ Generate post-call summary

---

## 🌐 Deploy to AWS VPS (UAE)

### Quick Deployment
```bash
# On your AWS VPS
cd /home/username
# Upload the app folder here

cd vapi-web-call-app
chmod +x deploy.sh
./deploy.sh
```

The deployment script will:
1. ✅ Install Node.js, PM2, and Nginx
2. ✅ Configure the application
3. ✅ Setup reverse proxy
4. ✅ Configure firewall
5. ✅ Optionally install SSL certificate

---

## 🎨 Customization

### Change Assistant Greeting
Edit in `public/js/app.js`:
```javascript
firstMessage: `Hello ${customerName}! Your custom message here...`
```

### Modify Colors
Edit brand colors in `public/css/styles.css`:
```css
--color-teal: #2BB8D1;
--color-purple: #6B4D9C;
```

---

## 🔧 Useful Commands

### Development
```bash
npm run dev          # Run with auto-restart
```

### Production (PM2)
```bash
pm2 start server/index.js --name vapi-web-app
pm2 logs vapi-web-app
pm2 restart vapi-web-app
pm2 stop vapi-web-app
pm2 monit
```

### View Logs
```bash
# Application logs
pm2 logs vapi-web-app

# Nginx logs (if deployed)
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## 🆘 Troubleshooting

### Call won't start?
- Check browser console (F12) for errors
- Verify microphone permissions
- Ensure Vapi credentials in `.env` are correct

### Can't access on domain?
- Check nginx configuration: `sudo nginx -t`
- Verify firewall: `sudo ufw status`
- Check PM2 status: `pm2 status`

### Port 3000 already in use?
Change port in `.env`:
```env
PORT=8080
```

---

## 📞 Support

- **Vapi Documentation**: https://docs.vapi.ai
- **Application Issues**: Check `README.md` for detailed troubleshooting

---

## ✨ What's Next? (Phase 2)

The app is ready for:
- 📊 Bulk Excel upload
- 🔄 Automated sequential calls
- 📈 Google Sheets integration
- 📋 Campaign management

Just uncomment the Phase 2 section in the HTML!

---

**Built with ❤️ by AYN Digital**
