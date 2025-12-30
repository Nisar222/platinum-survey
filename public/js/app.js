// Initialize Socket.IO
const socket = io();

// Vapi instance
let vapi = null;
let currentCallId = null;
let callType = 'web'; // 'web' or 'phone'
let callData = {
    customerName: '',
    callTimestamp: null,
    policyUsed: '',
    rating: null,
    customerFeedback: '',
    customerSentiment: '',
    feedbackScore: null,
    feedbackSummary: '',
    callSummary: '',
    callback: false,
    callbackSchedule: null,
    callbackAttempt: 1,
    duration: null
};

// Configuration
let config = {};

// Fetch configuration from server
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        config = await response.json();

        // Initialize Vapi directly (no need to wait, it's loaded synchronously)
        initializeVapi();
    } catch (error) {
        console.error('Error loading config:', error);
        showError('Failed to load configuration');
    }
}

// Initialize Vapi
function initializeVapi() {
    console.log('Initializing Vapi with config:', {
        publicKey: config.publicKey ? '✓ Present' : '✗ Missing',
        assistantId: config.assistantId ? '✓ Present' : '✗ Missing'
    });

    // Check if Vapi class is available
    if (typeof window.Vapi === 'undefined') {
        console.error('❌ Vapi class not loaded on window object');
        console.error('Available window properties:', Object.keys(window).filter(k => k.toLowerCase().includes('vapi')));
        showError('Voice service unavailable. Please refresh the page.');
        return;
    }

    if (!config.publicKey) {
        console.error('❌ VAPI_PUBLIC_KEY is missing from environment');
        showError('Configuration error: Missing API key');
        return;
    }

    if (!config.assistantId) {
        console.error('❌ VAPI_ASSISTANT_ID is missing from environment');
        showError('Configuration error: Missing Assistant ID');
        return;
    }

    try {
        // Create new Vapi instance with public key
        vapi = new window.Vapi(config.publicKey);
        setupVapiEventListeners();
        console.log('✅ Vapi initialized successfully');
        console.log('✅ Assistant ID:', config.assistantId);
    } catch (error) {
        console.error('❌ Error initializing Vapi:', error);
        showError('Failed to initialize voice service: ' + error.message);
    }
}

