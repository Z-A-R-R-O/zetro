function toConversation(row) {
  if (!row) return null;
  const messages = typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages;
  return {
    conversationId: row.conversation_id,
    principalId: row.principal_id,
    messages: Array.isArray(messages) ? messages : [],
    version: Number(row.version),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export class PostgresConversationStore {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') {
      throw new Error('A PostgreSQL-compatible pool with query() is required');
    }
    this.pool = pool;
  }

  async get(conversationId) {
    const result = await this.pool.query(
      'SELECT conversation_id, principal_id, messages, version, created_at, updated_at FROM ame_conversations WHERE conversation_id = $1',
      [conversationId]
    );
    return toConversation(result.rows?.[0]);
  }

  async create({ conversationId, principalId }) {
    const result = await this.pool.query(
      'INSERT INTO ame_conversations (conversation_id, principal_id, messages) VALUES ($1, $2, $3::jsonb) RETURNING conversation_id, principal_id, messages, version, created_at, updated_at',
      [conversationId, principalId, JSON.stringify([])]
    );
    const created = toConversation(result.rows?.[0]);
    if (!created) throw new Error('Conversation insert returned no row');
    return created;
  }

  async save(conversation) {
    if (!Number.isSafeInteger(conversation.version) || conversation.version < 0) {
      throw new Error('Conversation version is missing or invalid');
    }
    const result = await this.pool.query(
      'UPDATE ame_conversations SET messages = $1::jsonb, version = version + 1, updated_at = NOW() WHERE conversation_id = $2 AND principal_id = $3 AND version = $4 RETURNING conversation_id, principal_id, messages, version, created_at, updated_at',
      [JSON.stringify(conversation.messages), conversation.conversationId, conversation.principalId, conversation.version]
    );
    const saved = toConversation(result.rows?.[0]);
    if (saved) return saved;

    const current = await this.get(conversation.conversationId);
    if (!current || current.principalId !== conversation.principalId) {
      throw new Error('Conversation not found');
    }
    throw new Error('Conversation version conflict; reload before retrying');
  }
}
