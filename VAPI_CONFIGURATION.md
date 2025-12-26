# Vapi Assistant Configuration Guide

## Overview
This guide helps you configure your Vapi assistant to work optimally with the AYN Digital Web Call app.

## Assistant Configuration

### 1. Variable Setup

In your Vapi assistant configuration, define the `customerName` variable:

**Dashboard → Assistants → Your Assistant → Variables**

Add variable:
```json
{
  "name": "customerName",
  "type": "string",
  "description": "The name of the customer being called"
}
```

### 2. First Message Template

Use the variable in your first message:

```
Hello {{customerName}}! This is [Your Company Name] calling. How are you today?
```

### 3. System Prompt Example

Configure your assistant's behavior in the system prompt:

```
You are a friendly and professional AI assistant calling on behalf of [Company Name].

IMPORTANT INSTRUCTIONS:
- You are speaking with {{customerName}}
- Always use their name naturally in conversation
- Be warm, friendly, and professional
- Keep responses concise (under 30 words when possible)
- Listen actively and respond appropriately
- If asked who you're calling, mention you're from [Company Name]

CONVERSATION FLOW:
1. Greet the customer warmly using their name
2. Introduce yourself and the purpose of the call
3. Ask relevant questions based on the call objective
4. Thank them for their time
5. End the call professionally

TONE: Professional yet friendly, conversational, helpful
```

### 4. Voice Configuration

**Recommended Voice Settings:**

**Provider:** ElevenLabs (recommended) or PlayHT
**Voice ID:** Choose based on your preference:
- Professional female: `21m00Tcm4TlvDq8ikWAM` (Rachel - ElevenLabs)
- Professional male: `ErXwobaYiN019PkySvjV` (Antoni - ElevenLabs)

**Voice Settings:**
- Stability: 0.5 - 0.7
- Similarity: 0.75 - 0.85
- Speed: 1.0 - 1.1

### 5. Model Configuration

**Recommended Model:** GPT-4 Turbo or GPT-4

```json
{
  "provider": "openai",
  "model": "gpt-4-turbo-preview",
  "temperature": 0.7,
  "maxTokens": 250
}
```

**For cost optimization, use:**
```json
{
  "provider": "openai", 
  "model": "gpt-3.5-turbo",
  "temperature": 0.7,
  "maxTokens": 200
}
```

### 6. Function/Tool Integration (Optional)

If you want to collect structured data during calls:

```json
{
  "name": "collectCustomerInfo",
  "description": "Collect and store customer information",
  "parameters": {
    "type": "object",
    "properties": {
      "customerName": {
        "type": "string",
        "description": "Customer's full name"
      },
      "phoneNumber": {
        "type": "string", 
        "description": "Customer's phone number"
      },
      "interest": {
        "type": "string",
        "description": "Customer's area of interest"
      },
      "followUpNeeded": {
        "type": "boolean",
        "description": "Whether customer needs follow-up"
      }
    },
    "required": ["customerName"]
  }
}
```

### 7. End Call Conditions

Configure when the assistant should end the call:

**Dashboard → Assistants → Your Assistant → Advanced Settings**

```json
{
  "endCallPhrases": [
    "goodbye",
    "I have to go",
    "talk to you later",
    "bye",
    "not interested"
  ],
  "maxDurationSeconds": 300
}
```

## Testing Your Configuration

### Test Script

Use this to verify your assistant works correctly:

```javascript
// In browser console on your app
const testCall = async () => {
  await startWebCall("Test Customer");
};

testCall();
```

### What to Test

1. ✅ Customer name is used in greeting
2. ✅ Assistant responds naturally
3. ✅ Voice quality is clear
4. ✅ Response time is acceptable (<1 second)
5. ✅ Call ends gracefully
6. ✅ Transcript captures all dialogue

## Advanced Configuration

### Webhook Integration

Set your server URL in Vapi Dashboard:

```
https://your-domain.com/api/webhook/vapi
```

**Events to Subscribe:**
- `call-start`
- `call-end`
- `transcript`
- `status-update`
- `function-call` (if using tools)

### Example Webhook Payload