// Setup Vapi Event Listeners
function setupVapiEventListeners() {
    // Call started
    vapi.on('call-start', () => {
        console.log('Call started');
        callData.callTimestamp = new Date().toISOString();
        updateCallStatus('active', 'Call connected. Speaking with customer...');

        socket.emit('call-started', {
            callId: currentCallId,
            customerName: callData.customerName
        });
    });

    // Call ended
    vapi.on('call-end', (endData) => {
        console.log('Call ended:', endData);

        const endTime = new Date();
        const startTime = new Date(callData.callTimestamp);
        callData.duration = Math.round((endTime - startTime) / 1000);

        updateCallStatus('completed', `Call completed. Duration: ${callData.duration} seconds`);

        // Show results
        showCallResults();
        resetCallButton();

        socket.emit('call-ended', {
            callId: currentCallId,
            duration: callData.duration,
            callData: callData
        });
    });

    // Messages - capture structured data
    vapi.on('message', (message) => {
        console.log('📨 Message received:', message);

        // Capture function call results (structured data output)
        if (message.type === 'function-call' && message.functionCall) {
            console.log('🔧 Function call result:', message.functionCall);

            // Extract structured data from function call
            if (message.functionCall.name === 'log_call_data' || message.functionCall.parameters) {
                const params = message.functionCall.parameters;
                console.log('📊 Captured structured data:', params);

                // Update callData with structured output
                if (params.policyUsed) callData.policyUsed = params.policyUsed;
                if (params.rating) callData.rating = params.rating;
                if (params.customerFeedback) callData.customerFeedback = params.customerFeedback;
                // Match exact VAPI Structured Output field names
                if (params['Customer Sentiment']) callData.customerSentiment = params['Customer Sentiment'];
                if (params['Feedback Score']) callData.feedbackScore = params['Feedback Score'];
                if (params['Feedback Summary']) callData.feedbackSummary = params['Feedback Summary'];
                if (params.callSummary) callData.callSummary = params.callSummary;
                if (params.callback !== undefined) callData.callback = params.callback;
                if (params.callbackSchedule) callData.callbackSchedule = params.callbackSchedule;
                if (params.callbackAttempt) callData.callbackAttempt = params.callbackAttempt;
            }
        }

        // Capture conversation end message
        if (message.type === 'conversation-update' && message.conversation) {
            console.log('💬 Conversation update:', message.conversation);
        }
    });

    // Errors
    vapi.on('error', (error) => {
        console.error('Vapi error:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));

        // Extract meaningful error message
        let errorMsg = 'Unknown error';
        if (error.error?.message) {
            errorMsg = error.error.message;
        } else if (error.message) {
            errorMsg = error.message;
        } else if (error.type) {
            errorMsg = error.type.replace(/-/g, ' ');
        }

        showError('Call error: ' + errorMsg);
        resetCallButton();
    });

    // Speech events
    vapi.on('speech-start', () => {
        console.log('User started speaking');
    });

    vapi.on('speech-end', () => {
        console.log('User stopped speaking');
    });
}

// Start a web call
async function startWebCall(customerName) {
    try {
        if (!vapi) {
            throw new Error('Vapi not initialized');
        }

        // Check microphone permission
        try {
            console.log('Checking microphone permissions...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop()); // Release immediately
            console.log('✅ Microphone access granted');
        } catch (micError) {
            console.error('❌ Microphone access denied:', micError);
            throw new Error('Microphone access is required for voice calls. Please enable microphone permissions and try again.');
        }

        callData.customerName = customerName;
        callData.callTimestamp = new Date().toISOString();

        // Update UI
        setCallButtonLoading(true);
        updateCallStatus('connecting', 'Initiating call...');
        document.getElementById('callStatus').style.display = 'block';

        console.log('Starting call with assistant:', config.assistantId);
        console.log('Customer name:', customerName);

        const callConfig = {
            variableValues: {
                customerName: customerName
            },
            // Enable transcription explicitly
            transcriber: {
                provider: "deepgram",
                model: "nova-2",
                language: "en"
            }
        };

        console.log('📞 Call config being sent:', JSON.stringify(callConfig, null, 2));

        // Start the call with assistant overrides to pass customer name
        const response = await vapi.start(config.assistantId, callConfig);

        currentCallId = response?.id || Date.now().toString();
        console.log('✅ Call started successfully with ID:', currentCallId);
        console.log('📋 Response from vapi.start():', response);

    } catch (error) {
        console.error('❌ Error starting call:', error);
        console.error('Error stack:', error.stack);
        showError('Failed to start call: ' + (error.message || 'Unknown error'));
        resetCallButton();
    }
}

// Start a phone call
async function startPhoneCall(customerName, phoneNumber) {
    try {
        if (!phoneNumber) {
            throw new Error('Phone number is required for phone calls');
        }

        callData.customerName = customerName;
        callData.callTimestamp = new Date().toISOString();

        // Update UI
        setCallButtonLoading(true);
        updateCallStatus('connecting', `Calling ${phoneNumber}...`);
        document.getElementById('callStatus').style.display = 'block';

        console.log('Starting phone call to:', phoneNumber);
        console.log('Customer name:', customerName);

        const response = await fetch('/api/start-phone-call', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customerName: customerName,
                phoneNumber: phoneNumber
            })
        });

        const result = await response.json();

        if (result.success) {
            currentCallId = result.callId;
            console.log('✅ Phone call initiated successfully with ID:', currentCallId);
            updateCallStatus('active', `Phone call in progress to ${phoneNumber}`);
        } else {
            throw new Error(result.error || 'Failed to initiate phone call');
        }

    } catch (error) {
        console.error('❌ Error starting phone call:', error);
        showError('Failed to start phone call: ' + (error.message || 'Unknown error'));
        resetCallButton();
    }
}

// Update call status UI
function updateCallStatus(status, message) {
    const statusElement = document.getElementById('callStatus');
    const messageElement = document.getElementById('statusMessage');
    const indicator = document.getElementById('statusIndicator');

    statusElement.classList.remove('hidden');
    messageElement.textContent = message;

    // Update indicator color based on status
    indicator.classList.remove('bg-green-500', 'bg-yellow-500', 'bg-blue-500', 'bg-red-500');
    
    if (status === 'active') {
        indicator.classList.add('bg-green-500', 'animate-pulse');
    } else if (status === 'connecting') {
        indicator.classList.add('bg-yellow-500', 'animate-pulse');
    } else if (status === 'completed') {
        indicator.classList.add('bg-blue-500');
        indicator.classList.remove('animate-pulse');
    }
}

