/**
 * Shared helper for all VAPI call initiation (phone + web).
 * Uses a pre-saved VAPI Squad (VAPI_SQUAD_ID) so the squad definition
 * lives in the VAPI dashboard — one place to manage assistants and handoff tools.
 */

/**
 * Initiate an outbound phone call via a pre-saved VAPI Squad.
 *
 * @param {object} options
 * @param {string} options.phoneNumber      - E.164 customer phone number
 * @param {string} options.customerName     - Customer display name
 * @param {object} [options.variableValues] - Extra variableValues (e.g. _contactId)
 * @param {object} [options.metadata]       - VAPI call metadata object
 * @returns {Promise<object>}               - Parsed VAPI API response
 */
export async function initiateVapiCall({ phoneNumber, customerName, variableValues = {}, metadata = {} }) {
  if (!process.env.VAPI_PRIVATE_KEY) {
    throw new Error('VAPI_PRIVATE_KEY is not configured');
  }
  if (!process.env.VAPI_SQUAD_ID) {
    throw new Error('VAPI_SQUAD_ID is not configured');
  }

  const allVars = { customerName, ...variableValues };

  const payload = {
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
    customer: { number: phoneNumber, name: customerName },
    squadId: process.env.VAPI_SQUAD_ID,
    assistantOverrides: { variableValues: allVars }  // echoed in webhook as call.assistantOverrides.variableValues
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
