const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { trimConversationHistory } = require('../utils/memory');

const router = express.Router();

async function handleV15(req, res) {
  const source = req.method === 'GET' ? req.query : req.body;
  const { userMessage, messages, userQuery, id, chatId, username, persona_name, tools, tool_choice, ...rest } = source || {};

  let messagesToSend = [];

  if (Array.isArray(messages) && messages.length > 0) {
    messagesToSend = messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : (m.text || JSON.stringify(m))
    }));
  } else if (typeof userQuery === 'string' && userQuery) {
    messagesToSend = [
      { role: 'system', content: 'You are a helpful AI assistant.' },
      { role: 'user', content: userQuery }
    ];
  } else if (typeof userMessage === 'string' && userMessage) {
    messagesToSend = [
      { role: 'system', content: 'You are a helpful AI assistant.' },
      { role: 'user', content: userMessage }
    ];
  } else if (source && (source.message || source.prompt || source.q)) {
    const raw = source.message || source.prompt || source.q;
    const queryText = Array.isArray(raw) ? raw[0] : raw;
    messagesToSend = [
      { role: 'system', content: 'You are a helpful AI assistant.' },
      { role: 'user', content: queryText }
    ];
  }

  messagesToSend = trimConversationHistory(messagesToSend);

  if (messagesToSend.length === 0) {
    return res.status(400).json({ error: 'Message content is required (userMessage, userQuery, or messages array)' });
  }

  // Use the last user message
  const lastUserMsg = messagesToSend.filter(m => m.role === 'user').pop();
  const queryText = lastUserMsg?.content || '';

  const apiUrl = 'https://beta.dopple.ai/api/messages/send';
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const payload = {
    streamMode: 'none',
    chatId: chatId || '632cef078c294913b5b4653869eca845',
    folder: '',
    images: false,
    username: username || 'mn0uvp2fhv',
    persona_name: persona_name || 'DoppleAI',
    id: id || '46db0561-cb3e-43d9-8f50-40b3e3c84713',
    userQuery: queryText,
    ...rest
  };

  try {
    const response = await axios.post(apiUrl, payload, { headers });

    const reply = response.data?.response;

    if (reply === undefined || reply === null) {
      throw new Error('No valid response content received from Dopple AI');
    }

    res.json({
      reply,
      status_code: response.data?.status_code || 200
    });

  } catch (error) {
    console.error('Dopple AI v15 API Error:', error.response ? error.response.data : error.message);
    if (res.headersSent) return;
    res.status(500).json({
      error: 'Failed to process Dopple AI request',
      details: error.response?.data?.message || error.message
    });
  }
}

router.get('/', handleV15);
router.post('/', handleV15);

module.exports = router;