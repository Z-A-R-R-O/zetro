const DEFAULT_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqStreamingProvider {
  constructor({ apiKey = process.env.GROQ_API_KEY, model = 'openai/gpt-oss-120b', fetchImpl = fetch, endpoint = DEFAULT_ENDPOINT } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('GROQ_API_KEY is required');
    if (typeof model !== 'string' || !model.trim()) throw new Error('A model is required');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') throw new Error('Provider endpoint must use HTTPS');
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.endpoint = url.toString();
  }

  async *stream({ messages, signal }) {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ model: this.model, messages, stream: true, temperature: 0.4 }),
      signal
    });
    if (!response.ok) throw new Error(`Provider request failed with HTTP ${response.status}`);
    if (!response.body) throw new Error('Provider returned no response stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    try {
      while (!finished) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { finished = true; break; }
          let event;
          try { event = JSON.parse(payload); } catch { throw new Error('Provider sent malformed stream data'); }
          const content = event?.choices?.[0]?.delta?.content;
          if (typeof content === 'string' && content.length) yield content;
          const reason = event?.choices?.[0]?.finish_reason;
          if (reason === 'content_filter') throw new Error('Provider stopped the response due to content filtering');
        }
        if (done) break;
      }
      if (!finished && buffer.trim().startsWith('data:')) {
        const payload = buffer.trim().slice(5).trim();
        if (payload && payload !== '[DONE]') {
          let event;
          try { event = JSON.parse(payload); } catch { throw new Error('Provider sent malformed final stream data'); }
          const content = event?.choices?.[0]?.delta?.content;
          if (typeof content === 'string' && content.length) yield content;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
