import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Page } from '../../src/model/page';
import { Component } from '../../src/model/component';
import { Hap } from '../../src/model/hap';
import { HdcTargetInfo } from '../../src/device/hdc';
import { HarmonyDeviceError } from '../../src/device/harmony/errors';
import { HarmonyDevice, HarmonySessionDependencies } from '../../src/device/harmony/session';
import { KeyCode } from '../../src/model/key_code';

const online: HdcTargetInfo = { serial: 'device-1', transport: 'USB', state: 'Connected', host: 'localhost', type: 'hdc' };
const offline: HdcTargetInfo = { ...online, serial: 'device-2', state: 'Offline' };

function makePage(locked = false, components: Component[] = []): Page {
    const root = new Component();
    root.id = locked ? 'ScreenLockRootComponent' : 'root';
    return {
        getComponents: () => [root, ...components],
        getBundleName: () => locked ? 'com.ohos.sceneboard' : 'com.example.app',
        getContentSig: () => locked ? 'lock' : 'page',
    } as unknown as Page;
}

function makePng(): Buffer {
    const image = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
    image.writeUInt32BE(100, 16);
    image.writeUInt32BE(200, 20);
    return image;
}

function setup(
    targets: HdcTargetInfo[] = [online],
    locked = false,
    pages?: Page[],
    clickFails = false,
    apps: { bundleNames: string[]; info?: Record<string, Record<string, unknown>> } = { bundleNames: [] },
) {
    const disconnect = vi.fn(async () => {});
    const connect = vi.fn(async () => {});
    let pageIndex = 0;
    const dumpViewTree = vi.fn(async () => {
        const page = pages?.[Math.min(pageIndex++, pages.length - 1)];
        return page ?? makePage(locked);
    });
    const click = vi.fn(async () => { if (clickFails) throw new Error('RPC timed out'); });
    const inputFocusedText = vi.fn(() => {});
    const settingsApp = new Hap();
    settingsApp.bundleName = 'com.huawei.hmos.settings';
    settingsApp.mainAbility = 'Settings';
    const startAbility = vi.fn(() => true);
    const getBundleInfo = vi.fn((bundleName: string) => apps.info?.[bundleName]);
    const temporaryDirs: string[] = [];
    const heldLeases = new Set<string>();
    const dependencies: HarmonySessionDependencies = {
        acquireLease: (serial) => {
            if (heldLeases.has(serial)) {
                throw new HarmonyDeviceError('DEVICE_BUSY', `HarmonyOS device ${serial} already has an active HapTest owner.`, { serial });
            }
            heldLeases.add(serial);
            return { release: () => { heldLeases.delete(serial); } };
        },
        listTargets: () => targets,
        createDevice: (_serial, output) => ({
            connect,
            disconnect,
            getWidth: () => 100,
            getHeight: () => 200,
            dumpViewTree,
            getLiveDisplaySize: async () => ({ x: 100, y: 200 }),
            click,
            doubleClick: async () => {},
            longClick: async () => {},
            swipe: async () => {},
            drag: async () => {},
            inputKey: async (_key: KeyCode) => {},
            getAllBundleNames: () => apps.bundleNames,
            getBundleInfo,
            getHapInTarget: (bundleName: string) => bundleName === settingsApp.bundleName ? settingsApp : undefined,
            startAblity: startAbility,
            forceStop: () => {},
            getHdc: () => ({
                inputFocusedText,
                capScreen: (folder: string) => {
                    const screenshot = path.join(folder, 'screen.png');
                    fs.writeFileSync(screenshot, makePng());
                    return screenshot;
                },
            } as never),
        }),
        makeTempDir: () => {
            const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-session-test-'));
            temporaryDirs.push(folder);
            return folder;
        },
        now: () => new Date('2026-10-17T00:00:00.000Z'),
        makeObservationId: () => 'observation-1',
    };
    return { dependencies, connect, disconnect, dumpViewTree, click, inputFocusedText, getBundleInfo, startAbility, temporaryDirs };
}

// Sessions claim a module-level serial, so one that is not closed leaks the
// serial and makes every later test in this file fail with DEVICE_BUSY.
// Closing in `afterEach` keeps a genuine assertion failure readable.
const openSessions: Array<{ close(): Promise<void> }> = [];

async function connectSession(
    options: { serial?: string },
    dependencies: HarmonySessionDependencies,
): Promise<HarmonyDevice> {
    const session = await HarmonyDevice.connect(options, dependencies);
    openSessions.push(session);
    return session;
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const session of openSessions.splice(0)) await session.close();
});

