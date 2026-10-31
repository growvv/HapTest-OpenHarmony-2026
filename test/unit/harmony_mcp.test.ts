import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Page } from '../../src/model/page';
import { HarmonyDeviceError } from '../../src/device/harmony/errors';
import { HarmonyDeviceSession, HarmonyObservation } from '../../src/device/harmony/session';
import { createHarmonyMcpServer, HarmonyMcpDependencies, HarmonyMcpState } from '../../src/mcp/server';

const observation: HarmonyObservation = {
    observationId: 'obs-1',
    observedAt: '2026-10-17T00:00:00.000Z',
    serial: 'serial-A',
    bundleName: 'com.example.app',
    width: 100,
    height: 200,
    coordinateSpace: 'physical-pixels',
    locked: false,
    tree: { toJson: () => ({ bundleName: 'com.example.app', elements: [] }) } as Page,
    screenshot: { mimeType: 'image/png', data: Buffer.from('png-bytes'), width: 100, height: 200, pixelToDeviceScale: 1 },
};

function fakeSession() {
    return {
        serial: 'serial-A',
        observe: vi.fn(async () => observation),
        find: vi.fn((selector: unknown) => [{ index: 0, selector }]),
        tap: vi.fn(async (args: unknown) => ({ outcome: 'completed', target: args })),
        swipe: vi.fn(async (args: unknown) => ({ outcome: 'completed', args })),
        pressKey: vi.fn(async (key: string) => ({ outcome: 'completed', key })),
        pressButton: vi.fn(async (name: string) => ({ outcome: 'completed', name })),
        typeText: vi.fn(async (text: string, options: unknown) => ({ outcome: 'completed', text, options })),
        findApps: vi.fn((query?: string) => [{ bundleName: 'com.example.app', query }]),
        launchApp: vi.fn(async (bundleName: string) => ({ outcome: 'completed', bundleName })),
        stopApp: vi.fn(async (bundleName: string) => ({ outcome: 'completed', bundleName })),
        startPreview: vi.fn(async () => ({ running: true })),
        pausePreview: vi.fn(async () => ({ running: false })),
        getPreviewFrame: vi.fn(async () => ({ mimeType: 'image/jpeg' as const, data: Buffer.from('jpeg-frame'), width: 100, height: 200 })),
        close: vi.fn(async () => {}),
    };
}

