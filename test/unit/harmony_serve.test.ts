import { Readable, Writable } from 'stream';
import { describe, expect, it } from 'vitest';
import { runHarmonyServe } from '../../src/cli/harmony_serve';

function fakeDevice() {
    const calls: string[] = [];
    return {
        calls,
        serial: 'device-1',
        observe: async () => ({
            observationId: 'o1', observedAt: '2026-11-01T00:00:00.000Z', serial: 'device-1',
            width: 100, height: 200, coordinateSpace: 'physical-pixels', locked: false,
            bundleName: 'com.example.app',
            tree: { toJson: () => ({ bundleName: 'com.example.app' }), getContentSig: () => 'sig-1' },
        }),
        find: (selector: unknown) => [{ index: 0, selector }],
        tap: async () => { calls.push('tap'); return { outcome: 'completed' }; },
        swipe: async () => { calls.push('swipe'); return { outcome: 'completed' }; },
        typeText: async () => { calls.push('typeText'); return { outcome: 'completed' }; },
        pressKey: async () => { calls.push('pressKey'); return { outcome: 'completed' }; },
        findApps: () => [{ bundleName: 'com.example.app' }],
        launchApp: async () => { calls.push('launchApp'); return { outcome: 'completed' }; },
        stopApp: async () => { calls.push('stopApp'); return { outcome: 'completed' }; },
        close: async () => { calls.push('close'); },
    };
}

describe('harmony serve', () => {
    it('answers each line, survives bad input, and stops on close', async () => {
        const device = fakeDevice();
        const input = Readable.from([
            '{"id":1,"method":"observe","params":{}}\n',
            'not json\n',
            '{"id":2,"method":"nope","params":{}}\n',
            '{"id":3,"method":"tap","params":{"selector":{"text":"OK"}}}\n',
            '{"id":4,"method":"close","params":{}}\n',
        ]);
        let out = '';
        const output = new Writable({ write(chunk, _encoding, callback) { out += chunk.toString(); callback(); } });

        await runHarmonyServe({ input, output }, { connect: async () => device as never });

        const lines = out.trim().split('\n').map((line) => JSON.parse(line));
        expect(lines).toHaveLength(5);
        expect(lines[0]).toMatchObject({ id: 1, ok: true });
        expect(lines[0].result.observationId).toBe('o1');
        expect(lines[1]).toMatchObject({ id: null, ok: false, error: { code: 'BAD_REQUEST' } });
        expect(lines[2]).toMatchObject({ id: 2, ok: false, error: { code: 'UNKNOWN_METHOD' } });
        expect(lines[3]).toMatchObject({ id: 3, ok: true });
        expect(lines[4]).toMatchObject({ id: 4, ok: true });
        expect(device.calls).toEqual(['tap', 'close']);
    });

    it('returns base64 pixels when the client asks for a screenshot', async () => {
        const device = {
            ...fakeDevice(),
            observe: async () => ({
                observationId: 'o1', observedAt: 't', serial: 'device-1', width: 100, height: 200,
                coordinateSpace: 'physical-pixels', locked: false, bundleName: 'com.example.app',
                screenshot: { mimeType: 'image/png', data: Buffer.from('pixels'), width: 100, height: 200, pixelToDeviceScale: 1 },
            }),
        };
        const input = Readable.from(['{"id":1,"method":"observe","params":{"screenshot":true}}\n', '{"id":2,"method":"close","params":{}}\n']);
        let out = '';
        const output = new Writable({ write(chunk, _encoding, callback) { out += chunk.toString(); callback(); } });
        await runHarmonyServe({ input, output }, { connect: async () => device as never });
        const lines = out.trim().split('\n').map((line) => JSON.parse(line));
        expect(lines[0].result.screenshot).toMatchObject({ mimeType: 'image/png', data: Buffer.from('pixels').toString('base64') });
    });

    it('keeps answering after a handler throws outside the device call', async () => {
        const device = { ...fakeDevice(), close: async () => { throw new Error('disconnect failed'); } };
        const input = Readable.from([
            '{"id":1,"method":"close","params":{}}\n',
            '{"id":2,"method":"observe","params":{}}\n',
        ]);
        let out = '';
        const output = new Writable({ write(chunk, _encoding, callback) { out += chunk.toString(); callback(); } });
        await runHarmonyServe({ input, output }, { connect: async () => device as never });
        const lines = out.trim().split('\n').map((line) => JSON.parse(line));
        expect(lines[0]).toMatchObject({ id: 1, ok: true });
        expect(lines[1]).toMatchObject({ id: 2, ok: false, error: { code: 'SESSION_CLOSED' } });
    });

    it('reports device errors without stopping the session', async () => {
        const device = { ...fakeDevice(), tap: async () => { throw new Error('boom'); } };
        const input = Readable.from([
            '{"id":1,"method":"tap","params":{}}\n',
            '{"id":2,"method":"close","params":{}}\n',
        ]);
        let out = '';
        const output = new Writable({ write(chunk, _encoding, callback) { out += chunk.toString(); callback(); } });
        await runHarmonyServe({ input, output }, { connect: async () => device as never });
        const lines = out.trim().split('\n').map((line) => JSON.parse(line));
        expect(lines[0]).toMatchObject({ id: 1, ok: false, error: { code: 'INTERNAL_ERROR' } });
        expect(lines[1]).toMatchObject({ id: 2, ok: true });
    });
});
