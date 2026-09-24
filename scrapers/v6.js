const express = require('express');
const { trimConversationHistory } = require('../utils/memory');
const axios = require('axios');

const router = express.Router();

const CONFIG = {
  URL: {
    TOKEN: 'https://api.vulcanlabs.co/smith-auth/api/v1/token',
    CHAT: 'https://api.vulcanlabs.co/smith-v2/api/v7/chat_android'
  },
  DEVICE_ID: 'A718E10669C7C5F7',
  HEADERS: {
    'User-Agent': 'Chat Smith Android, Version 4.0.1(970)',
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'Content-Type': 'application/json; charset=utf-8',
    'x-vulcan-application-id': 'com.smartwidgetlabs.chatgpt'
  }
};

let cachedTokenData = null;
let tokenFetchPromise = null;

async function getToken(forceRefresh = false) {
  if (!forceRefresh && cachedTokenData && cachedTokenData.expiresAt > Date.now()) {
    return cachedTokenData.token;
  }

  if (tokenFetchPromise) {
    return tokenFetchPromise;
  }

  tokenFetchPromise = (async () => {
    try {
      const payload = {
        device_id: CONFIG.DEVICE_ID,
        order_id: '',
        product_id: '',
        purchase_token: '',
        subscription_id: ''
      };

      const response = await axios.post(CONFIG.URL.TOKEN, payload, {
        headers: {
          ...CONFIG.HEADERS,
          'x-vulcan-request-id': '9149487891752494707093'
        }
      });

      const data = response.data;
      const accessToken = data?.AccessToken || data?.access_token || data?.token;

      if (!accessToken) {
        throw new Error('Failed to retrieve access token from Chat Smith auth');
      }

      let expiresAt = Date.now() + 60 * 60 * 1000;
      if (data?.AccessTokenExpiration) {
        const expTime = new Date(data.AccessTokenExpiration).getTime();
        if (!isNaN(expTime)) {
          expiresAt = expTime - 5 * 60 * 1000;
        }
      }

      cachedTokenData = { token: accessToken, expiresAt };
      return accessToken;
    } finally {
      tokenFetchPromise = null;
    }
  })();

  return tokenFetchPromise;
}

router.post('/', async (req, res) => {
  const { userMessage, messages, tools, tool_choice } = req.body || {};

  let messagesToSend = [];

  if (Array.isArray(messages) && messages.length > 0) {
    messagesToSend = [...messages];
  } else if (userMessage && typeof userMessage === 'string') {
    messagesToSend = [
      {
        role: 'system',
        content: 'You are Chat Smith, a personal AI. Your goal is to be useful, friendly, and fun.'
      },
      {
        role: 'user',
        content: userMessage
      }
    ];
  }

  messagesToSend = trimConversationHistory(messagesToSend);
  if (messagesToSend.length === 0) {
    return res.status(400).json({ error: 'Message content is required (userMessage or messages array)' });
  }

  try {
    let accessToken = await getToken();

    // Build tools array for upstream if provided
    let upstreamTools = undefined;
    if (Array.isArray(tools) && tools.length > 0) {
      upstreamTools = tools.map(t => ({
        type: 'function',
        function: t.function
      }));
    }

    const payload = {
      usage_model: {
        provider: 'openai',
        model: 'gpt-4o-mini'
      },
      user: CONFIG.DEVICE_ID,
      messages: messagesToSend,
      nsfw_check: true,
      tools: upstreamTools,
      tool_choice: tool_choice
    };

    const makeChatRequest = (token) => axios.post(CONFIG.URL.CHAT, payload, {
      headers: {
        ...CONFIG.HEADERS,
        'authorization': `Bearer ${token}`,
        'x-firebase-appcheck-error': '-9%3A+Integrity+API+error...',
        'x-vulcan-request-id': '9149487891752494721341'
      }
    });

    let response;
    try {
      response = await makeChatRequest(accessToken);
    } catch (err) {
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        cachedTokenData = null;
        accessToken = await getToken(true);
        response = await makeChatRequest(accessToken);
      } else {
        throw err;
      }
    }

    const choice = response.data?.choices?.[0];
    const reply = choice?.Message?.content || choice?.message?.content || '';
    
    // Pass through tool_calls from upstream if present
    const toolCalls = choice?.message?.tool_calls || choice?.Message?.tool_calls;

    res.json({ 
      reply,
      tool_calls: toolCalls,
      model: 'chatsmith'
    });

  } catch (error) {
    console.error('API v6 Request Error:', error.response ? error.response.data : error.message);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Something went wrong with API v6' });
  }
});

module.exports = router;