// Show call results
function showCallResults() {
    const section = document.getElementById('callResultsSection');
    const content = document.getElementById('callResultsContent');

    console.log('📊 Displaying call results:', callData);
    
    // Helper function to get sentiment emoji
    const getSentimentEmoji = (sentiment) => {
        const sentimentMap = {
            'positive': '😊',
            'happy': '😃',
            'satisfied': '😊',
            'neutral': '😐',
            'negative': '😞',
            'frustrated': '😠',
            'angry': '😡',
            'confused': '😕',
            'disappointed': '😔'
        };
        return sentimentMap[sentiment?.toLowerCase()] || '😐';
    };

    // Helper function to render feedback score bar
    const renderFeedbackScore = (score) => {
        if (!score) return '';
        const percentage = (score / 10) * 100;
        const color = score >= 8 ? 'bg-green-500' : score >= 6 ? 'bg-yellow-500' : score >= 4 ? 'bg-orange-500' : 'bg-red-500';
        return `
            <div class="w-full bg-gray-200 rounded-full h-4 mb-2">
                <div class="${color} h-4 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
            </div>
            <div class="text-2xl font-bold text-gray-800">${score}/10</div>
        `;
    };

    content.innerHTML = `
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="p-4 bg-gradient-to-br from-cyan-50 to-blue-50 rounded-xl">
                <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Customer Name</div>
                <div class="text-xl font-bold text-gray-800">${callData.customerName}</div>
            </div>
            <div class="p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl">
                <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Duration</div>
                <div class="text-xl font-bold text-gray-800">${callData.duration}s</div>
            </div>
        </div>

        <div class="p-4 bg-white border-2 border-gray-100 rounded-xl mb-4">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Call Timestamp</div>
            <div class="text-sm text-gray-700">${new Date(callData.callTimestamp).toLocaleString()}</div>
        </div>

        ${callData.customerSentiment ? `
        <div class="p-4 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl mb-4">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Customer Sentiment</div>
            <div class="flex items-center gap-3">
                <div class="text-5xl">${getSentimentEmoji(callData.customerSentiment)}</div>
                <div class="text-lg font-semibold text-gray-700 capitalize">${callData.customerSentiment}</div>
            </div>
        </div>
        ` : ''}

        ${callData.feedbackScore ? `
        <div class="p-4 bg-gradient-to-br from-teal-50 to-cyan-50 rounded-xl mb-4">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Feedback Score</div>
            ${renderFeedbackScore(callData.feedbackScore)}
        </div>
        ` : ''}

        ${callData.feedbackSummary ? `
        <div class="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl mb-4">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Feedback Summary</div>
            <div class="bg-white p-3 rounded-lg border border-gray-200">
                <p class="text-sm text-gray-700 leading-relaxed">${callData.feedbackSummary}</p>
            </div>
        </div>
        ` : ''}

        ${callData.policyUsed ? `
        <div class="p-4 bg-blue-50 rounded-xl mb-4">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Policy Used</div>
            <div class="text-sm text-gray-700">${callData.policyUsed}</div>
        </div>
        ` : ''}

        ${callData.rating ? `
        <div class="p-4 bg-yellow-50 rounded-xl mb-4">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Rating</div>
            <div class="text-2xl font-bold text-yellow-600">${'⭐'.repeat(callData.rating)}</div>
        </div>
        ` : ''}

        ${callData.customerFeedback ? `
        <div class="p-4 bg-green-50 rounded-xl mb-4">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Customer Feedback</div>
            <div class="text-sm text-gray-700">${callData.customerFeedback}</div>
        </div>
        ` : ''}

        ${callData.callSummary ? `
        <div class="p-4 bg-purple-50 rounded-xl mb-4">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Call Summary</div>
            <div class="text-sm text-gray-700">${callData.callSummary}</div>
        </div>
        ` : ''}

        ${callData.callback ? `
        <div class="p-4 bg-red-50 border-2 border-red-200 rounded-xl mb-4">
            <div class="flex items-center gap-2 mb-2">
                <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
                <div class="text-sm font-bold text-red-600 uppercase">Callback Requested</div>
            </div>
            ${callData.callbackSchedule ? `
                <div class="text-xs text-gray-600 mb-1">Scheduled: ${new Date(callData.callbackSchedule).toLocaleString()}</div>
            ` : ''}
            <div class="text-xs text-gray-600">Attempt: ${callData.callbackAttempt} / 3</div>
        </div>
        ` : ''}

        <div class="text-center pt-4">
            <a href="https://docs.google.com/spreadsheets/d/1z5fKe8zY3J2c6Z1xtC7mY2gMmS2PbUwjvKDcCI0lhio/edit" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 text-sm text-green-600 hover:text-green-700 transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span class="underline">Data saved to Google Sheets</span>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                </svg>
            </a>
        </div>
    `;

    section.classList.remove('hidden');
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Log call data to Google Sheets
async function logCallToGoogleSheets(data) {
    try {
        console.log('📤 Logging call data to Google Sheets:', data);

        const response = await fetch('/api/log-to-sheets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            console.log('✅ Successfully logged to Google Sheets');
        } else {
            console.error('❌ Failed to log to Google Sheets:', result.error);
        }
    } catch (error) {
        console.error('❌ Error logging to Google Sheets:', error);
    }
}

// UI Helper Functions
function setCallButtonLoading(loading) {
    const btn = document.getElementById('startCallBtn');
    const btnText = document.getElementById('btnText');
    const btnLoader = document.getElementById('btnLoader');
    const hangUpBtn = document.getElementById('hangUpBtn');

    if (loading) {
        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
        btn.disabled = true;
        btn.classList.add('opacity-75', 'cursor-not-allowed');
        
        // Show hang up button
        hangUpBtn.classList.remove('hidden');
    } else {
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
        btn.disabled = false;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
        
        // Hide hang up button
        hangUpBtn.classList.add('hidden');
    }
}

function resetCallButton() {
    setCallButtonLoading(false);
}

function showError(message) {
    const statusElement = document.getElementById('callStatus');
    const messageElement = document.getElementById('statusMessage');
    const indicator = document.getElementById('statusIndicator');

    statusElement.classList.remove('hidden');
    messageElement.textContent = message;
    indicator.classList.remove('bg-green-500', 'bg-yellow-500', 'bg-blue-500');
    indicator.classList.add('bg-red-500');
    indicator.classList.remove('animate-pulse');
}

// Toggle between web call and phone call
function setupCallTypeToggle() {
    const webCallBtn = document.getElementById('webCallBtn');
    const phoneCallBtn = document.getElementById('phoneCallBtn');
    const phoneNumberField = document.getElementById('phoneNumberField');
    const phoneNumberInput = document.getElementById('phoneNumber');
    const btnText = document.getElementById('btnText');

    webCallBtn.addEventListener('click', () => {
        callType = 'web';

        // Update button styles
        webCallBtn.classList.add('bg-white', 'text-gray-800', 'shadow-sm');
        webCallBtn.classList.remove('text-gray-600', 'hover:text-gray-800');
        phoneCallBtn.classList.remove('bg-white', 'text-gray-800', 'shadow-sm');
        phoneCallBtn.classList.add('text-gray-600', 'hover:text-gray-800');

        // Hide phone number field
        phoneNumberField.classList.add('hidden');
        phoneNumberInput.removeAttribute('required');

        // Update button text
        btnText.textContent = 'Start Web Call';
    });

    phoneCallBtn.addEventListener('click', () => {
        callType = 'phone';

        // Update button styles
        phoneCallBtn.classList.add('bg-white', 'text-gray-800', 'shadow-sm');
        phoneCallBtn.classList.remove('text-gray-600', 'hover:text-gray-800');
        webCallBtn.classList.remove('bg-white', 'text-gray-800', 'shadow-sm');
        webCallBtn.classList.add('text-gray-600', 'hover:text-gray-800');

        // Show phone number field
        phoneNumberField.classList.remove('hidden');
        phoneNumberInput.setAttribute('required', 'required');

        // Update button text
        btnText.textContent = 'Start Phone Call';
    });
}

// Form Event Handlers
document.getElementById('singleCallForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const customerName = document.getElementById('customerName').value.trim();

    if (!customerName) {
        showError('Please enter a customer name');
        return;
    }

    if (callType === 'web') {
        await startWebCall(customerName);
    } else {
        const phoneNumber = document.getElementById('phoneNumber').value.trim();

        if (!phoneNumber) {
            showError('Please enter a phone number');
            return;
        }

        await startPhoneCall(customerName, phoneNumber);
    }
});

