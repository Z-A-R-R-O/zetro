const MAX_MESSAGE_CHARS = 8000;
const MAX_HISTORY_MESSAGES = 40;

function assertText(value, label, max = MAX_MESSAGE_CHARS) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`Invalid ${label}`);
  }
}

export class InMemoryConversationStore {
  #conversations = new Map();

  async get(conversationId) {
    const value = this.#conversations.get(conversationId);
    return value ? structuredClone(value) : null;
  }

  async create({ conversationId, principalId }) {
    if (this.#conversations.has(conversationId)) throw new Error('Conversation already exists');
    const value = { conversationId, principalId, messages: [], version: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.#conversations.set(conversationId, value);
    return structuredClone(value);
  }

  async save(conversation) {
    const current = this.#conversations.get(conversation.conversationId);
    if (!current || current.principalId !== conversation.principalId) throw new Error('Conversation not found');
    if (current.version !== conversation.version) throw new Error('Conversation version conflict; reload before retrying');
    const value = { ...structuredClone(conversation), version: current.version + 1, updatedAt: new Date().toISOString() };
    this.#conversations.set(value.conversationId, value);
    return structuredClone(value);
  }
}

export class ConversationService {
  #active = new Set();

  constructor({ provider, store, systemPrompt = 'You are AME, a helpful personal assistant. Be clear, warm, and honest.' }) {
    if (!provider || typeof provider.stream !== 'function') throw new Error('A streaming provider is required');
    if (!store || !['get', 'create', 'save'].every(key => typeof store[key] === 'function')) {
      throw new Error('A conversation store implementing get/create/save is required');
    }
    this.provider = provider;
    this.store = store;
    this.systemPrompt = systemPrompt;
  }

  async open({ conversationId, principalId }) {
    assertText(conversationId, 'conversationId', 128);
    assertText(principalId, 'principalId', 256);
    const existing = await this.store.get(conversationId);
    if (existing) {
      if (existing.principalId !== principalId) throw new Error('Conversation principal mismatch');
      return { conversationId, resumed: true };
    }
    await this.store.create({ conversationId, principalId });
    return { conversationId, resumed: false };
  }

  async *turn({ conversationId, principalId, turnId, text, signal }) {
    assertText(conversationId, 'conversationId', 128);
    assertText(principalId, 'principalId', 256);
    assertText(turnId, 'turnId', 128);
    assertText(text, 'user message');
    const lockKey = JSON.stringify([principalId, conversationId]);
    if (this.#active.has(lockKey)) throw new Error('A turn is already active for this conversation');
    this.#active.add(lockKey);
    try {
      let conversation = await this.store.get(conversationId);
      if (!conversation || conversation.principalId !== principalId) throw new Error('Conversation not found');
      if (conversation.messages.some(message => message.turnId === turnId)) throw new Error('Duplicate turnId');
      const history = conversation.messages.slice(-MAX_HISTORY_MESSAGES);
      const userMessage = { role: 'user', content: text, turnId };
      const messages = [{ role: 'system', content: this.systemPrompt }, ...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: text }];
      conversation.messages.push(userMessage);
      conversation = await this.store.save(conversation);
      let response = '';
      yield { type: 'assistant.started', conversationId, turnId };
      for await (const delta of this.provider.stream({ messages, signal })) {
        if (signal?.aborted) throw new Error('Turn cancelled');
        if (typeof delta !== 'string' || delta.length === 0) continue;
        response += delta;
        if (response.length > 24000) throw new Error('Assistant response exceeded limit');
        yield { type: 'assistant.delta', conversationId, turnId, text: delta };
      }
      if (!response.trim()) throw new Error('Provider returned an empty response');
      conversation.messages.push({ role: 'assistant', content: response, turnId });
      conversation.messages = conversation.messages.slice(-MAX_HISTORY_MESSAGES);
      conversation = await this.store.save(conversation);
      yield { type: 'assistant.complete', conversationId, turnId, text: response };
    } finally {
      this.#active.delete(lockKey);
    }
  }
}
