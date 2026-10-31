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

function lockedDevice() {
    const closed: string[] = [];
    return {
        closed,
        serial: 'device-1',
        observe: async () => ({
            observationId: 'o1', observedAt: '2026-11-01T00:00:00.000Z', serial: 'device-1',
            width: 100, height: 200, coordinateSpace: 'physical-pixels', locked: true,
        }),
        findApps: () => [],
        close: async () => { closed.push('close'); },
    };
}

function unlockedDevice() {
    return {
        serial: 'device-1',
        observe: async () => ({
            observationId: 'o2', observedAt: '2026-11-01T00:00:00.000Z', serial: 'device-1',
            width: 100, height: 200, coordinateSpace: 'physical-pixels', locked: false,
            bundleName: 'com.example.app',
            tree: { toJson: () => ({ bundleName: 'com.example.app' }), getContentSig: () => 'sig-1' },
        }),
        findApps: (query?: string) => (query ? [{ bundleName: `com.${query}` }] : [{ bundleName: 'com.a' }, { bundleName: 'com.b' }]),
        close: async () => {},
    };
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
        const device = lockedDevice();
        const result = await runHarmonyCli(['observe'], depsWith(device));
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.observation.locked).toBe(true);
        expect(parsed.observation.tree).toBeUndefined();
        expect(device.closed).toEqual(['close']);
    });

    it('writes the screenshot to the requested path and keeps only metadata in JSON', async () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-cli-')), 'screen.png');
        const device = {
            ...unlockedDevice(),
            observe: async () => ({
                observationId: 'o3', observedAt: 't', serial: 'device-1', width: 100, height: 200,
                coordinateSpace: 'physical-pixels', locked: false, bundleName: 'com.example.app',
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
        const result = await runHarmonyCli(['apps', '--query', 'settings'], depsWith(unlockedDevice()));
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ ok: true, apps: [{ bundleName: 'com.settings' }] });
    });
});