// Hang Up Button Handler
document.getElementById('hangUpBtn').addEventListener('click', () => {
    if (vapi) {
        vapi.stop();
        console.log('Call manually ended by user');
    }
});

// Excel Upload Handler (Phase 2 - prepared for future)
const bulkUploadForm = document.getElementById('bulkUploadForm');
if (bulkUploadForm) {
    bulkUploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const fileInput = document.getElementById('excelFile');
        const file = fileInput.files[0];

        if (!file) {
            alert('Please select an Excel file');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/upload-contacts', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                console.log('Contacts loaded:', result.contacts);
                alert(`Successfully loaded ${result.total} contacts`);
                // Future: Process bulk calls
            } else {
                alert('Error processing file');
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            alert('Error uploading file');
        }
    });
}

// Socket.IO event listeners
socket.on('vapi-event', (event) => {
    console.log('Vapi event from server:', event);
    // Handle events from webhook if needed
});

socket.on('connect', () => {
    console.log('Connected to server via WebSocket');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// Test function to simulate call results (for development/testing)
async function testCallResults() {
    try {
        console.log('🧪 Loading test call results...');
        const response = await fetch('/api/test-call-results');
        const testData = await response.json();

        // Update callData with test data
        Object.assign(callData, testData);

        // Show the results
        showCallResults();

        console.log('✅ Test call results loaded:', testData);
    } catch (error) {
        console.error('❌ Error loading test results:', error);
    }
}

// Make test function available globally for console access
window.testCallResults = testCallResults;

// Initialize app on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('App initialized');
    console.log('💡 TIP: Run testCallResults() in console to see sample call results without making a real call');
    setupCallTypeToggle();
    loadConfig();
});
