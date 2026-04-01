import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import XLSX from 'xlsx';
import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import rateLimit from 'express-rate-limit';
import { initializeDatabase, getDatabase, recoverStuckCalls } from './db/database.js';
import CampaignProcessor from './lib/campaign-processor.js';
import RetryScheduler from './lib/retry-scheduler.js';
import { initiateVapiCall } from './lib/vapi-call.js';
import CampaignScheduler from './lib/campaign-scheduler.js';
import campaignRoutes from './routes/campaigns.js';
import scheduleRoutes from './routes/schedules.js';
import { calculateNextRetry } from './lib/business-hours.js';
import { sendCrashAlert, checkSSLExpiry } from './lib/alerting.js';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { requireAuth } from './middleware/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/recordings', express.static('/var/data/platinum-survey/recordings'));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// Rate limiting — 200 requests per minute per IP for API routes
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel files are allowed.'));
    }
  }
});

// Store active calls
const activeCalls = new Map();

// API Routes
app.get('/api/config', (req, res) => {
  res.json({
    publicKey: process.env.VAPI_PUBLIC_KEY,
    assistantId: process.env.VAPI_ASSISTANT_ID,
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID
  });
});

// Test endpoint to simulate call results (for development/testing)
app.get('/api/test-call-results', (req, res) => {
  const testCallData = {
    customerName: 'John Doe (Test)',
    callTimestamp: new Date().toISOString(),
    policyUsed: 'Premium Support Policy',
    rating: 4,
    customerFeedback: 'The service was good, but I had to wait a bit longer than expected.',
    customerSentiment: 'positive',
    feedbackScore: 8,
    feedbackSummary: 'Customer was satisfied with the overall service quality. Main concern was wait time, but appreciated the thorough assistance provided. Would recommend to others.',
    callSummary: 'Customer called regarding account upgrade. Successfully processed request and explained new benefits.',
    callback: false,
    callbackSchedule: null,
    callbackAttempt: 1,
    duration: 157
  };

  res.json(testCallData);
});

// Endpoint to initiate a phone call via VAPI
app.post('/api/start-phone-call', async (req, res) => {
  try {
    const { customerName, phoneNumber } = req.body;

    if (!customerName || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Customer name and phone number are required'
      });
    }

    console.log('📞 Initiating phone call to:', phoneNumber);
    console.log('👤 Customer name:', customerName);

    const vapiResult = await initiateVapiCall({ phoneNumber, customerName });

    console.log('✅ Phone call initiated successfully:', vapiResult);

    res.json({
      success: true,
      callId: vapiResult.id || vapiResult.call?.id,
      message: 'Phone call initiated successfully'
    });

  } catch (error) {
    console.error('❌ Error starting phone call:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initiate phone call'
    });
  }
});

