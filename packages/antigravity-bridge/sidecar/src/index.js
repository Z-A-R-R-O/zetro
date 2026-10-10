export class SidecarProbe {
    constructor(adapter) {
        this.adapter = adapter;
    }

    async runProbe(taskId) {
        try {
            if (typeof taskId !== 'string' || !taskId.trim()) {
                return { status: 'error', message: 'Invalid taskId' };
            }

            const identity = await this.adapter.verify('AGR-1');
            if (!identity || !identity.connected) {
                return { status: 'error', message: 'AGR-1 identity verification failed or disconnected' };
            }

            const deliveryResult = await this.adapter.send('AGR-1', taskId.trim());

            if (!deliveryResult || deliveryResult.delivery !== 'submitted') {
                return { 
                    status: 'error', 
                    message: `Delivery failed. Expected 'submitted', received: '${deliveryResult ? deliveryResult.delivery : 'undefined'}'` 
                };
            }

            return {
                status: 'submitted',
                taskId: taskId.trim(),
                agent: identity.agent,
                completed: false,
                delivery: deliveryResult.delivery
            };
        } catch (err) {
            return { status: 'error', message: err.message || String(err) };
        }
    }
}
