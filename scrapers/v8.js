const express = require('express');
const axios = require('axios');
const { trimConversationHistory } = require('../utils/memory');

const router = express.Router();

async function handleV8(req, res) {
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

  // Use the last user message for the simple API
  const lastUserMsg = messagesToSend.filter(m => m.role === 'user').pop();
  const prompt = lastUserMsg?.content || userMessage || '';

  const apiUrl = 'https://www.chatwithfiction.com/api/gpt';
  const headers = {
    'referer': 'https://www.chatwithfiction.com/chat',
    'origin': 'https://www.chatwithfiction.com'
  };
  const body = {
    "prompt": prompt,
    "prev": null
  };

  try {
    const response = await axios.post(apiUrl, body, { headers });

    let replyText = response.data;
    if (typeof replyText === 'string') {
      replyText = replyText.replace(/^"|"$/g, '');
    }

    res.json({ reply: replyText });
  } catch (error) {
    console.error('API v8 Error:', error.response ? error.response.data : error.message);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Something went wrong with csrf token maybe' });
  }
}

router.post('/', handleV8);

module.exports = router;