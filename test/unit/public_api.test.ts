import { describe, expect, it } from 'vitest';
import * as api from '../../src';

describe('public API', () => {
    it('exports the HarmonyOS device facade', () => {
        expect(typeof api.HarmonyDevice.connect).toBe('function');
        expect(typeof api.HarmonyDeviceError).toBe('function');
        expect(typeof api.doctorHarmonyDevices).toBe('function');
        expect(typeof api.discoverHarmonyDevices).toBe('function');
    });
});
