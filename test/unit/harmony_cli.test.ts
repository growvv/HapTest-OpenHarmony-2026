import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { HarmonyCliDeps, runHarmonyCli } from '../../src/cli/harmony_command';
import { HarmonyDeviceError } from '../../src/device/harmony/errors';
import { HarmonyDevice } from '../../src/device/harmony/session';

const hdcMissing: HarmonyCliDeps = {
    doctor: () => { throw new HarmonyDeviceError('HDC_UNAVAILABLE', 'HDC could not report its version.'); },
    devices: () => [],
    connect: async () => { throw new Error('unused'); },
};

function depsWith(device: unknown): HarmonyCliDeps {
    return { ...hdcMissing, connect: async () => device as HarmonyDevice };
}

function unlockedObservation(overrides: Record<string, unknown> = {}) {
    return {
        observationId: 'o2', observedAt: '2026-11-01T00:00:00.000Z', serial: 'device-1',
        width: 100, height: 200, coordinateSpace: 'physical-pixels', locked: false,
        bundleName: 'com.example.app',
        tree: { toJson: () => ({ bundleName: 'com.example.app' }), getContentSig: () => 'sig-1' },
        ...overrides,
    };
}

function actionDevice(overrides: Record<string, unknown> = {}) {
    const calls: string[] = [];
    return {
        calls,
        serial: 'device-1',
        observe: async () => { calls.push('observe'); return unlockedObservation(); },
        findApps: () => [],
        tap: async () => { calls.push('tap'); return { outcome: 'completed' }; },
        typeText: async () => { calls.push('typeText'); return { outcome: 'completed' }; },
        pressKey: async () => { calls.push('pressKey'); return { outcome: 'completed' }; },
        swipe: async () => { calls.push('swipe'); return { outcome: 'completed' }; },
        launchApp: async () => { calls.push('launchApp'); return { outcome: 'completed' }; },
        stopApp: async () => { calls.push('stopApp'); return { outcome: 'completed' }; },
        close: async () => { calls.push('close'); },
        ...overrides,
    };
}

describe('harmony cli', () => {
    it('explains how to install HDC and exits 3', async () => {
        const result = await runHarmonyCli(['doctor'], hdcMissing);
        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain('DevEco');
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, errorCode: 'HDC_UNAVAILABLE' });
    });

    it('turns a bare HDC failure on devices into the install guidance', async () => {
        const result = await runHarmonyCli(['devices'], {
            ...hdcMissing,
            devices: () => { throw new Error('/bin/sh: hdc: command not found'); },
        });
        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain('DevEco');
        expect(JSON.parse(result.stdout).errorCode).toBe('HDC_UNAVAILABLE');
    });

    it('observes before every action and returns the resulting observation', async () => {
        const cases: Array<[string[], string]> = [
            [['tap', '--text', 'OK'], 'tap'],
            [['type', 'hello'], 'typeText'],
            [['key', 'BACK'], 'pressKey'],
            [['swipe', '--from', '10,20', '--to', '10,80'], 'swipe'],
            [['launch', 'com.a.b'], 'launchApp'],
            [['stop', 'com.a.b'], 'stopApp'],
        ];
        for (const [argv, action] of cases) {
            const device = actionDevice();
            const result = await runHarmonyCli(argv, depsWith(device));
            expect(result.exitCode, argv.join(' ')).toBe(0);
            expect(device.calls, argv.join(' ')).toEqual(['observe', action, 'observe', 'close']);
            expect(JSON.parse(result.stdout).observation.observationId, argv.join(' ')).toBe('o2');
        }
    });

    it('writes the screenshot to the requested path and keeps only metadata in JSON', async () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-cli-')), 'screen.png');
        const device = actionDevice({
            observe: async () => unlockedObservation({
                screenshot: { mimeType: 'image/png', data: Buffer.from('png-bytes'), width: 100, height: 200, pixelToDeviceScale: 1 },
            }),
        });
        const result = await runHarmonyCli(['observe', '--screenshot', file], depsWith(device));
        expect(result.exitCode).toBe(0);
        expect(fs.readFileSync(file).toString()).toBe('png-bytes');
        const parsed = JSON.parse(result.stdout);
        expect(parsed.observation.screenshot).toMatchObject({ mimeType: 'image/png', path: file });
        expect(parsed.observation.screenshot.data).toBeUndefined();
    });

    it('refuses to act when --expect-sig does not match', async () => {
        const device = actionDevice();
        const result = await runHarmonyCli(['tap', '--text', 'OK', '--expect-sig', 'stale'], depsWith(device));
        expect(result.exitCode).toBe(3);
        expect(device.calls).toEqual(['observe', 'close']);
        expect(JSON.parse(result.stdout).errorCode).toBe('STALE_OBSERVATION');
    });

    it('rejects an ambiguous selector with candidates and exit 1', async () => {
        const device = actionDevice({
            tap: async () => {
                throw new HarmonyDeviceError('AMBIGUOUS_TARGET', 'multi', { candidates: [{ index: 0 }, { index: 1 }] });
            },
        });
        const result = await runHarmonyCli(['tap', '--text', 'OK'], depsWith(device));
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.stdout).details.candidates).toHaveLength(2);
    });

    it('reports a not-ready doctor with ok:false and exit 3', async () => {
        const result = await runHarmonyCli(['doctor'], {
            ...hdcMissing,
            doctor: () => ({ hdcVersion: '3.2.0c', devices: [], issues: ['No connected HarmonyOS device is available.'] }),
        });
        expect(result.exitCode).toBe(3);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, errorCode: 'DEVICE_NOT_READY' });
    });

    it('maps usage mistakes to exit 2', async () => {
        const cases: string[][] = [
            ['bogus'],
            ['tap'],
            ['tap', '--text', 'OK', '--index', '5'],
            ['observe', '--screenshott', 'out.png'],
            ['type', 'hello', 'world'],
            ['key', 'NOPE'],
            ['swipe', '--from', 'bad', '--to', '1,2'],
        ];
        const devices: Record<string, unknown> = {
            'tap --text OK --index 5': actionDevice({
                tap: async () => { throw new HarmonyDeviceError('SELECTOR_INDEX_OUT_OF_RANGE', 'out of range', { candidateCount: 2 }); },
            }),
        };
        for (const argv of cases) {
            const device = devices[argv.join(' ')] ?? actionDevice();
            const result = await runHarmonyCli(argv, depsWith(device));
            expect(result.exitCode, argv.join(' ')).toBe(2);
            expect(result.stderr, argv.join(' ')).toContain('usage');
        }
    });
});
