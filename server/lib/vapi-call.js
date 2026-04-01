/**
 * Shared helper for initiating VAPI outbound phone calls via Squad.
 *
 * All call initiation (test calls from dashboard, campaign processor)
 * goes through this single function so squad config stays in one place.
 *
 * @param {object} options
 * @param {string} options.phoneNumber      - E.164 customer phone number
 * @param {string} options.customerName     - Customer display name
 * @param {object} [options.variableValues] - Extra variableValues for Agent 1 (e.g. _contactId)
 * @param {object} [options.metadata]       - VAPI call metadata object
 * @returns {Promise<object>}               - Parsed VAPI API response
 */
export async function initiateVapiCall({ phoneNumber, customerName, variableValues = {}, metadata = {} }) {
  if (!process.env.VAPI_PRIVATE_KEY) {
    throw new Error('VAPI_PRIVATE_KEY is not configured');
  }
  if (!process.env.VAPI_ASSISTANT_ID) {
    throw new Error('VAPI_ASSISTANT_ID is not configured');
  }
  if (!process.env.VAPI_ARABIC_ASSISTANT_ID) {
    throw new Error('VAPI_ARABIC_ASSISTANT_ID is not configured');
  }

  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

  const payload = {
    phoneNumberId,
    customer: { number: phoneNumber, name: customerName },
    squad: {
      members: [
        {
          assistantId: process.env.VAPI_ASSISTANT_ID,
          assistantOverrides: {
            variableValues: {
              customerName,
              ...variableValues
            },
            'tools:append': [{
              type: 'handoff',
              destinations: [{
                type: 'assistant',
                assistantId: process.env.VAPI_ARABIC_ASSISTANT_ID,
                description: 'Transfer when customer speaks Arabic or transcription is garbled and unrecognisable'
              }],
              function: { name: 'transfer_to_arabic' }
            }]
          }
        },
        {
          assistantId: process.env.VAPI_ARABIC_ASSISTANT_ID,
          assistantOverrides: {
            firstMessage: 'تفضل... نكمل بالعربي، زين؟',
            firstMessageMode: 'assistant-speaks-first',
            variableValues: {
              customerName,
              ...variableValues
            }
          }
        }
      ]
    }
  };

  if (Object.keys(metadata).length > 0) {
    payload.metadata = metadata;
  }

  const response = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(`VAPI API error ${response.status}: ${JSON.stringify(result?.message || result)}`);
  }

  return result;
}