async function connect(state: HarmonyMcpState, dependencies: HarmonyMcpDependencies, supportsUi = false) {
    const server = createHarmonyMcpServer(state, dependencies);
    const client = new Client({ name: 'haptest-mcp-test', version: '1.0.0' }, {
        capabilities: supportsUi ? {
            extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
        } : {},
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return {
        client,
        server,
        close: async () => Promise.all([client.close(), server.close()]),
    };
}

function decode(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
    const first = result.content.find((item) => item.type === 'text');
    if (!first?.text) throw new Error('No text result returned.');
    return JSON.parse(first.text) as Record<string, unknown>;
}

afterEach(() => vi.restoreAllMocks());

describe('HarmonyOS MCP adapter', () => {
    it('publishes the tool contract and maps observations into text and image blocks', async () => {
        const session = fakeSession();
        const state: HarmonyMcpState = { session: session as unknown as HarmonyDeviceSession };
        const doctor = vi.fn(() => ({ hdcVersion: 'Ver: test', devices: [] }));
        const dependencies: HarmonyMcpDependencies = {
            doctor,
            devices: () => [],
            connect: vi.fn(),
        };
        const peer = await connect(state, dependencies, true);
        try {
            expect(peer.server.server.getClientCapabilities()).toMatchObject({
                extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
            });
            const tools = await peer.client.listTools();
            expect(tools.tools.map((tool) => tool.name)).toEqual([
                'doctor', 'devices', 'ready', 'observe', 'tap', 'find', 'swipe', 'double_tap', 'long_press', 'drag',
                'press_key', 'press_button', 'type_text', 'apps', 'launch_app', 'stop_app', 'disconnect',
                'screen_preview', 'screen_preview_frame', 'screen_preview_pause', 'screen_preview_resume',
            ]);
            expect(tools.tools.find((tool) => tool.name === 'screen_preview')?._meta).toMatchObject({
                ui: { resourceUri: 'ui://haptest-harmonyos/screen-preview', visibility: ['model', 'app'] },
            });
            expect(tools.tools.find((tool) => tool.name === 'screen_preview_frame')?._meta).toMatchObject({
                ui: { visibility: ['app'] },
            });
            const widget = await peer.client.readResource({ uri: 'ui://haptest-harmonyos/screen-preview' });
            expect(widget.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app' });
            const widgetHtml = 'text' in widget.contents[0] ? widget.contents[0].text : '';
            expect(widgetHtml).toContain('ui/initialize');
            expect(widgetHtml).toContain("appInfo:{name:'haptest-harmonyos-screen-preview',version:'0.2.3'}");
            expect(widgetHtml).toContain("protocolVersion:'2026-01-26'");
            expect(widgetHtml).toContain('#frame[hidden],#empty[hidden]{display:none}');
            await peer.client.callTool({ name: 'screen_preview', arguments: {} });
            const previewFrame = await peer.client.callTool({ name: 'screen_preview_frame', arguments: {} });
            expect(previewFrame.content).toContainEqual({ type: 'image', data: Buffer.from('jpeg-frame').toString('base64'), mimeType: 'image/jpeg' });
            await peer.client.callTool({ name: 'screen_preview_pause', arguments: {} });
            expect(session.startPreview).toHaveBeenCalledOnce();
            expect(session.getPreviewFrame).toHaveBeenCalledOnce();
            expect(session.pausePreview).toHaveBeenCalledOnce();
            const diagnostic = await peer.client.callTool({ name: 'doctor', arguments: { serial: 'serial-A' } });
            expect(decode(diagnostic as never)).toMatchObject({ ok: true, hdcVersion: 'Ver: test' });
            expect(doctor).toHaveBeenCalledWith({ serial: 'serial-A' });
            const result = await peer.client.callTool({ name: 'observe', arguments: { mode: 'both' } });
            expect(decode(result as never)).toMatchObject({
                ok: true,
                observation: {
                    observationId: 'obs-1',
                    coordinateSpace: 'physical-pixels',
                    tree: { bundleName: 'com.example.app' },
                    screenshot: { mimeType: 'image/png', pixelToDeviceScale: 1 },
                },
            });
            expect(result.content.some((item) => item.type === 'image' && item.mimeType === 'image/png')).toBe(true);
            expect(session.observe).toHaveBeenCalledWith({ screenshot: true });
        } finally {
            await peer.close();
        }
    });

    it('refuses to start preview when the host did not negotiate MCP Apps capability', async () => {
        const session = fakeSession();
        const peer = await connect({ session: session as unknown as HarmonyDeviceSession }, {
            doctor: () => ({ hdcVersion: 'Ver: test', devices: [] }),
            devices: () => [],
            connect: vi.fn(),
        });
        try {
            const tools = await peer.client.listTools();
            expect(tools.tools.some((tool) => tool.name === 'screen_preview')).toBe(true);
            await expect(peer.client.listResources()).resolves.toMatchObject({ resources: [
                { uri: 'ui://haptest-harmonyos/screen-preview', mimeType: 'text/html;profile=mcp-app' },
            ] });
            const result = await peer.client.callTool({ name: 'screen_preview', arguments: {} });
            expect(result.isError).toBe(true);
            expect(decode(result as never)).toMatchObject({ ok: false, errorCode: 'ACTION_PRECONDITION_FAILED' });
            expect(session.startPreview).not.toHaveBeenCalled();
        } finally {
            await peer.close();
        }
    });

    it('maps selectors, keys, text and app actions to the shared session API', async () => {
        const session = fakeSession();
        const peer = await connect({ session: session as unknown as HarmonyDeviceSession }, {
            doctor: () => ({ hdcVersion: 'Ver: test', devices: [] }),
            devices: () => [],
            connect: vi.fn(),
        });
        try {
            await peer.client.callTool({ name: 'tap', arguments: { selector: { text: 'Continue' } } });
            await peer.client.callTool({ name: 'find', arguments: { selector: { textContains: 'Continue' } } });
            await peer.client.callTool({ name: 'press_key', arguments: { key: 'BACK' } });
            await peer.client.callTool({ name: 'press_button', arguments: { name: 'home' } });
            await peer.client.callTool({ name: 'type_text', arguments: { text: 'ordinary', verify: true } });
            await peer.client.callTool({ name: 'apps', arguments: { query: 'example' } });
            await peer.client.callTool({ name: 'launch_app', arguments: { bundleName: 'com.example.app' } });
            await peer.client.callTool({ name: 'stop_app', arguments: { bundleName: 'com.example.app' } });

            expect(session.tap).toHaveBeenCalledWith({ selector: { text: 'Continue' } });
            expect(session.find).toHaveBeenCalledWith({ textContains: 'Continue' });
            expect(session.pressKey).toHaveBeenCalledWith('BACK');
            expect(session.pressButton).toHaveBeenCalledWith('home');
            expect(session.typeText).toHaveBeenCalledWith('ordinary', { allowNewlines: undefined, verify: true });
            expect(session.findApps).toHaveBeenCalledWith('example');
            expect(session.launchApp).toHaveBeenCalledWith('com.example.app');
            expect(session.stopApp).toHaveBeenCalledWith('com.example.app');
        } finally {
            await peer.close();
        }
    });

    it('connects and observes before reporting ready, and releases failed startup sessions', async () => {
        const session = fakeSession();
        const state: HarmonyMcpState = {};
        const dependencies: HarmonyMcpDependencies = {
            doctor: () => ({ hdcVersion: 'Ver: test', devices: [] }),
            devices: () => [],
            connect: vi.fn(async () => session as unknown as HarmonyDeviceSession),
        };
        const peer = await connect(state, dependencies);
        try {
            const result = await peer.client.callTool({ name: 'ready', arguments: { serial: 'serial-A' } });
            expect(decode(result as never)).toMatchObject({ ok: true, connectedNow: true });
            expect(dependencies.connect).toHaveBeenCalledWith({ serial: 'serial-A' });
            expect(session.observe).toHaveBeenCalledWith({ screenshot: true });
            expect(state.session).toBe(session);
        } finally {
            await peer.close();
        }

        const failedSession = fakeSession();
        failedSession.observe.mockRejectedValue(new HarmonyDeviceError('OBSERVE_FAILED', 'read failed'));
        const failedState: HarmonyMcpState = {};
        const failedPeer = await connect(failedState, { ...dependencies, connect: async () => failedSession as unknown as HarmonyDeviceSession });
        try {
            const result = await failedPeer.client.callTool({ name: 'ready', arguments: {} });
            expect(result.isError).toBe(true);
            expect(failedSession.close).toHaveBeenCalledOnce();
            expect(failedState.session).toBeUndefined();
        } finally {
            await failedPeer.close();
        }
    });

    it('encodes domain action uncertainty with no replay instruction', async () => {
        const session = fakeSession();
        session.tap.mockRejectedValue(new HarmonyDeviceError('ACTION_OUTCOME_UNCERTAIN', 'Action result is unknown.', {
            replayAction: false,
            outcome: 'unknown',
        }));
        const peer = await connect({ session: session as unknown as HarmonyDeviceSession }, {
            doctor: () => ({ hdcVersion: 'Ver: test', devices: [] }),
            devices: () => [],
            connect: vi.fn(),
        });
        try {
            const result = await peer.client.callTool({ name: 'tap', arguments: { x: 10, y: 20, observationId: 'obs-1' } });
            expect(result.isError).toBe(true);
            expect(decode(result as never)).toMatchObject({
                errorCode: 'ACTION_OUTCOME_UNCERTAIN',
                replayAction: false,
            });
        } finally {
            await peer.close();
        }
    });
});
