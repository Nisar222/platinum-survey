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
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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

    // Validate that we have the private key
    if (!process.env.VAPI_PRIVATE_KEY) {
      throw new Error('VAPI_PRIVATE_KEY is not configured. Phone calls require a private key.');
    }

    // Make API call to VAPI to initiate phone call
    const vapiResponse = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assistantId: process.env.VAPI_ASSISTANT_ID,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: {
          number: phoneNumber,
          name: customerName
        },
        assistantOverrides: {
          variableValues: {
            customerName: customerName
          }
        }
      })
    });

    const vapiResult = await vapiResponse.json();

    if (!vapiResponse.ok) {
      console.error('❌ VAPI API error:', vapiResult);
      throw new Error(vapiResult.message || 'Failed to initiate call with VAPI');
    }

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
    const SPREADSHEET_ID = '1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio';
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

// Webhook endpoint for Vapi events
app.post('/api/webhook/vapi', async (req, res) => {
  const { message } = req.body;

  console.log('🔔 Vapi webhook received:', JSON.stringify(message, null, 2));

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
        console.log('📊 End of call report received:', message);

        // Extract structured outputs from the end-of-call report
        if (message.artifact && message.artifact.structuredOutputs) {
          console.log('✅ Structured outputs found:', message.artifact.structuredOutputs);

          // Vapi may return structured outputs as an array or an object keyed by ID.
          const flattenStructured = (outputs) => {
            if (!outputs) return [];
            if (Array.isArray(outputs)) return outputs;
            if (typeof outputs === 'object') return Object.values(outputs);
            return [];
          };

          const outputs = flattenStructured(message.artifact.structuredOutputs);
          const getByName = (name) =>
            outputs.find(
              (o) => o.name?.toLowerCase() === name.toLowerCase()
            )?.result;

          // Extract the data we care about
          const structuredData = {
            customerName: getByName('Customer Name'),
            policyUsed: getByName('Policy Used'),
            rating: getByName('Rating'),
            customerFeedback: getByName('Customer Feedback'),
            customerSentiment: getByName('Customer Sentiment'),
            feedbackScore: getByName('Feedback Score'),
            feedbackSummary: getByName('Feedback Summary'),
            callSummary: getByName('Call Summary'),
            callback: getByName('Callback') ?? false,
            callbackSchedule: getByName('Callback Schedule'),
            callbackAttempt: getByName('Callback Attempt'),
          };

          // Prepare call data for Google Sheets
          const callTimestampRaw = message.call?.startedAt || message.timestamp || Date.now();
          const callTimestampIso = new Date(callTimestampRaw).toISOString();

          const callData = {
            // Prefer structured output, then explicit customer name on the call object, then variables passed when starting the call
            customerName: structuredData.customerName ||
              message.call?.customer?.name ||
              message.call?.variables?.customerName ||
              '',
            callTimestamp: callTimestampIso,
            policyUsed: structuredData.policyUsed || '',
            rating: structuredData.rating || '',
            customerFeedback: structuredData.customerFeedback || '',
            customerSentiment: structuredData.customerSentiment || '',
            feedbackScore: structuredData.feedbackScore || '',
            feedbackSummary: structuredData.feedbackSummary || '',
            callSummary: structuredData.callSummary || message.artifact?.summary || '',
            callback: structuredData.callback || false,
            callbackSchedule: structuredData.callbackSchedule || '',
            callbackAttempt: structuredData.callbackAttempt || 1,
            duration: message.call?.endedReason === 'hangup' ?
              Math.round((new Date(message.timestamp) - new Date(callTimestampIso)) / 1000) : 0,
            transcriptText: message.artifact?.transcript || message.call?.transcript || '',
            stereoRecordingUrl: message.artifact?.stereoRecordingUrl || message.call?.stereoRecordingUrl || ''
          };

          console.log('📤 Prepared call data:', callData);

          // Log to Google Sheets
          try {
            await logToGoogleSheets(callData);
            console.log('✅ Successfully logged to Google Sheets from webhook');
          } catch (error) {
            console.error('❌ Error logging to Google Sheets from webhook:', error);
          }

          // Emit to connected clients
          io.emit('call-data-received', callData);
        }
        break;

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
    io.emit('vapi-event', message);

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to log to Google Sheets (extracted for reuse)
async function logToGoogleSheets(callData) {
  const SPREADSHEET_ID = '1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio';
  const RANGE = 'Sheet1!A1:M'; // Columns A through M (13 columns to match sheet structure)

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

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS', // This ensures new rows are inserted, not appended to existing structure
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

// Serve index.html for all routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Open http://localhost:${PORT} in your browser`);
});
