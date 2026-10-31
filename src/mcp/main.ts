import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeHarmonySession, createHarmonyMcpServer, HarmonyMcpState } from './server';

async function main(): Promise<void> {
    const state: HarmonyMcpState = {};
    const server = createHarmonyMcpServer(state);
    const transport = new StdioServerTransport();
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
        if (!closing) {
            closing = closeHarmonySession(state)
                .catch((error) => console.error('Failed to close HarmonyOS session:', error))
                .then(() => server.close().catch(() => {}));
        }
        return closing;
    };

    process.once('SIGINT', () => { void close(); });
    process.once('SIGTERM', () => { void close(); });
    process.stdin.once('end', () => { void close(); });
    await server.connect(transport);
}

void main().catch((error: unknown) => {
    console.error('HapTest HarmonyOS MCP server failed to start:', error);
    process.exitCode = 1;
});
