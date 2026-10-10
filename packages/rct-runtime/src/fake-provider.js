export class FakeProvider {
  constructor(steps) {
    this.name = 'fake';
    this.steps = [...steps];
  }

  async next() {
    if (!this.steps.length) throw new Error('Fake provider exhausted');
    const call = this.steps.shift();
    return { toolCalls: [call], usage: { inputTokens: 20, outputTokens: 10 } };
  }
}
