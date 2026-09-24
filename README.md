# FGA

OpenAI-compatible API gateway. Port: `15754`.

Default endpoint: `POST /v1/chat/completions`

Models:
- `auto` — random working upstream with retry
- `v6`, `v8`, `v9`, `v10`, `v11`, `v13`, `v14`, `v15`
- friendly names: `chatsmith`, `chatwithfiction`, `bookai`, `publicai`, `supabase-gpt-5-nano`, `supabase-gpt-5-mini`, `chataibot`, `doppleai`

## Usage

```bash
curl -X POST http://localhost:15754/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hi"}]}'
```

Streaming:
```bash
curl -X POST http://localhost:15754/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hi"}],"stream":true}'
```

List models:
```bash
curl http://localhost:15754/v1/models
```

## Notes

- `/chat/vN` legacy routes still mounted but not documented.
- Upstream scrapers are unchanged.
