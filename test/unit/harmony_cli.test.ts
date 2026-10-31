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
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const device = {
        calls,
        serial: 'device-1',
        observe: async () => unlockedObservation(),
        findApps: () => [],
        tap: async (...args: unknown[]) => { calls.push({ name: 'tap', args }); return { outcome: 'completed' }; },
        typeText: async (...args: unknown[]) => { calls.push({ name: 'typeText', args }); return { outcome: 'completed' }; },
        pressKey: async (...args: unknown[]) => { calls.push({ name: 'pressKey', args }); return { outcome: 'completed' }; },
        swipe: async (...args: unknown[]) => { calls.push({ name: 'swipe', args }); return { outcome: 'completed' }; },
        launchApp: async (...args: unknown[]) => { calls.push({ name: 'launchApp', args }); return { outcome: 'completed' }; },
        stopApp: async (...args: unknown[]) => { calls.push({ name: 'stopApp', args }); return { outcome: 'completed' }; },
        close: async () => {},
        ...overrides,
    };
    return device;
}

describe('harmony cli', () => {
    it('explains how to install HDC and exits 3', async () => {
        const result = await runHarmonyCli(['doctor'], hdcMissing);
        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain('DevEco');
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, errorCode: 'HDC_UNAVAILABLE' });
    });

    it('exits 2 on an unknown command', async () => {
        const result = await runHarmonyCli(['bogus'], hdcMissing);
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain('usage');
    });

    it('lists devices without connecting', async () => {
        const result = await runHarmonyCli(['devices'], { ...hdcMissing, devices: () => [{ serial: 'device-1' } as never] });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, devices: [{ serial: 'device-1' }] });
    });

    it('reports a locked device without a tree, then closes the session', async () => {
        const closed: string[] = [];
        const device = {
            serial: 'device-1',
            observe: async () => ({
                observationId: 'o1', observedAt: 't', serial: 'device-1', width: 100, height: 200,
                coordinateSpace: 'physical-pixels', locked: true,
            }),
            findApps: () => [],
            close: async () => { closed.push('close'); },
        };
        const result = await runHarmonyCli(['observe'], depsWith(device));
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.observation.locked).toBe(true);
        expect(parsed.observation.tree).toBeUndefined();
        expect(closed).toEqual(['close']);
    });

    it('writes the screenshot to the requested path and keeps only metadata in JSON', async () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-cli-')), 'screen.png');
        const device = {
            ...actionDevice(),
            observe: async () => unlockedObservation({
                screenshot: { mimeType: 'image/png', data: Buffer.from('png-bytes'), width: 100, height: 200, pixelToDeviceScale: 1 },
            }),
        };
        const result = await runHarmonyCli(['observe', '--screenshot', file], depsWith(device));
        expect(result.exitCode).toBe(0);
        expect(fs.readFileSync(file).toString()).toBe('png-bytes');
        const parsed = JSON.parse(result.stdout);
        expect(parsed.observation.screenshot).toMatchObject({ mimeType: 'image/png', path: file });
        expect(parsed.observation.screenshot.data).toBeUndefined();
    });

    it('lists apps filtered by query', async () => {
        const device = { ...actionDevice(), findApps: (query?: string) => (query ? [{ bundleName: `com.${query}` }] : []) };
        const result = await runHarmonyCli(['apps', '--query', 'settings'], depsWith(device));
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ ok: true, apps: [{ bundleName: 'com.settings' }] });
    });

    it('taps a selector, then reports the resulting observation', async () => {
        const device = actionDevice();
        const result = await runHarmonyCli(['tap', '--text', 'OK'], depsWith(device));
        expect(result.exitCode).toBe(0);
        expect(device.calls).toEqual([{ name: 'tap', args: [{ selector: { text: 'OK' }, index: undefined }] }]);
        expect(JSON.parse(result.stdout).observation.observationId).toBe('o2');
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

    it('refuses to act when --expect-sig does not match', async () => {
        const device = actionDevice();
        const result = await runHarmonyCli(['tap', '--text', 'OK', '--expect-sig', 'stale'], depsWith(device));
        expect(result.exitCode).toBe(3);
        expect(device.calls).toEqual([]);
        expect(JSON.parse(result.stdout).errorCode).toBe('STALE_OBSERVATION');
    });

    it('exits 2 when a tap has no target form', async () => {
        const result = await runHarmonyCli(['tap'], depsWith(actionDevice()));
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain('usage');
    });

    it('types text, presses a key, swipes, launches and stops an app', async () => {
        const device = actionDevice();
        expect((await runHarmonyCli(['type', 'hello'], depsWith(device))).exitCode).toBe(0);
        expect((await runHarmonyCli(['key', 'BACK'], depsWith(device))).exitCode).toBe(0);
        expect((await runHarmonyCli(['swipe', '--from', '10,20', '--to', '10,80'], depsWith(device))).exitCode).toBe(0);
        expect((await runHarmonyCli(['launch', 'com.huawei.hmos.settings'], depsWith(device))).exitCode).toBe(0);
        expect((await runHarmonyCli(['stop', 'com.huawei.hmos.settings'], depsWith(device))).exitCode).toBe(0);
        expect(device.calls.map((call) => call.name)).toEqual(['typeText', 'pressKey', 'swipe', 'launchApp', 'stopApp']);
    });
});
