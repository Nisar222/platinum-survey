# AYN Digital - Vapi Web Call Platform

![AYN Digital](public/AYN_DIGITAL-03_500px.png)

**Modern AI-Powered Voice Call Platform with Real-Time Transcription**

---

## 🌟 Features

### ✅ Phase 1 - Live Now
- 🎯 **One-Click Web Calls** - Instant voice connection via browser
- 👤 **Personalized Greetings** - Pass customer name to AI assistant
- 📊 **Real-Time Transcript** - Live conversation display
- 📞 **Call Controls** - Start and hang-up buttons
- 📈 **Post-Call Analytics** - Detailed summary with metrics
- 🎨 **Modern Tailwind UI** - Beautiful gradient design
- 🔄 **Live Updates** - Socket.IO powered real-time status

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start the application
npm start
```

Visit `http://localhost:3000`

---

## ⚙️ Configuration

Edit `.env` file:

```env
VAPI_PUBLIC_KEY=your_key_here
VAPI_ASSISTANT_ID=your_assistant_id
VAPI_PHONE_NUMBER_ID=your_phone_id
PORT=3000
```

---

## 📱 Usage

1. Enter customer name
2. Click "Start Web Call"
3. Allow microphone access
4. Have a conversation
5. Click "End Call" when done
6. View call summary

---

## 🎨 UI Features

- Modern Tailwind CSS design
- Gradient backgrounds (cyan → purple)
- Real-time transcript with role indicators
- Animated status indicators
- Responsive grid layout
- Smooth transitions

---

## 🔧 Development

```bash
npm run dev    # Development mode
npm start      # Production mode
```

---

## 🌐 Deployment

```bash
chmod +x deploy.sh
./deploy.sh
```

Handles: Node.js, PM2, Nginx, SSL, Firewall

---

## 📞 Support

Email: support@ayndigital.com
Docs: docs.vapi.ai

---

**Built with ❤️ by AYN Digital**
