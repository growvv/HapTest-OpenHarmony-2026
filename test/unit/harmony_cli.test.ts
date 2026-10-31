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
    const device = {
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

    it('turns a bare HDC failure on devices into the install guidance', async () => {
        const result = await runHarmonyCli(['devices'], {
            ...hdcMissing,
            devices: () => { throw new Error('/bin/sh: hdc: command not found'); },
        });
        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain('DevEco');
        expect(JSON.parse(result.stdout).errorCode).toBe('HDC_UNAVAILABLE');
    });

    it('lists devices without connecting', async () => {
        const result = await runHarmonyCli(['devices'], { ...hdcMissing, devices: () => [{ serial: 'device-1' } as never] });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, devices: [{ serial: 'device-1' }] });
    });

    it('reports a locked device without a tree, then closes the session', async () => {
        const device = {
            serial: 'device-1',
            observe: async () => ({
                observationId: 'o1', observedAt: 't', serial: 'device-1', width: 100, height: 200,
                coordinateSpace: 'physical-pixels', locked: true,
            }),
            findApps: () => [],
            close: async () => {},
        };
        const result = await runHarmonyCli(['observe'], depsWith(device));
        expect(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.observation.locked).toBe(true);
        expect(parsed.observation.tree).toBeUndefined();
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
        expect(device.calls).toEqual(['observe', 'tap', 'observe', 'close']);
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
        expect(device.calls).toEqual(['observe', 'close']);
        expect(JSON.parse(result.stdout).errorCode).toBe('STALE_OBSERVATION');
    });

    it('exits 2 when a tap has no target form', async () => {
        const result = await runHarmonyCli(['tap'], depsWith(actionDevice()));
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain('usage');
    });

    it('exits 2 when the selector index is out of range', async () => {
        const device = actionDevice({
            tap: async () => {
                throw new HarmonyDeviceError('SELECTOR_INDEX_OUT_OF_RANGE', 'The selector candidate index is out of range.', { candidateCount: 2 });
            },
        });
        const result = await runHarmonyCli(['tap', '--text', 'OK', '--index', '5'], depsWith(device));
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain('usage');
    });

    it('rejects an unknown flag instead of silently ignoring it', async () => {
        const result = await runHarmonyCli(['observe', '--screenshott', 'out.png'], depsWith(actionDevice()));
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain('unknown flag: --screenshott');
    });

    it('rejects extra positional arguments instead of dropping them', async () => {
        const device = actionDevice();
        const result = await runHarmonyCli(['type', 'hello', 'world'], depsWith(device));
        expect(result.exitCode).toBe(2);
        expect(device.calls).toEqual([]);
    });

    it('observes before pressing a key and reports the resulting observation', async () => {
        const device = actionDevice();
        const result = await runHarmonyCli(['key', 'BACK'], depsWith(device));
        expect(result.exitCode).toBe(0);
        expect(device.calls).toEqual(['observe', 'pressKey', 'observe', 'close']);
        expect(JSON.parse(result.stdout).observation.observationId).toBe('o2');
    });

    it('reports the observation after type, launch and stop', async () => {
        for (const [command, name] of [['type', 'typeText'], ['launch', 'launchApp'], ['stop', 'stopApp']] as const) {
            const device = actionDevice();
            const result = await runHarmonyCli([command, command === 'type' ? 'hello' : 'com.a.b'], depsWith(device));
            expect(result.exitCode).toBe(0);
            expect(device.calls).toEqual(['observe', name, 'observe', 'close']);
            expect(JSON.parse(result.stdout).observation.observationId).toBe('o2');
        }
    });

    it('reports a not-ready doctor with ok:false and exit 3', async () => {
        const result = await runHarmonyCli(['doctor'], {
            ...hdcMissing,
            doctor: () => ({ hdcVersion: '3.2.0c', devices: [], issues: ['No connected HarmonyOS device is available.'] }),
        });
        expect(result.exitCode).toBe(3);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, errorCode: 'DEVICE_NOT_READY' });
    });
});
