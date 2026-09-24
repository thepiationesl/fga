const express = require('express');
const axios = require('axios');
const { randomUUID } = require('crypto');
const { trimConversationHistory } = require('../utils/memory');

const router = express.Router();

async function handleV11(req, res) {
  const { userMessage, messages, tools, tool_choice } = req.body || {};

  let messagesToSend = [];

  if (Array.isArray(messages) && messages.length > 0) {
    messagesToSend = messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : (m.text || JSON.stringify(m))
    }));
  } else if (userMessage && typeof userMessage === 'string') {
    messagesToSend = [
      { role: 'system', content: 'You are a helpful AI assistant.' },
      { role: 'user', content: userMessage }
    ];
  }

  messagesToSend = trimConversationHistory(messagesToSend);

  if (messagesToSend.length === 0) {
    return res.status(400).json({ 
      error: "No message provided or message is not a string"
    });
  }

  const apiUrl = 'https://qcpujeurnkbvwlvmylyx.supabase.co/functions/v1/chat';

  try {
    const response = await axios.post(apiUrl, {
      messages: messagesToSend,
      model: "openai/gpt-5-nano",
      anonymousUserId: randomUUID(),
      isContinuation: false
    }, {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'text'
    });

    let reply = '';
    let lineBuffer = response.data;
    let newlineIdx;

    while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, newlineIdx).trim();
      lineBuffer = lineBuffer.slice(newlineIdx + 1);
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') break;
      try {
        const parsed = JSON.parse(dataStr);
        const content = parsed?.choices?.[0]?.delta?.content;
        if (content) reply += content;
      } catch {
        // skip malformed chunks
      }
    }

    if (!reply && lineBuffer.trim().startsWith('data:')) {
      const dataStr = lineBuffer.trim().slice(5).trim();
      if (dataStr !== '[DONE]') {
        try {
          const parsed = JSON.parse(dataStr);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content) reply += content;
        } catch {
          // ignore
        }
      }
    }

    if (!reply) {
      throw new Error('No valid response content received');
    }

    res.json({ 
      reply,
      api: "supabase/gpt-5-nano"
    });

  } catch (error) {
    console.error('v11 API Error:', error.response ? error.response.data : error.message);
    if (res.headersSent) return;
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message
    });
  }
}

router.post('/', handleV11);

module.exports = router;