```json
{
  "message": {
    "type": "transcript",
    "role": "assistant",
    "transcript": "Hello John! How can I help you today?",
    "call": {
      "id": "call_123",
      "assistantId": "8e01765a-3feb-4e63-bcb3-0d2492a521f9",
      "status": "in-progress"
    }
  }
}
```

## Performance Optimization

### Latency Reduction

1. **Choose nearby model endpoint:**
   - For UAE: Use Azure OpenAI (UAE North)
   - Alternatively: OpenAI default (good global latency)

2. **Voice provider selection:**
   - ElevenLabs: Best quality, moderate latency
   - PlayHT: Good balance
   - Azure TTS: Lowest latency

3. **Response optimization:**
   - Keep `maxTokens` low (150-250)
   - Use higher temperature (0.7-0.8) for natural responses
   - Enable streaming responses

### Cost Optimization

**Low-cost configuration:**
```json
{
  "model": {
    "provider": "openai",
    "model": "gpt-3.5-turbo",
    "temperature": 0.7,
    "maxTokens": 150
  },
  "voice": {
    "provider": "azure",
    "voiceId": "en-US-JennyNeural"
  }
}
```

**Estimated cost per minute:**
- GPT-3.5 + Azure Voice: ~$0.05/min
- GPT-4 + ElevenLabs: ~$0.20/min

## Troubleshooting

### Assistant doesn't use customer name

**Solution:** Verify variable is:
1. Defined in assistant configuration
2. Passed in `assistantOverrides.variableValues`
3. Referenced correctly as `{{customerName}}` in messages

### Voice sounds robotic

**Solution:** Adjust voice settings:
- Increase similarity boost (0.8-0.9)
- Decrease stability (0.4-0.6)
- Try different voice models

### High latency

**Solution:**
1. Switch to faster model (GPT-3.5-turbo)
2. Use local voice provider (Azure in UAE)
3. Reduce maxTokens
4. Enable response streaming

### Call quality issues

**Solution:**
- Check internet connection
- Verify Vapi service status: https://status.vapi.ai
- Test from different browser
- Clear browser cache

## Example Configurations

### Sales Call Assistant

```json
{
  "name": "Sales Outreach Bot",
  "firstMessage": "Hi {{customerName}}! This is Alex from AYN Digital. I'm reaching out regarding our new AI solutions. Do you have a moment?",
  "model": {
    "provider": "openai",
    "model": "gpt-4-turbo",
    "temperature": 0.7,
    "systemPrompt": "You are a friendly sales representative. Your goal is to qualify leads and schedule demos. Keep responses under 25 words. Be consultative, not pushy."
  },
  "voice": {
    "provider": "11labs",
    "voiceId": "21m00Tcm4TlvDq8ikWAM"
  }
}
```

### Customer Support Assistant

```json
{
  "name": "Support Call Bot",
  "firstMessage": "Hello {{customerName}}! This is the support team from AYN Digital. I see you had a question about [topic]. How can I help?",
  "model": {
    "provider": "openai",
    "model": "gpt-4-turbo",
    "temperature": 0.6,
    "systemPrompt": "You are a helpful customer support agent. Empathize with customer issues, provide clear solutions, and escalate complex problems. Be patient and thorough."
  },
  "voice": {
    "provider": "11labs",
    "voiceId": "ErXwobaYiN019PkySvjV"
  }
}
```

### Survey/Feedback Assistant

```json
{
  "name": "Feedback Collection Bot",
  "firstMessage": "Hi {{customerName}}! We'd love to hear your feedback about your recent experience with AYN Digital. This will only take a minute!",
  "model": {
    "provider": "openai",
    "model": "gpt-3.5-turbo",
    "temperature": 0.7,
    "systemPrompt": "Collect customer feedback through conversational questions. Ask about satisfaction, what they liked, areas for improvement. Thank them warmly at the end."
  },
  "voice": {
    "provider": "11labs",
    "voiceId": "21m00Tcm4TlvDq8ikWAM"
  }
}
```

## Resources

- **Vapi Documentation:** https://docs.vapi.ai
- **Voice Library:** https://elevenlabs.io/voice-library
- **OpenAI Models:** https://platform.openai.com/docs/models
- **Vapi Dashboard:** https://dashboard.vapi.ai

---

**Questions?** Check the main README.md or contact AYN Digital support.
