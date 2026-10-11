const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS_ENDPOINT = 'https://api.groq.com/openai/v1/models';
const MODELS = new Set(['qwen/qwen3.8-27b', 'openai/gpt-oss-120b']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function networkCodes(error) {
  const codes = new Set();
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (typeof item.code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(item.code)) codes.add(item.code);
    if (Array.isArray(item.errors)) item.errors.forEach(visit);
    visit(item.cause);
  };
  visit(error);
  return [...codes];
}

function isTransportFailure(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || (error instanceof TypeError && error.message === 'fetch failed');
}

const tool = (name, description, properties, required = []) => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } }
});

const TOOL_SCHEMAS = {
  list_paths: tool('list_paths', 'List only the files permitted by this assignment.', {}),
  search: tool('search', 'Find a literal term in allowed files; returns bounded offsets.', { term: { type: 'string' } }, ['term']),
  read_slice: tool('read_slice', 'Read a bounded byte slice from an allowed file (at most 4096 bytes per call).', { path: { type: 'string', description: 'Path to an allowed file.' }, start: { type: 'integer', minimum: 0, description: 'Starting byte offset (default 0).' }, length: { type: 'integer', minimum: 1, maximum: 4096, description: 'Number of bytes to read (default 2048, maximum 4096).' } }, ['path']),
  propose_patch: tool('propose_patch', 'Replace one allowed file in the isolated snapshot only when its SHA-256 preimage matches.', { path: { type: 'string' }, expectedSha256: { type: 'string' }, content: { type: 'string' } }, ['path', 'expectedSha256', 'content']),
  run_check: tool('run_check', 'Run the fixed independent acceptance checks on the isolated snapshot.', {}),
  submit_receipt: tool('submit_receipt', 'Finish the attempt with a concise work summary. Independent checks determine the result.', { summary: { type: 'string' } }, ['summary'])
};

function convertMessages(messages) {
  const converted = [];
  let previousCallId;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if ((message.role === 'system' || message.role === 'user') && typeof message.content === 'string') {
      converted.push({ role: message.role, content: message.content });
    } else if (message.role === 'assistant' && message.toolCall) {
      previousCallId = `rct_call_${i}`;
      converted.push({ role: 'assistant', content: null, tool_calls: [{ id: previousCallId, type: 'function', function: { name: message.toolCall.name, arguments: JSON.stringify(message.toolCall.args) } }] });
    } else if (message.role === 'tool' && typeof message.content === 'string' && previousCallId) {
      converted.push({ role: 'tool', tool_call_id: previousCallId, content: message.content });
      previousCallId = undefined;
    } else {
      throw new Error('Invalid provider message history');
    }
  }
  return converted;
}

export class GroqProvider {
  constructor({ apiKey = process.env.GROQ_API_KEY, model = 'qwen/qwen3.8-27b', fetchImpl = fetch, retryDelayMs = 400 } = {}) {
    if (!apiKey || typeof apiKey !== 'string') throw new Error('GROQ_API_KEY is required');
    if (!MODELS.has(model)) throw new Error('Unsupported pilot model');
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.retryDelayMs = Math.max(0, Math.min(2000, retryDelayMs));
    this.name = `groq:${model}`;
  }

  async checkAccess(timeoutMs = 20000) {
    const response = await this.fetchImpl(MODELS_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, 60000)))
    });
    if (!response.ok) throw httpError(response);
    const body = await response.json();
    if (!Array.isArray(body?.data)) throw new Error('Malformed Groq models response');
    return { authenticated: true, modelAvailable: body.data.some(item => item?.id === this.model), model: this.model };
  }

  async next({ messages, tools, maxOutputTokens, timeoutMs }) {
    if (!Array.isArray(tools) || tools.some(name => !TOOL_SCHEMAS[name])) throw new Error('Invalid tool selection');
    const request = {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: convertMessages(messages), tools: tools.map(name => TOOL_SCHEMAS[name]), tool_choice: 'required', parallel_tool_calls: false, max_completion_tokens: maxOutputTokens, temperature: 0 }),
    };
    const deadline = Date.now() + Math.max(1, Math.min(timeoutMs, 90000));
    let response;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await this.fetchImpl(ENDPOINT, { ...request, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
        break;
      } catch (error) {
        if (!isTransportFailure(error)) throw error;
        if (attempt === 1 && deadline - Date.now() > this.retryDelayMs + 1000) {
          await sleep(this.retryDelayMs);
          continue;
        }
        const wrapped = new Error(`Groq transport failed after ${attempt} attempt${attempt === 1 ? '' : 's'}`);
        wrapped.name = 'ProviderTransportError';
        wrapped.cause = error;
        wrapped.attempts = attempt;
        wrapped.networkCodes = networkCodes(error);
        throw wrapped;
      }
    }
    if (!response.ok) throw httpError(response);
    const body = await response.json();
    const calls = body?.choices?.[0]?.message?.tool_calls;
    if (!Array.isArray(calls) || calls.length !== 1) throw new Error('Groq did not return exactly one tool call');
    const fn = calls[0]?.function;
    if (!fn || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') throw new Error('Malformed Groq tool call');
    let args;
    try { args = JSON.parse(fn.arguments); } catch { throw new Error('Malformed Groq tool arguments'); }
    return {
      toolCalls: [{ name: fn.name, args }],
      usage: { inputTokens: body?.usage?.prompt_tokens, outputTokens: body?.usage?.completion_tokens }
    };
  }
}

function httpError(response) {
  let name = 'ProviderError';
  if (response.status === 429) name = 'RateLimitError';
  else if (response.status >= 500 && response.status < 600) name = 'ProviderTransportError';

  const error = new Error(name === 'RateLimitError' ? 'Groq rate limit reached' : `Groq HTTP ${response.status}`);
  error.name = name;
  error.status = response.status;
  if (name === 'ProviderTransportError') {
    error.attempts = 1;
    error.networkCodes = [`HTTP_${response.status}`];
  }
  error.retryAfter = response.headers?.get?.('retry-after') ?? null;
  return error;
}
