const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const https = require('https');

const app = express();
const PORT = Number(process.env.PORT || 15754);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const axios = require('axios');
const httpClient = axios.create({ httpAgent, httpsAgent });
const crypto = require('crypto');

function generateRandomId(length = 16) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

const WORKING_VERSIONS = new Set(['v6', 'v8', 'v10', 'v11', 'v13', 'v15']);

const VERSION_MODEL_MAP = {
  v6: 'chatsmith',
  v8: 'chatwithfiction',
  v10: 'publicai',
  v11: 'supabase-gpt-5-nano',
  v13: 'supabase-gpt-5-mini',
  v15: 'doppleai'
};

const MODEL_VERSION_MAP = Object.fromEntries(
  Object.entries(VERSION_MODEL_MAP).map(([k, v]) => [v, k])
);

function pickAutoVersion() {
  const pool = Array.from(WORKING_VERSIONS);
  const choice = pool[Math.floor(Math.random() * pool.length)];
  return { route: `/chat/${choice}`, model: VERSION_MODEL_MAP[choice], version: choice };
}

async function callUpstream(version, payload, source) {
  const url = `http://127.0.0.1:${PORT}/chat/${version}`;
  let userMessage = source === 'openai' ? undefined : payload.userMessage;
  let messages = source === 'openai' ? payload.messages : undefined;

  if (!userMessage && Array.isArray(messages) && messages.length) {
    const last = messages[messages.length - 1];
    if (last && typeof last.content === 'string') userMessage = last.content;
  }

  const body = {
    userMessage,
    messages,
    model: undefined,
    ...payload
  };

  const response = await httpClient.post(url, body, { timeout: 120000 });
  const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const match = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  let reply = '';
  if (match && match[1]) {
    try { reply = JSON.parse(`"${match[1]}"`); } catch (_) { reply = match[1]; }
  }
  if (!reply) {
    const alt = response.data?.reply;
    if (typeof alt === 'string') reply = alt;
  }
  if (!reply) throw new Error('Empty upstream reply');
  return { reply, version };
}

async function callAuto(payload, source) {
  const tried = new Set();
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const pick = pickAutoVersion();
    if (tried.has(pick.version)) continue;
    tried.add(pick.version);
    try {
      const result = await callUpstream(pick.version, payload, source);
      return { ...result, model: 'auto' };
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw lastErr || new Error('auto model exhausted');
}

async function handleOpenAI(req, res) {
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const model = typeof body.model === 'string' ? body.model : 'auto';
  const stream = typeof body.stream === 'boolean' ? body.stream : false;
  const payload = { messages, model };

  try {
    let upstream;
    if (model === 'auto') {
      upstream = await callAuto(payload, 'openai');
    } else if (WORKING_VERSIONS.has(model)) {
      upstream = await callUpstream(model, payload, 'openai');
    } else if (MODEL_VERSION_MAP[model]) {
      const version = MODEL_VERSION_MAP[model];
      upstream = await callUpstream(version, payload, 'openai');
    } else {
      return res.status(400).json({ error: { message: `Model "${model}" is not available`, type: 'invalid_request_error' } });
    }

    const chatId = body.stream ? generateRandomId(20) : null;
    if (stream) {
      const chunk = JSON.stringify({
        id: chatId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: upstream.model,
        choices: [{ index: 0, delta: { content: upstream.reply }, finish_reason: null }]
      });
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');
      res.write(`data: ${chunk}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.json({
      id: `chatcmpl-${generateRandomId(24)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: upstream.model || model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: upstream.reply },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  } catch (error) {
    const status = error.response?.status || 502;
    res.status(status).json({
      error: {
        message: error.response?.data?.error || error.message || 'Upstream request failed',
        type: 'upstream_error',
        ...(error.response?.data ? { upstream: error.response.data } : {})
      }
    });
  }
}

app.options('/v1/chat/completions', (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.sendStatus(204);
});

app.post('/v1/chat/completions', handleOpenAI);

app.get('/v1/models', (req, res) => {
  const models = [
    { id: 'auto', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'fga', description: 'Auto-choose working upstream with retry' },
    { id: 'auto', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'fga', description: 'Auto-choose working upstream with retry' },
    { id: 'chatsmith', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'fga', description: 'Chat Smith (gpt-4o-mini)' },
    { id: 'chatwithfiction', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'fga', description: 'Chat With Fiction' },
    { id: 'publicai', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'fga', description: 'PublicAI' },
    { id: 'supabase-gpt-5-nano', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'fga', description: 'Supabase GPT-5 Nano' },
    { id: 'supabase-gpt-5-mini', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'fga', description: 'Supabase GPT-5 Mini' },
    { id: 'doppleai', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'fga', description: 'DoppleAI' }
  ];
  res.json({ object: 'list', data: models });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', author: 'Saksham Shekher', message: 'GPT-AI API is running', repo: 'https://github.com/OshekharO/GPT-AI' });
});

// Mount scrapers

app.use('/chat/v6', require('./scrapers/v6'));
app.use('/chat/v8', require('./scrapers/v8'));
app.use('/chat/v10', require('./scrapers/v10'));
app.use('/chat/v11', require('./scrapers/v11'));
app.use('/chat/v13', require('./scrapers/v13'));
app.use('/chat/v15', require('./scrapers/v15'));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

module.exports = app;
