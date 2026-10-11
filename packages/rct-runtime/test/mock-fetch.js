const originalFetch = globalThis.fetch;
let callCount = 0;

globalThis.fetch = async (url, options) => {
  if (url === 'https://api.groq.com/openai/v1/chat/completions') {
    if (process.env.MOCK_502 === '1') {
      return { ok: false, status: 502, headers: { get: () => null } };
    }

    if (process.env.MOCK_INVALID_TOOL === '1') {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: 'hallucinated_tool',
                  arguments: JSON.stringify({ arg: 'value' })
                }
              }]
            }
          }],
          usage: { prompt_tokens: 15, completion_tokens: 12 }
        })
      };
    }

    if (process.env.MOCK_READ_SLICE_INVALID === '1') {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: 'read_slice',
                  arguments: JSON.stringify({ path: 'src/greeting.txt', start: -1, length: 2048 })
                }
              }]
            }
          }],
          usage: { prompt_tokens: 15, completion_tokens: 12 }
        })
      };
    }

    if (process.env.MOCK_READ_SLICE_NULL === '1') {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  function: {
                    name: 'read_slice',
                    arguments: JSON.stringify({ path: 'src/greeting.txt', start: null, length: null })
                  }
                }]
              }
            }],
            usage: { prompt_tokens: 15, completion_tokens: 12 }
          })
        };
      }
      if (callCount === 2) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  function: {
                    name: 'propose_patch',
                    arguments: JSON.stringify({ path: 'src/greeting.txt', expectedSha256: '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03', content: 'hello world\n' })
                  }
                }]
              }
            }],
            usage: { prompt_tokens: 10, completion_tokens: 20 }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: 'submit_receipt',
                  arguments: JSON.stringify({ summary: 'done' })
                }
              }]
            }
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20 }
        })
      };
    }

    if (process.env.MOCK_READ_SLICE_OVERSIZED === '1') {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  function: {
                    name: 'read_slice',
                    arguments: JSON.stringify({ path: 'src/greeting.txt', start: 0, length: 10000 })
                  }
                }]
              }
            }],
            usage: { prompt_tokens: 15, completion_tokens: 12 }
          })
        };
      }
      if (callCount === 2) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  function: {
                    name: 'propose_patch',
                    arguments: JSON.stringify({ path: 'src/greeting.txt', expectedSha256: '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03', content: 'hello world\n' })
                  }
                }]
              }
            }],
            usage: { prompt_tokens: 10, completion_tokens: 20 }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: 'submit_receipt',
                  arguments: JSON.stringify({ summary: 'done' })
                }
              }]
            }
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20 }
        })
      };
    }

    const body = JSON.parse(options.body);
    if (process.env.ASSERT_MAX_TOKENS) {
      const expectedTokens = parseInt(process.env.ASSERT_MAX_TOKENS, 10);
      if (callCount === 0 && body.max_completion_tokens !== expectedTokens) {
        console.error(`ASSERT_MAX_TOKENS failed on first call: expected ${expectedTokens}, got ${body.max_completion_tokens}`);
        process.exit(5);
      }
      if (body.max_completion_tokens > expectedTokens) {
        console.error(`ASSERT_MAX_TOKENS bounds failed: expected <= ${expectedTokens}, got ${body.max_completion_tokens}`);
        process.exit(5);
      }
    }

    callCount++;
    if (callCount === 1) {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: 'propose_patch',
                  arguments: JSON.stringify({ path: 'src/greeting.txt', expectedSha256: '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03', content: 'hello world\n' })
                }
              }]
            }
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20 }
        })
      };
    } else {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: 'submit_receipt',
                  arguments: JSON.stringify({ summary: 'done' })
                }
              }]
            }
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20 }
        })
      };
    }
  }
  return originalFetch(url, options);
};