describe('HarmonyDevice', () => {
    it('returns domain errors for absent, ambiguous, offline and unavailable HDC targets', async () => {
        await expect(HarmonyDevice.connect({}, setup([]).dependencies)).rejects.toMatchObject({ code: 'NO_DEVICE' });
        await expect(HarmonyDevice.connect({}, setup([online, { ...online, serial: 'device-2' }]).dependencies))
            .rejects.toMatchObject({ code: 'MULTIPLE_DEVICES' });
        await expect(HarmonyDevice.connect({ serial: offline.serial }, setup([offline]).dependencies))
            .rejects.toMatchObject({ code: 'DEVICE_OFFLINE' });
        const failed = setup();
        failed.dependencies.listTargets = () => { throw new Error('missing hdc'); };
        await expect(HarmonyDevice.connect({}, failed.dependencies)).rejects.toMatchObject({ code: 'HDC_UNAVAILABLE' });
    });

    it('connects explicitly, observes tree and screenshot, and cleans up on close', async () => {
        const fake = setup();
        const session = await connectSession({ serial: online.serial }, fake.dependencies);
        const observation = await session.observe({ screenshot: true });

        expect(fake.connect).toHaveBeenCalledOnce();
        expect(fake.dumpViewTree).toHaveBeenCalledWith(false);
        expect(observation).toMatchObject({
            serial: online.serial,
            width: 100,
            height: 200,
            coordinateSpace: 'physical-pixels',
            observationId: 'observation-1',
            locked: false,
            screenshot: { mimeType: 'image/png', width: 100, height: 200, pixelToDeviceScale: 1 },
        });
        expect(observation.tree).toBeDefined();
        expect(observation.screenshot?.data.length).toBeGreaterThan(0);

        await session.close();
        await session.close();
        expect(fake.disconnect).toHaveBeenCalledOnce();
        expect(fs.existsSync(fake.temporaryDirs[0])).toBe(false);
        await expect(session.observe()).rejects.toBeInstanceOf(HarmonyDeviceError);
    });

    it('suppresses tree and screenshot on the lock screen', async () => {
        const fake = setup([online], true);
        const session = await connectSession({ serial: online.serial }, fake.dependencies);
        const observation = await session.observe({ screenshot: true });

        expect(observation.locked).toBe(true);
        expect(observation.tree).toBeUndefined();
        expect(observation.screenshot).toBeUndefined();
        await session.close();
    });

    it('allows only the system Settings launch as a locked-device wake attempt', async () => {
        const fake = setup([online], true, undefined, false, { bundleNames: ['com.huawei.hmos.settings'] });
        const session = await connectSession({ serial: online.serial }, fake.dependencies);
        await session.observe();

        await expect(session.launchApp('com.example.app')).rejects.toMatchObject({ code: 'ACTION_PRECONDITION_FAILED' });
        await expect(session.launchApp('com.huawei.hmos.settings')).resolves.toEqual({ outcome: 'completed' });
        expect(fake.startAbility).toHaveBeenCalledWith('com.huawei.hmos.settings', 'Settings');
        await session.close();
    });

    it('returns bundle names only and never guesses a localized label', async () => {
        const fake = setup([online], false, undefined, false, {
            bundleNames: ['com.huawei.hmos.settings', 'com.taobao.taobao4hmos'],
            info: {
                'com.huawei.hmos.settings': {
                    applicationInfo: { name: '设置' },
                    versionName: '1.0',
                },
            },
        });
        const session = await connectSession({ serial: online.serial }, fake.dependencies);

        expect(session.findApps()).toEqual([
            { bundleName: 'com.huawei.hmos.settings' },
            { bundleName: 'com.taobao.taobao4hmos' },
        ]);
        // A localized query cannot match anything we did not read from the device.
        expect(session.findApps('淘宝')).toEqual([]);
        expect(session.findApps('settings')).toEqual([{ bundleName: 'com.huawei.hmos.settings' }]);
        expect(session.findApps('nonexistent')).toEqual([]);
        expect(fake.getBundleInfo).not.toHaveBeenCalled();
        await session.close();
    });

    it('discards a screenshot when the device locks during capture', async () => {
        const pages = [makePage(), makePage(), makePage(true)];
        const fake = setup([online], false, pages);
        const session = await connectSession({ serial: online.serial }, fake.dependencies);
        const observation = await session.observe({ screenshot: true });

        expect(observation.locked).toBe(true);
        expect(observation.tree).toBeUndefined();
        expect(observation.screenshot).toBeUndefined();
        await session.close();
    });

    it('rejects a second owner and releases the serial after a failed connection', async () => {
        const first = setup();
        const session = await connectSession({ serial: online.serial }, first.dependencies);
        await expect(HarmonyDevice.connect({ serial: online.serial }, first.dependencies))
            .rejects.toMatchObject({ code: 'DEVICE_BUSY' });
        await session.close();

        const failed = setup();
        failed.dependencies.createDevice = () => ({
            ...({} as never),
            connect: async () => { throw new Error('RPC failed'); },
            disconnect: vi.fn(async () => {}),
        });
        await expect(HarmonyDevice.connect({ serial: online.serial }, failed.dependencies))
            .rejects.toMatchObject({ code: 'CONNECT_FAILED' });
        const retry = setup();
        const retrySession = await connectSession({ serial: online.serial }, retry.dependencies);
        await retrySession.close();
    });

    it('rejects stale coordinate actions and resolves a uniquely selected component', async () => {
        const component = new Component();
        component.text = 'Continue';
        component.type = 'Button';
        component.visible = true;
        component.enabled = true;
        component.clickable = true;
        component.bounds = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
        const page = makePage(false, [component]);
        const fake = setup([online], false, [page, page, page]);
        const session = await connectSession({ serial: online.serial }, fake.dependencies);
        const observation = await session.observe();

        await expect(session.tap({ x: 15, y: 25, observationId: 'old' })).rejects.toMatchObject({ code: 'STALE_OBSERVATION' });
        expect(fake.click).not.toHaveBeenCalled();
        await expect(session.tap({ selector: { text: 'Continue' } })).resolves.toMatchObject({ outcome: 'completed' });
        expect(fake.click).toHaveBeenCalledWith({ x: 20, y: 30 });
        expect(observation.observationId).toBe('observation-1');
        await session.close();
    });

    it('requires one confirmed ordinary text focus and rejects authentication fields', async () => {
        const ordinary = new Component();
        ordinary.type = 'TextInput';
        ordinary.focused = true;
        ordinary.visible = true;
        ordinary.hint = 'Search';
        const ordinaryPage = makePage(false, [ordinary]);
        ordinary.text = '';
        const typed = new Component();
        typed.type = 'TextInput';
        typed.focused = true;
        typed.visible = true;
        typed.hint = 'Search';
        typed.text = 'hello';
        const typedPage = makePage(false, [typed]);
        const fake = setup([online], false, [ordinaryPage, ordinaryPage, typedPage]);
        const session = await connectSession({ serial: online.serial }, fake.dependencies);
        await session.observe();
        await expect(session.typeText('hello')).resolves.toEqual({ outcome: 'completed' });
        expect(fake.inputFocusedText).toHaveBeenCalledWith('hello');
        await session.close();

        const secret = new Component();
        secret.type = 'TextInput';
        secret.focused = true;
        secret.hint = 'Password';
        const secretPage = makePage(false, [secret]);
        const secretFake = setup([online], false, [secretPage]);
        const secretSession = await connectSession({ serial: online.serial }, secretFake.dependencies);
        await secretSession.observe();
        await expect(secretSession.typeText('do-not-type')).rejects.toMatchObject({ code: 'SENSITIVE_FIELD' });
        expect(secretFake.inputFocusedText).not.toHaveBeenCalled();
        await secretSession.close();
    });

    it('returns candidates for ambiguous selectors and never replays an uncertain action', async () => {
        const first = new Component();
        first.text = 'Open';
        first.visible = true;
        first.bounds = [{ x: 1, y: 1 }, { x: 11, y: 11 }];
        const second = new Component();
        second.text = 'Open';
        second.visible = true;
        second.bounds = [{ x: 20, y: 20 }, { x: 30, y: 30 }];
        const page = makePage(false, [first, second]);
        const ambiguous = setup([online], false, [page, page]);
        const session = await connectSession({ serial: online.serial }, ambiguous.dependencies);
        await session.observe();
        await expect(session.tap({ selector: { text: 'Open' } })).rejects.toMatchObject({
            code: 'AMBIGUOUS_TARGET',
            details: { candidates: [{ index: 0 }, { index: 1 }] },
        });
        expect(ambiguous.click).not.toHaveBeenCalled();
        await session.close();

        const uncertain = setup([online], false, [page, page], true);
        const uncertainSession = await connectSession({ serial: online.serial }, uncertain.dependencies);
        const observation = await uncertainSession.observe();
        await expect(uncertainSession.tap({ x: 5, y: 5, observationId: observation.observationId })).rejects.toMatchObject({
            code: 'ACTION_OUTCOME_UNCERTAIN',
            details: { replayAction: false, outcome: 'unknown' },
        });
        expect(uncertain.click).toHaveBeenCalledOnce();
        await uncertainSession.observe();
        expect(uncertain.click).toHaveBeenCalledOnce();
        await uncertainSession.close();
    });
});