// Endpoint to end a phone call via 3CX Call Control
app.delete('/api/end-phone-call/:callId', async (req, res) => {
  try {
    const { callId, phoneNumber } = req.body; // Get phone number from request body

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required to disconnect call'
      });
    }

    console.log('📴 Ending phone call via 3CX for:', phoneNumber);

    // Validate 3CX credentials
    if (!process.env.CX_API_URL || !process.env.CX_USERNAME || !process.env.CX_PASSWORD) {
      throw new Error('3CX credentials not configured. Please set CX_API_URL, CX_USERNAME, and CX_PASSWORD');
    }

    // Use 3CX API to disconnect the call
    // First, authenticate with 3CX
    const authResponse = await fetch(`${process.env.CX_API_URL}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: process.env.CX_USERNAME,
        password: process.env.CX_PASSWORD
      })
    });

    if (!authResponse.ok) {
      throw new Error('Failed to authenticate with 3CX');
    }

    const authData = await authResponse.json();
    const sessionId = authData.SessionId;

    // Get active calls to find the call ID
    const callsResponse = await fetch(`${process.env.CX_API_URL}/api/ActiveCalls`, {
      method: 'GET',
      headers: {
        'Cookie': `session=${sessionId}`
      }
    });

    if (!callsResponse.ok) {
      throw new Error('Failed to get active calls from 3CX');
    }

    const activeCalls = await callsResponse.json();

    // Find the call with matching phone number
    const targetCall = activeCalls.find(call =>
      call.OtherPartyNumber === phoneNumber ||
      call.OtherPartyNumber.includes(phoneNumber.replace(/\D/g, ''))
    );

    if (!targetCall) {
      return res.status(404).json({
        success: false,
        error: 'Call not found in active calls'
      });
    }

    // Disconnect the call
    const disconnectResponse = await fetch(`${process.env.CX_API_URL}/api/DisconnectCall`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `session=${sessionId}`
      },
      body: JSON.stringify({
        CallId: targetCall.Id
      })
    });

    if (!disconnectResponse.ok) {
      throw new Error('Failed to disconnect call via 3CX');
    }

    console.log('✅ Phone call disconnected successfully via 3CX');

    res.json({
      success: true,
      message: 'Phone call disconnected successfully via 3CX'
    });

  } catch (error) {
    console.error('❌ Error ending phone call:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to disconnect phone call'
    });
  }
});

// Endpoint to process uploaded Excel file
app.post('/api/upload-contacts', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    // Validate data structure
    const validContacts = data.filter(row => 
      row['Customer Name'] && row['Phone Number']
    ).map(row => ({
      name: row['Customer Name'],
      phone: row['Phone Number']
    }));

    res.json({
      success: true,
      contacts: validContacts,
      total: validContacts.length
    });

    // Clean up uploaded file
    import('fs').then(fs => {
      fs.unlinkSync(req.file.path);
    });

  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Error processing file' });
  }
});

// Google Sheets API endpoint
app.post('/api/log-to-sheets', async (req, res) => {
  try {
    const callData = req.body;
    console.log('📊 Logging to Google Sheets:', callData);

    // Google Sheets configuration
    const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio';
    const RANGE = 'Sheet1!A1:M'; // Columns A through M (13 columns to match sheet structure)

    // Initialize Google Sheets API
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Prepare row data to match Google Sheet structure (13 columns)
    const row = [
      callData.customerName || '',           // A: Customer Name
      callData.callTimestamp || '',          // B: Call Timestamp
      callData.policyUsed || '',             // C: Policy Used
      callData.rating || '',                 // D: Rating
      callData.customerFeedback || '',       // E: Customer Feedback
      callData.customerSentiment || '',      // F: Feedback Sentiment
      callData.callSummary || '',            // G: Call Summary
      callData.callback ? 'TRUE' : 'FALSE',  // H: Callback
      callData.callbackSchedule || '',       // I: Callback Schedule
      callData.callbackAttempt || 1,         // J: Callback Attempt
      callData.duration || 0,                // K: Call Disposition (using duration)
      callData.transcriptText || '',         // L: Call Transcript
      callData.stereoRecordingUrl || ''      // M: Call Recording
    ];

    // Append to Google Sheets - explicitly specify to start from column A
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS', // This ensures new rows are inserted, not appended to existing structure
      requestBody: {
        values: [row],
      },
    });

    console.log('✅ Successfully logged to Google Sheets');
    res.json({ success: true });

  } catch (error) {
    console.error('❌ Error logging to Google Sheets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook health check (GET) - for browser testing
app.get('/api/webhook/calls', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Call webhook endpoint is active',
    timestamp: new Date().toISOString()
  });
});

// Webhook endpoint for call platform events
const handleCallWebhook = async (req, res) => {
  // VAPI webhook secret verification
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = req.headers['x-vapi-secret'];
    if (signature !== webhookSecret) {
      console.warn('⚠️  Webhook rejected: invalid secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { message } = req.body;

  console.log('🔔 Call webhook received:', {
    type: message?.type,
    callId: message?.call?.id,
    callStatus: message?.call?.status,
    endedReason: message?.call?.endedReason,
    hasArtifact: !!message?.artifact,
    hasStructuredOutputs: !!(message?.artifact?.structuredOutputs),
    timestamp: new Date().toISOString()
  });

  try {
    // Handle different message types
    switch (message?.type) {
      case 'status-update':
        console.log(`📞 Call ${message.call?.id}: ${message.call?.status}`);
        break;

      case 'transcript':
        console.log(`💬 ${message.role}: ${message.transcript}`);
        break;

      case 'end-of-call-report':
        console.log('📊 End of call report received');
        console.log('  📞 Call ID:', message.call?.id);
        console.log('  📋 Metadata (call):', JSON.stringify(message.call?.metadata));
        console.log('  📋 Metadata (top):', JSON.stringify(message.metadata));
        console.log('  📋 message.call keys:', message.call ? Object.keys(message.call).join(', ') : 'NO CALL OBJECT');
        console.log('  ⏱️  Duration:', message.call?.startedAt, '->', message.call?.endedAt);
        console.log('  🔚 Ended reason:', message.call?.endedReason);
        console.log('  📝 Has artifact:', !!message.artifact);
        console.log('  📊 Has structured outputs:', !!(message.artifact?.structuredOutputs));
        console.log('  📃 Has transcript:', !!(message.artifact?.transcript));

        // Check for campaign identifiers - prefer variableValues (reliable), fallback to metadata
        const vars = message.call?.assistantOverrides?.variableValues
          || message.assistantOverrides?.variableValues
          || message.call?.variableValues
          || {};
        const metadata = message.call?.metadata || message.metadata || {};
        const contactId = vars._contactId ? parseInt(vars._contactId) : metadata.contactId;
        const campaignIdFromVars = vars._campaignId ? parseInt(vars._campaignId) : null;
        const batchId = metadata.batchId;
        console.log('  🔗 variableValues:', JSON.stringify(vars));
        console.log('  🔗 Contact ID:', contactId, '| Campaign/Batch ID:', campaignIdFromVars || metadata.campaignId || batchId);

        // Parse structured outputs if present (may be absent for no-answer/hung-up calls)
        const flattenStructured = (outputs) => {
          if (!outputs) return [];
          if (Array.isArray(outputs)) return outputs;
          if (typeof outputs === 'object') return Object.values(outputs);
          return [];
        };

        const outputs = flattenStructured(message.artifact?.structuredOutputs);

        // If a structured output result is an object (e.g. {sentiment: "...", sentimentReason: "..."})
        // flatten it to a readable string so it can be stored in DB/Sheets as plain text
        const flattenResult = (val) => {
          if (val === null || val === undefined) return val;
          if (typeof val !== 'object') return val;
          // Pick the most meaningful single field if it exists, otherwise JSON
          if (val.sentiment !== undefined) return val.sentiment;
          if (val.summary !== undefined) return val.summary;
          if (val.disposition !== undefined) return val.disposition;
          return Object.values(val).filter(v => typeof v === 'string').join(' — ') || JSON.stringify(val);
        };

        const getByName = (name) => {
          const result = outputs.find(
            (o) => o.name?.toLowerCase() === name.toLowerCase()
          )?.result;
          return flattenResult(result);
        };

        if (outputs.length > 0) {
          console.log('✅ Structured outputs found:', JSON.stringify(message.artifact.structuredOutputs, null, 2));
        } else {
          console.log('⚠️  No structured outputs — using transcript/endedReason for disposition');
        }

        // Extract the data we care about (safe defaults when structured outputs absent)
        const structuredData = {
          customerName: getByName('Customer Name'),
          policyUsed: getByName('Policy Used'),
          rating: getByName('Feedback Score'),
          customerFeedback: getByName('Customer Feedback'),
          customerSentiment: getByName('Customer Sentiment'),
          feedbackSummary: getByName('Feedback Summary'),
          callSummary: getByName('Call Summary'),
          callDisposition: getByName('Call Disposition'),
          callback: getByName('Callback') ?? false,
          callbackSchedule: getByName('Callback Schedule'),
          callbackAttempt: getByName('Callback Attempt'),
          escalationRequired: getByName('Escalation Required') ?? false,
        };

        // Prepare call data
        const callTimestampRaw = message.call?.startedAt || message.timestamp || Date.now();
        const callTimestampIso = new Date(callTimestampRaw).toISOString();

        const callData = {
          customerName: structuredData.customerName ||
            message.call?.customer?.name ||
            message.call?.variables?.customerName ||
            '',
          callTimestamp: callTimestampIso,
          policyUsed: structuredData.policyUsed || '',
          rating: structuredData.rating || '',
          customerFeedback: structuredData.customerFeedback || '',
          customerSentiment: structuredData.customerSentiment || '',
          feedbackSummary: structuredData.feedbackSummary || '',
          callSummary: structuredData.callSummary || message.artifact?.summary || '',
          callback: structuredData.callback || false,
          callbackSchedule: structuredData.callbackSchedule || '',
          callbackAttempt: structuredData.callbackAttempt || 1,
          duration: message.call?.startedAt && message.call?.endedAt
            ? Math.round((new Date(message.call.endedAt) - new Date(message.call.startedAt)) / 1000)
            : (message.artifact?.duration || message.call?.duration || message.duration || 0),
          callDisposition: structuredData.callDisposition || '',
          escalationRequired: structuredData.escalationRequired || false,
          transcriptText: message.artifact?.transcript || message.call?.transcript || message.transcript || '',
          stereoRecordingUrl: message.artifact?.stereoRecordingUrl || message.call?.stereoRecordingUrl || '',
          vapiCallId: message.call?.id || message.callId || '',
          endedReason: message.call?.endedReason || message.endedReason || '',
          phoneNumber: message.call?.customer?.number || ''
        };

        console.log('📤 Prepared call data:', callData);

        // ACK immediately — do NOT await processing. VAPI has a short webhook timeout
        // (~20s) and will retry if we don't respond fast. Processing happens async below.
        res.status(200).json({ received: true });

        // Route to campaign processor or single call handler (async, after 200 sent)
        // NOTE: Always route campaign calls even when structured outputs are absent —
        // determineDisposition() uses transcript keywords + endedReason as fallback
        const campaignIdResolved = campaignIdFromVars || metadata.campaignId || batchId;
        setImmediate(async () => {
          try {
            if (contactId && campaignIdResolved) {
              // CAMPAIGN CALL - Route to campaign processor
              console.log(`📦 Campaign call detected: Contact ${contactId}, Campaign ${campaignIdResolved}`);
              await batchProcessor.handleCallComplete(contactId, callData);
            } else {
              // SINGLE CALL — log to test_calls table
              console.log('📱 Single call - logging to test_calls DB');
              try {
                const db = getDatabase();
                db.prepare(`
                  INSERT INTO test_calls (
                    vapi_call_id, customer_name, phone_number,
                    call_status, call_disposition, duration_seconds,
                    rating, customer_sentiment, call_summary,
                    transcript_text, recording_url, ended_reason,
                    escalation_required, created_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                `).run(
                  callData.vapiCallId || null,
                  callData.customerName || null,
                  callData.phoneNumber || null,
                  callData.callDisposition ? 'completed' : 'unknown',
                  callData.callDisposition || null,
                  callData.duration || 0,
                  callData.rating || null,
                  callData.customerSentiment || null,
                  callData.callSummary || null,
                  callData.transcriptText || null,
                  callData.stereoRecordingUrl || null,
                  callData.endedReason || null,
                  callData.escalationRequired ? 1 : 0
                );
                console.log('✅ Single call logged to test_calls');
              } catch (error) {
                console.error('❌ Error logging single call to DB:', error);
              }

              if (outputs.length > 0) {
                try {
                  await logToGoogleSheets(callData);
                  console.log('✅ Single call logged to Google Sheets');
                } catch (error) {
                  console.error('❌ Error logging to Google Sheets from webhook:', error);
                }
              }
              io.emit('call-data-received', callData);
            }
          } catch (err) {
            console.error('❌ Async webhook processing error:', err);
          }
        });
        return; // skip the res.json at the bottom of the try block

      case 'call-end':
        console.log('📞 Call ended:', message);
        break;

      case 'function-call':
        console.log('🔧 Function call:', message);
        break;

      default:
        console.log('📨 Other message type:', message.type);
    }

    // Emit all events to connected clients via Socket.IO
    io.emit('call-event', message);

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ error: error.message });
  }
};
// Register webhook on both routes (legacy + clean URL)
app.post('/api/webhook/vapi', handleCallWebhook);
app.post('/api/webhook/calls', handleCallWebhook);

// Auth routes (unprotected)
app.get('/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = username === process.env.AUTH_USERNAME;
  const validPass = process.env.AUTH_PASSWORD_HASH
    ? bcrypt.compareSync(password, process.env.AUTH_PASSWORD_HASH)
    : false;
  if (validUser && validPass) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Protect all remaining routes
app.use(requireAuth);

// Helper function to log to Google Sheets (extracted for reuse)
async function logToGoogleSheets(callData) {
  const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio';
  const RANGE = 'Sheet1!A1:S'; // Columns A through S (19 columns)

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Prepare row data to match Google Sheet structure (18 columns)
  const row = [
    callData.customerName || '',                        // A: Customer Name
    callData.callTimestamp || '',                       // B: Call Timestamp
    callData.policyUsed || '',                          // C: Policy Used
    callData.rating || '',                              // D: Rating
    callData.customerFeedback || '',                    // E: Customer Feedback
    callData.customerSentiment || '',                   // F: Feedback Sentiment
    callData.callSummary || '',                         // G: Call Summary
    callData.callback ? 'TRUE' : 'FALSE',               // H: Callback
    callData.callbackSchedule || '',                    // I: Callback Schedule
    callData.callbackAttempt || 1,                      // J: Callback Attempt
    callData.callDisposition || callData.duration || 0, // K: Call Disposition
    callData.transcriptText || '',                      // L: Call Transcript
    callData.stereoRecordingUrl || '',                  // M: Call Recording
    callData.campaignId || callData.batchId || '',      // N: Campaign ID
    callData.campaignName || callData.batchName || '',  // O: Campaign Name
    callData.callStatus || '',                          // P: Call Status
    callData.callDisposition || '',                     // Q: Call Disposition (text)
    callData.endedReason || '',                         // R: Ended Reason
    callData.escalationRequired ? 'TRUE' : 'FALSE'     // S: Escalation Required
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('call-started', (data) => {
    activeCalls.set(data.callId, {
      customerName: data.customerName,
      startTime: new Date(),
      status: 'active'
    });
  });

  socket.on('call-ended', (data) => {
    if (activeCalls.has(data.callId)) {
      const call = activeCalls.get(data.callId);
      call.status = 'completed';
      call.endTime = new Date();
      activeCalls.set(data.callId, call);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Apply settings from config file on startup
try {
  const startupSettings = JSON.parse(readFileSync(new URL('../config/settings.json', import.meta.url).pathname, 'utf8'));
  if (startupSettings.maxConcurrentCalls) process.env.MAX_CONCURRENT_VAPI_CALLS = String(startupSettings.maxConcurrentCalls);
  if (startupSettings.callDelayMinSeconds) process.env.BATCH_CALL_DELAY_MIN = String(startupSettings.callDelayMinSeconds * 1000);
  if (startupSettings.callDelayMaxSeconds) process.env.BATCH_CALL_DELAY_MAX = String(startupSettings.callDelayMaxSeconds * 1000);
} catch { /* settings file optional */ }

// Initialize database and campaign processor
const db = initializeDatabase();

// Recover stuck calls on startup
await recoverStuckCalls();

// Create campaign processor instance
const batchProcessor = new CampaignProcessor(io, logToGoogleSheets);

// Make campaign processor available to routes
app.locals.batchProcessor = batchProcessor;

// Start retry scheduler (checks every 5 minutes for due retries during business hours)
const retryScheduler = new RetryScheduler(batchProcessor);
retryScheduler.start();
app.locals.retryScheduler = retryScheduler;

const campaignScheduler = new CampaignScheduler(batchProcessor);
campaignScheduler.start();
app.locals.campaignScheduler = campaignScheduler;

// Auto-resume running campaigns after server restart
const runningCampaigns = (() => {
  try {
    return db.prepare(`SELECT id, name FROM campaigns WHERE status = 'running'`).all();
  } catch {
    // Fallback to batches table if campaigns table not yet migrated
    return db.prepare(`SELECT id, name FROM batches WHERE status = 'running'`).all();
  }
})();

if (runningCampaigns.length > 0) {
  console.log(`🔄 Auto-resuming ${runningCampaigns.length} running campaign(s) after restart...`);

  setTimeout(() => {
    runningCampaigns.forEach(campaign => {
      console.log(`▶️  Resuming campaign ${campaign.id}: ${campaign.name}`);
      batchProcessor.resume(campaign.id).catch(err => {
        console.error(`❌ Failed to auto-resume campaign ${campaign.id}:`, err);
      });
    });
  }, 5000);
}

// Mount routes
app.use('/api/campaigns', campaignRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/batches', campaignRoutes);

// ============================================================================
// TEST: Simulate callback scheduling
// POST /api/test/simulate-callback
// Body: { callbackSchedule, disposition }
// Returns what calculateNextRetry would schedule
// ============================================================================
app.post('/api/test/simulate-callback', (req, res) => {
  const { callbackSchedule, disposition = 'callback_requested' } = req.body;
  const now = new Date();

  const nextRetry = calculateNextRetry(disposition, now, callbackSchedule || null);

  const diffMs = nextRetry - now;
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = (diffMs / 3600000).toFixed(1);

  res.json({
    input: {
      disposition,
      callbackSchedule: callbackSchedule || '(none)',
      currentTime: now.toISOString(),
      currentTimeLocal: now.toLocaleString('en-GB', { timeZone: process.env.TIMEZONE || 'Asia/Dubai' })
    },
    result: {
      nextRetryAt: nextRetry.toISOString(),
      nextRetryLocal: nextRetry.toLocaleString('en-GB', { timeZone: process.env.TIMEZONE || 'Asia/Dubai' }),
      delayMinutes: diffMins,
      delayHours: diffHours
    },
    explanation: callbackSchedule
      ? `Customer requested: "${callbackSchedule}" → scheduled at ${nextRetry.toISOString()} (adjusted to business hours if needed)`
      : `No specific time requested → default 4h delay → ${nextRetry.toISOString()}`
  });
});

// ============================================================================
// VAPI phone number list proxy (keeps VAPI credentials server-side)
// GET /api/vapi/phone-numbers
// ============================================================================
app.get('/api/vapi/phone-numbers', async (_req, res) => {
  try {
    const response = await fetch('https://api.vapi.ai/phone-number?limit=100', {
      headers: { 'Authorization': `Bearer ${process.env.VAPI_PRIVATE_KEY}` }
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch phone numbers from VAPI' });
    }
    const data = await response.json();
    const numbers = (Array.isArray(data) ? data : (data.results || [])).map(n => ({
      id: n.id,
      number: n.number || n.sipUri || n.id,
      label: n.name || n.number || n.id
    }));
    res.json({ numbers });
  } catch (error) {
    console.error('❌ Error fetching VAPI phone numbers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Settings endpoints
const settingsPath = new URL('../config/settings.json', import.meta.url).pathname;

function loadSettings() {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

app.get('/api/settings', (req, res) => {
  res.json(loadSettings());
});

app.post('/api/settings', (req, res) => {
  try {
    const current = loadSettings();
    const updated = { ...current, ...req.body };
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
    // Apply runtime-changeable settings immediately
    if (updated.maxConcurrentCalls) {
      process.env.MAX_CONCURRENT_VAPI_CALLS = String(updated.maxConcurrentCalls);
    }
    if (updated.callDelayMinSeconds) {
      process.env.BATCH_CALL_DELAY_MIN = String(updated.callDelayMinSeconds * 1000);
    }
    if (updated.callDelayMaxSeconds) {
      process.env.BATCH_CALL_DELAY_MAX = String(updated.callDelayMaxSeconds * 1000);
    }
    res.json({ success: true, settings: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Call concurrency status endpoint
app.get('/api/calls/concurrency-status', (req, res) => {
  try {
    const activeCallsResult = db.prepare(`
      SELECT COUNT(*) as count FROM contacts WHERE status = 'calling'
    `).get();

    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_CALLS || process.env.MAX_CONCURRENT_VAPI_CALLS || '5');
    const activeCallCount = activeCallsResult.count;
    const availableSlots = Math.max(0, maxConcurrent - activeCallCount);
    const utilizationPercent = Math.round((activeCallCount / maxConcurrent) * 100);

    res.json({
      activeCallCount,
      maxCalls: maxConcurrent,
      availableSlots,
      utilizationPercent,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error fetching concurrency status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Named page routes
app.get('/call-logs', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/call-logs.html'));
});

app.get('/test-calls', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/test-calls.html'));
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Open http://localhost:${PORT} in your browser`);
  console.log(`📦 Campaign calling system initialized`);

  // Check SSL cert expiry on startup and daily at 9 AM
  checkSSLExpiry();
  const checkHour = 9;
  const now = new Date();
  const msUntil9AM = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() >= checkHour ? 1 : 0), checkHour, 0, 0) - now;
  setTimeout(() => {
    checkSSLExpiry();
    setInterval(checkSSLExpiry, 24 * 60 * 60 * 1000);
  }, msUntil9AM);
});

// Global crash handlers
process.on('uncaughtException', async (err) => {
  console.error('💥 Uncaught Exception:', err);
  await sendCrashAlert(err);
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
  await sendCrashAlert(reason instanceof Error ? reason : new Error(String(reason)));
});
