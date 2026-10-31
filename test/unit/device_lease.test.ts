import fs from 'fs';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireDeviceLease } from '../../src/device/harmony/lease';

const roots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-lease-test-'));
    roots.push(root);
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Harmony device lease', () => {
    it('allows one owner and releases the serial for another process', () => {
        const root = makeRoot();
        const first = acquireDeviceLease('serial-A', root);
        expect(() => acquireDeviceLease('serial-A', root)).toThrowError(/already has an active/);
        first.release();
        const next = acquireDeviceLease('serial-A', root);
        next.release();
    });

    it('prevents an independent Node process from taking an owned serial', () => {
        const root = makeRoot();
        const lease = acquireDeviceLease('serial-C', root);
        const modulePath = path.resolve('src/device/harmony/lease.ts');
        const compilerPath = require.resolve('typescript', { paths: [require.resolve('bjc')] });
        const script = `const fs = require('fs'); const ts = require(${JSON.stringify(compilerPath)}); require.extensions['.ts'] = (module, filename) => module._compile(ts.transpile(fs.readFileSync(filename, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }), filename); const { acquireDeviceLease } = require(${JSON.stringify(modulePath)}); try { acquireDeviceLease('serial-C', ${JSON.stringify(root)}); process.exit(2); } catch (error) { if (error.code !== 'DEVICE_BUSY') process.stderr.write(String(error.stack || error)); process.exit(error.code === 'DEVICE_BUSY' ? 0 : 1); }`;
        const result = spawnSync(process.execPath, ['-e', script], {
            cwd: process.cwd(),
            encoding: 'utf-8',
            timeout: 10000,
        });
        lease.release();
        expect(result.status, result.stderr || result.stdout).toBe(0);
    });

    it('reclaims a lease whose recorded owner process no longer exists', () => {
        const root = makeRoot();
        const digest = crypto.createHash('sha256').update('serial-B').digest('hex');
        const lock = path.join(root, `haptest-device-${digest}.lock`);
        fs.mkdirSync(lock);
        fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647, token: 'stale' }));
        const lease = acquireDeviceLease('serial-B', root);
        lease.release();
        expect(fs.readdirSync(root)).toEqual([]);
    });
});
