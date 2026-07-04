// Turns raw gateway log lines into knock events: { senderId, name, platform }.
// Regex first (free, offline, covers known formats). Optional LLM fallback for
// candidate lines the regexes miss — the model EXTRACTS only; its output is
// validated and never acts on anything without owner approval.

const VALID_ID = /^\d{4,20}$/;

export function validateKnock(k) {
  if (!k || !VALID_ID.test(String(k.senderId))) return null;
  return {
    senderId: String(k.senderId),
    name: String(k.name ?? '').slice(0, 128),
    platform: String(k.platform ?? 'telegram').slice(0, 32),
  };
}

/** Lines worth looking at at all, cheap pre-filter shared by all adapters. */
export function isCandidate(line) {
  return /unauthor|not.?allow|denied|reject/i.test(line);
}

/** Optional LLM fallback via any OpenAI-compatible endpoint (e.g. cerebras). */
export async function llmExtract(cfg, lines) {
  if (!cfg?.llm?.baseUrl || !cfg?.llm?.apiKey || lines.length === 0) return [];
  const prompt =
    'Each input line is a chat-gateway log line about a rejected/unauthorized ' +
    'sender. Extract a JSON array of {"senderId": "<numeric id>", "name": ' +
    '"<display name>", "platform": "<platform>"} — one entry per line that ' +
    'contains a rejected sender, [] if none. Output ONLY the JSON array.\n\n' +
    lines.map((l) => `LINE: ${l}`).join('\n');
  try {
    const res = await fetch(new URL('/v1/chat/completions', cfg.llm.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.llm.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '[]';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]).map(validateKnock).filter(Boolean);
  } catch {
    return []; // model down/slow → regex-only mode, never blind
  }
}
