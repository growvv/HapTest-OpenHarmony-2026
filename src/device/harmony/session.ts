import fs from 'fs';
import os from 'os';
import path from 'path';
import { Device } from '../device';
import { Hdc, HdcTargetInfo } from '../hdc';
import { Page } from '../../model/page';
import { Component } from '../../model/component';
import { Hap } from '../../model/hap';
import { KeyCode } from '../../model/key_code';
import { HarmonyDeviceError } from './errors';
import { DeviceLease, acquireDeviceLease } from './lease';
import { findHarmonyComponents, HarmonyCandidate, HarmonySelector, summarizeHarmonyCandidates } from './selectors';

export type HarmonyDeviceStatus = HdcTargetInfo;

export interface HarmonyObservation {
    observationId: string;
    observedAt: string;
    serial: string;
    width: number;
    height: number;
    coordinateSpace: 'physical-pixels';
    bundleName?: string;
    locked: boolean;
    tree?: Page;
    screenshot?: {
        mimeType: 'image/png' | 'image/jpeg';
        data: Buffer;
        width: number;
        height: number;
        pixelToDeviceScale: number;
    };
}

interface SessionDevice {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getWidth(): number;
    getHeight(): number;
    dumpViewTree(dismissKeyboard?: boolean): Promise<Page>;
    getHdc(): Hdc;
    getLiveDisplaySize(): Promise<{ x: number; y: number }>;
    click(point: { x: number; y: number }): Promise<void>;
    doubleClick(point: { x: number; y: number }): Promise<void>;
    longClick(point: { x: number; y: number }): Promise<void>;
    swipe(from: { x: number; y: number }, to: { x: number; y: number }, speed?: number): Promise<void>;
    drag(from: { x: number; y: number }, to: { x: number; y: number }, speed?: number): Promise<void>;
    inputKey(key: KeyCode): Promise<void>;
    getAllBundleNames(): string[];
    getBundleInfo(bundleName: string): Record<string, unknown> | undefined;
    getHapInTarget(bundleName: string): Hap | undefined;
    startAblity(bundleName: string, abilityName: string): boolean;
    forceStop(bundleName: string): void;
}

export interface HarmonySessionDependencies {
    listTargets(): HdcTargetInfo[];
    createDevice(serial: string, output: string): SessionDevice;
    makeTempDir(): string;
    now(): Date;
    makeObservationId(): string;
    acquireLease?(serial: string): DeviceLease;
}

const defaults: HarmonySessionDependencies = {
    listTargets: () => Hdc.listTargets(),
    createDevice: (serial, output) => new Device({ connectkey: serial, output }),
    makeTempDir: () => fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-harmony-')),
    now: () => new Date(),
    makeObservationId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    acquireLease: (serial) => acquireDeviceLease(serial),
};

const AUTH_FIELD = /(pass(word|wd|code|phrase)?|pin|otp|one.?time|2fa|mfa|captcha|verification|verify|security.?code|token|credential|auth|密码|口令|验证码|认证)/i;
const LOCKED_DEVICE_SETTINGS_BUNDLE = 'com.huawei.hmos.settings';
const KEY_CODES: Record<string, KeyCode> = {
    BACK: KeyCode.KEYCODE_BACK,
    HOME: KeyCode.KEYCODE_HOME,
    ENTER: KeyCode.KEYCODE_ENTER,
    DELETE: KeyCode.KEYCODE_DEL,
    SPACE: KeyCode.KEYCODE_SPACE,
    TAB: KeyCode.KEYCODE_TAB,
    ESCAPE: KeyCode.KEYCODE_ESCAPE,
    UP: KeyCode.KEYCODE_DPAD_UP,
    DOWN: KeyCode.KEYCODE_DPAD_DOWN,
    LEFT: KeyCode.KEYCODE_DPAD_LEFT,
    RIGHT: KeyCode.KEYCODE_DPAD_RIGHT,
};
const BUTTON_CODES = {
    home: KeyCode.KEYCODE_HOME,
    volumeup: KeyCode.KEYCODE_VOLUME_UP,
    volumedown: KeyCode.KEYCODE_VOLUME_DOWN,
} as const;

export function discoverHarmonyDevices(
    dependencies: Pick<HarmonySessionDependencies, 'listTargets'> = defaults,
): HarmonyDeviceStatus[] {
    try {
        return dependencies.listTargets();
    } catch (error) {
        throw new HarmonyDeviceError('HDC_UNAVAILABLE', 'HDC could not enumerate HarmonyOS devices.', undefined, error);
    }
}

export class HarmonyDevice {
    private closed = false;
    private closing?: Promise<void>;
    private actionTail: Promise<void> = Promise.resolve();
    private latestObservation?: HarmonyObservation;
    private latestTree?: Page;

    private constructor(
        readonly serial: string,
        private readonly device: SessionDevice,
        private readonly tempDir: string,
        private readonly dependencies: HarmonySessionDependencies,
        private readonly lease: DeviceLease,
    ) {}

    static async connect(
        options: { serial?: string } = {},
        dependencies: HarmonySessionDependencies = defaults,
    ): Promise<HarmonyDevice> {
        let targets: HdcTargetInfo[];
        try {
            targets = dependencies.listTargets();
        } catch (error) {
            throw new HarmonyDeviceError('HDC_UNAVAILABLE', 'HDC could not enumerate HarmonyOS devices.', undefined, error);
        }

        const connected = targets.filter((target) => target.state.toLowerCase() === 'connected');
        if (!options.serial && connected.length === 0) {
            throw new HarmonyDeviceError('NO_DEVICE', 'No connected HarmonyOS device is available.', { targets });
        }
        if (!options.serial && connected.length > 1) {
            throw new HarmonyDeviceError('MULTIPLE_DEVICES', 'Choose a device serial when multiple devices are connected.', {
                devices: connected,
            });
        }

        const serial = options.serial ?? connected[0].serial;
        const selected = targets.find((target) => target.serial === serial);
        if (!selected || selected.state.toLowerCase() !== 'connected') {
            throw new HarmonyDeviceError('DEVICE_OFFLINE', `HarmonyOS device ${serial} is not connected.`, {
                serial,
                state: selected?.state ?? 'not-found',
            });
        }
        let lease: DeviceLease | undefined;
        let tempDir: string | undefined;
        let device: SessionDevice | undefined;
        try {
            lease = dependencies.acquireLease?.(serial);
            tempDir = dependencies.makeTempDir();
            device = dependencies.createDevice(serial, tempDir);
            await device.connect();
            return new HarmonyDevice(serial, device, tempDir, dependencies, lease ?? { release: () => {} });
        } catch (error) {
            lease?.release();
            if (device) {
                try {
                    await device.disconnect();
                } catch {}
            }
            if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
            if (error instanceof HarmonyDeviceError) throw error;
            throw new HarmonyDeviceError('CONNECT_FAILED', `Could not connect to HarmonyOS device ${serial}.`, { serial }, error);
        }
    }

    observe(options: { screenshot?: boolean } = {}): Promise<HarmonyObservation> {
        return this.serialize(async () => {
            this.ensureOpen();
            try {
                const tree = await this.device.dumpViewTree(false);
                const size = await this.device.getLiveDisplaySize();
                let locked = isLockScreen(tree);
                const observation: HarmonyObservation = {
                    observationId: this.dependencies.makeObservationId(),
                    observedAt: this.dependencies.now().toISOString(),
                    serial: this.serial,
                    width: size.x,
                    height: size.y,
                    bundleName: tree.getBundleName(),
                    coordinateSpace: 'physical-pixels',
                    locked,
                    ...(!locked ? { tree } : {}),
                };

                if (options.screenshot && !locked) {
                    const beforeCapture = await this.device.dumpViewTree(false);
                    if (isLockScreen(beforeCapture)) {
                        locked = true;
                        observation.locked = true;
                        delete observation.tree;
                    }
                    const filePath = locked ? undefined : this.device.getHdc().capScreen(this.tempDir);
                    let data: Buffer | undefined;
                    try {
                        if (filePath) {
                            data = fs.readFileSync(filePath);
                            const afterCapture = await this.device.dumpViewTree(false);
                            if (isLockScreen(afterCapture)) {
                                locked = true;
                                observation.locked = true;
                                delete observation.tree;
                            } else {
                                const dimensions = screenshotDimensions(data);
                                const scaleX = size.x / dimensions.width;
                                const scaleY = size.y / dimensions.height;
                                if (Math.abs(scaleX - scaleY) > 0.01) throw new Error('Screenshot aspect ratio does not match the physical display.');
                                observation.screenshot = {
                                    mimeType: screenshotMimeType(data),
                                    data,
                                    width: dimensions.width,
                                    height: dimensions.height,
                                    pixelToDeviceScale: scaleX,
                                };
                            }
                        }
                    } finally {
                        if (filePath) fs.rmSync(filePath, { force: true });
                    }
                }
                this.latestObservation = observation;
                this.latestTree = locked ? undefined : tree;
                return observation;
            } catch (error) {
                if (error instanceof HarmonyDeviceError) throw error;
                throw new HarmonyDeviceError('OBSERVE_FAILED', `Could not observe HarmonyOS device ${this.serial}.`, {
                    serial: this.serial,
                }, error);
            }
        });
    }

    find(selector: HarmonySelector): HarmonyCandidate[] {
        this.ensureOpen();
        this.requireObservation();
        return summarizeHarmonyCandidates(findHarmonyComponents(this.latestTree!, selector));
    }

    tap(options: { selector?: HarmonySelector; index?: number; x?: number; y?: number; observationId?: string }): Promise<{ outcome: 'completed'; target?: HarmonyCandidate }> {
        return this.serialize(async () => {
            this.ensureOpen();
            const observation = this.requireObservation();
            let point: { x: number; y: number };
            let candidate: HarmonyCandidate | undefined;
            if (options.selector) {
                const page = await this.refreshTree(observation);
                const matches = findHarmonyComponents(page, options.selector);
                if (matches.length === 0) throw new HarmonyDeviceError('SELECTOR_NOT_FOUND', 'No visible component matches the selector.');
                const containedMatch = resolveContainedMatch(matches);
                if (options.index === undefined && matches.length > 1 && !containedMatch) {
                    throw new HarmonyDeviceError('AMBIGUOUS_TARGET', 'The selector matches multiple components; choose a candidate index.', {
                        candidates: summarizeHarmonyCandidates(matches),
                    });
                }
                const index = options.index ?? matches.indexOf(containedMatch!);
                if (!Number.isInteger(index) || index < 0 || index >= matches.length) {
                    throw new HarmonyDeviceError('SELECTOR_INDEX_OUT_OF_RANGE', 'The selector candidate index is out of range.', {
                        candidateCount: matches.length,
                    });
                }
                const selected = matches[index];
                if (!selected.bounds || selected.bounds.length < 2) {
                    throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'The selected component has no usable tap bounds.');
                }
                point = selected.getCenterPoint();
                candidate = { ...summarizeHarmonyCandidates([selected])[0], index };
            } else {
                this.checkCoordinates(options.x, options.y, options.observationId, observation);
                point = { x: options.x!, y: options.y! };
                await this.validateCoordinateObservation(observation);
            }
            validatePoint(point, observation.width, observation.height);
            await this.mutate(() => this.device.click(point));
            return { outcome: 'completed', target: candidate };
        });
    }

    swipe(options: {
        from: { x: number; y: number };
        to: { x: number; y: number };
        observationId: string;
        speed?: number;
    }): Promise<{ outcome: 'completed' }> {
        return this.serialize(async () => {
            this.ensureOpen();
            const observation = this.requireObservation();
            this.checkCoordinates(options.from.x, options.from.y, options.observationId, observation);
            validateSpeed(options.speed ?? 600);
            validatePoint(options.from, observation.width, observation.height);
            validatePoint(options.to, observation.width, observation.height);
            await this.validateCoordinateObservation(observation);
            await this.mutate(() => this.device.swipe(options.from, options.to, options.speed ?? 600));
            return { outcome: 'completed' };
        });
    }

    doubleTap(point: { x: number; y: number }, observationId: string): Promise<{ outcome: 'completed' }> {
        return this.performPointAction(point, observationId, (target) => this.device.doubleClick(target));
    }

    longPress(point: { x: number; y: number }, observationId: string): Promise<{ outcome: 'completed' }> {
        return this.performPointAction(point, observationId, (target) => this.device.longClick(target));
    }

    drag(from: { x: number; y: number }, to: { x: number; y: number }, observationId: string, speed = 600): Promise<{ outcome: 'completed' }> {
        return this.serialize(async () => {
            this.ensureOpen();
            const observation = this.requireObservation();
            this.checkCoordinates(from.x, from.y, observationId, observation);
            validateSpeed(speed);
            validatePoint(from, observation.width, observation.height);
            validatePoint(to, observation.width, observation.height);
            await this.validateCoordinateObservation(observation);
            await this.mutate(() => this.device.drag(from, to, speed));
            return { outcome: 'completed' };
        });
    }

    pressKey(key: keyof typeof KEY_CODES): Promise<{ outcome: 'completed' }> {
        return this.serialize(async () => {
            this.ensureOpen();
            this.requireObservation();
            const keyCode = KEY_CODES[key];
            if (keyCode === undefined) throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', `Unsupported key: ${key}.`);
            await this.mutate(() => this.device.inputKey(keyCode));
            return { outcome: 'completed' };
        });
    }

    pressButton(name: keyof typeof BUTTON_CODES): Promise<{ outcome: 'completed' }> {
        return this.serialize(async () => {
            this.ensureOpen();
            this.requireObservation();
            await this.mutate(() => this.device.inputKey(BUTTON_CODES[name]));
            return { outcome: 'completed' };
        });
    }

    typeText(text: string, options: { allowNewlines?: boolean } = {}): Promise<{ outcome: 'completed' }> {
        return this.serialize(async () => {
            this.ensureOpen();
            this.requireObservation();
            if (text.length > 20000 || (!options.allowNewlines && /[\r\n]/.test(text)) || /\u0000/.test(text)) {
                throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'Text exceeds the supported length or contains disallowed control characters.');
            }
            const page = await this.device.dumpViewTree(false);
            this.assertUnlocked(page);
            if (page.getBundleName() !== this.latestObservation?.bundleName) {
                throw new HarmonyDeviceError('STALE_OBSERVATION', 'The foreground app changed after the observation.');
            }
            const focused = page.getComponents().filter((component) =>
                component.focused && component.inputable && component.visible !== false && component.enabled !== false,
            );
            if (focused.length !== 1) {
                throw new HarmonyDeviceError('INPUT_FOCUS_REQUIRED', 'Text input requires exactly one focused editable field.');
            }
            if (isSensitiveField(focused[0])) {
                throw new HarmonyDeviceError('SENSITIVE_FIELD', 'Authentication fields must be completed directly on the device.');
            }
            await this.mutate(() => this.device.getHdc().inputFocusedText(text));
            return { outcome: 'completed' };
        });
    }

    findApps(query = ''): Array<{ bundleName: string }> {
        this.ensureOpen();
        const needle = query.trim().toLocaleLowerCase();
        try {
            return this.device.getAllBundleNames()
                .filter((bundleName) => !needle || bundleName.toLocaleLowerCase().includes(needle))
                .map((bundleName) => ({ bundleName }));
        } catch (error) {
            throw new HarmonyDeviceError('APP_QUERY_FAILED', `Could not query installed apps on ${this.serial}.`, { serial: this.serial }, error);
        }
    }

    launchApp(bundleName: string): Promise<{ outcome: 'completed' }> {
        return this.serialize(async () => {
            this.ensureOpen();
            // The replication guide allows a single system Settings launch as a lock-screen wake attempt.
            this.requireObservation(bundleName === LOCKED_DEVICE_SETTINGS_BUNDLE);
            if (!/^[A-Za-z0-9._]+$/.test(bundleName) || !this.device.getAllBundleNames().includes(bundleName)) {
                throw new HarmonyDeviceError('APP_NOT_FOUND', `No installed app matches bundle ${bundleName}.`, { bundleName });
            }
            let app: Hap | undefined;
            try {
                app = this.device.getHapInTarget(bundleName);
            } catch {
                throw new HarmonyDeviceError('APP_NOT_FOUND', `No launchable app matches bundle ${bundleName}.`, { bundleName });
            }
            if (!app?.bundleName || !app.mainAbility) {
                throw new HarmonyDeviceError('APP_NOT_FOUND', `No launchable app matches bundle ${bundleName}.`, { bundleName });
            }
            await this.mutate(() => this.device.startAblity(app.bundleName, app.mainAbility));
            return { outcome: 'completed' };
        });
    }

    stopApp(bundleName: string): Promise<{ outcome: 'completed' }> {
        return this.serialize(async () => {
            this.ensureOpen();
            this.requireObservation();
            if (!this.device.getAllBundleNames().includes(bundleName)) {
                throw new HarmonyDeviceError('APP_NOT_FOUND', `No installed app matches bundle ${bundleName}.`, { bundleName });
            }
            await this.mutate(() => this.device.forceStop(bundleName));
            return { outcome: 'completed' };
        });
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        if (this.closed) return Promise.resolve();
        this.closing = this.closeOnce();
        return this.closing;
    }

    private async closeOnce(): Promise<void> {
        this.closed = true;
        try {
            await this.actionTail;
            await this.device.disconnect();
        } finally {
            try {
                this.lease.release();
            } finally {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
        }
    }

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.actionTail.then(operation);
        this.actionTail = result.then(() => undefined, () => undefined);
        return result;
    }

    private requireObservation(allowLockedSettingsLaunch = false): HarmonyObservation {
        if (!this.latestObservation || (this.latestObservation.locked && !allowLockedSettingsLaunch) ||
            (!this.latestObservation.locked && !this.latestTree)) {
            throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'Observe an unlocked screen before acting.');
        }
        return this.latestObservation;
    }

    private checkCoordinates(x: number | undefined, y: number | undefined, observationId: string | undefined, current: HarmonyObservation): void {
        if (!Number.isFinite(x) || !Number.isFinite(y) || observationId !== current.observationId) {
            throw new HarmonyDeviceError('STALE_OBSERVATION', 'Coordinate actions require a point from the latest observation.', {
                latestObservationId: current.observationId,
            });
        }
    }

    private async validateCoordinateObservation(observation: HarmonyObservation): Promise<void> {
        const size = await this.device.getLiveDisplaySize();
        if (size.x !== observation.width || size.y !== observation.height) {
            throw new HarmonyDeviceError('STALE_OBSERVATION', 'The display size changed after the coordinate observation.', {
                observed: [observation.width, observation.height],
                current: [size.x, size.y],
            });
        }
        const current = await this.device.dumpViewTree(false);
        this.assertUnlocked(current);
        if (current.getBundleName() !== observation.bundleName || current.getContentSig() !== this.latestTree?.getContentSig()) {
            throw new HarmonyDeviceError('STALE_OBSERVATION', 'The foreground page changed after the coordinate observation.');
        }
    }

    private performPointAction(
        point: { x: number; y: number },
        observationId: string,
        action: (point: { x: number; y: number }) => Promise<void>,
    ): Promise<{ outcome: 'completed' }> {
        return this.serialize(async () => {
            this.ensureOpen();
            const observation = this.requireObservation();
            this.checkCoordinates(point.x, point.y, observationId, observation);
            validatePoint(point, observation.width, observation.height);
            await this.validateCoordinateObservation(observation);
            await this.mutate(() => action(point));
            return { outcome: 'completed' };
        });
    }

    private async refreshTree(observation: HarmonyObservation): Promise<Page> {
        const size = await this.device.getLiveDisplaySize();
        if (size.x !== observation.width || size.y !== observation.height) {
            throw new HarmonyDeviceError('STALE_OBSERVATION', 'The display size changed after the observation.', {
                observed: [observation.width, observation.height],
                current: [size.x, size.y],
            });
        }
        const page = await this.device.dumpViewTree(false);
        this.assertUnlocked(page);
        if (page.getBundleName() !== observation.bundleName) {
            throw new HarmonyDeviceError('STALE_OBSERVATION', 'The foreground app changed after the observation.');
        }
        return page;
    }

    private async mutate(operation: () => Promise<unknown> | unknown): Promise<void> {
        this.latestObservation = undefined;
        this.latestTree = undefined;
        try {
            await operation();
        } catch (error) {
            throw new HarmonyDeviceError('ACTION_OUTCOME_UNCERTAIN', 'The device may have performed this action. Observe the current screen before deciding what to do; HapTest will not replay it.', {
                serial: this.serial,
                replayAction: false,
                outcome: 'unknown',
            }, error);
        }
    }

    private assertUnlocked(page: Page): void {
        if (isLockScreen(page)) throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'The device is locked; unlock it directly on the device before acting.');
    }

    private ensureOpen(): void {
        if (this.closed) {
            throw new HarmonyDeviceError('SESSION_CLOSED', `HarmonyOS device session ${this.serial} is closed.`, { serial: this.serial });
        }
    }
}

function validatePoint(point: { x: number; y: number }, width: number, height: number): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
        throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'The point is outside the current physical display bounds.', {
            point,
            width,
            height,
        });
    }
}

function validateSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed < 200 || speed > 40000) {
        throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'Gesture speed must be between 200 and 40000.', { speed });
    }
}

function isSensitiveField(component: Component): boolean {
    return [component.id, component.name, component.hint].some((value) => typeof value === 'string' && AUTH_FIELD.test(value));
}

function resolveContainedMatch(matches: Component[]): Component | undefined {
    if (matches.length < 2) return matches[0];
    for (let left = 0; left < matches.length; left++) {
        for (let right = left + 1; right < matches.length; right++) {
            if (!isAncestor(matches[left], matches[right]) && !isAncestor(matches[right], matches[left]) &&
                !strictlyContains(matches[left], matches[right]) && !strictlyContains(matches[right], matches[left])) {
                return undefined;
            }
        }
    }
    return matches.reduce((best, current) => {
        if (isAncestor(best, current)) return current;
        if (isAncestor(current, best)) return best;
        return area(current) < area(best) ? current : best;
    });
}

function isAncestor(parent: Component, child: Component): boolean {
    for (let current = child.parent; current; current = current.parent) {
        if (current === parent) return true;
    }
    return false;
}

function strictlyContains(outer: Component, inner: Component): boolean {
    if (!outer.bounds || !inner.bounds || outer.bounds.length < 2 || inner.bounds.length < 2) return false;
    const [a, b] = outer.bounds;
    const [c, d] = inner.bounds;
    return a.x <= c.x && a.y <= c.y && b.x >= d.x && b.y >= d.y && area(outer) > area(inner);
}

function area(component: Component): number {
    return component.getWidth() * component.getHeight();
}

function isLockScreen(page: Page): boolean {
    return page.getComponents().some((component) =>
        component.id === 'ScreenLockRootComponent' || component.id === 'MainPageView_Screen_Lock_Home',
    );
}

function screenshotMimeType(data: Buffer): 'image/png' | 'image/jpeg' {
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return 'image/png';
    }
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
    throw new Error('HDC returned an unrecognized screenshot format.');
}

function screenshotDimensions(data: Buffer): { width: number; height: number } {
    if (screenshotMimeType(data) === 'image/png' && data.length >= 24) {
        const dimensions = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
        if (dimensions.width > 0 && dimensions.height > 0) return dimensions;
        throw new Error('HDC returned a screenshot with invalid dimensions.');
    }
    let offset = 2;
    while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) break;
        const marker = data[offset + 1];
        offset += 2;
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const length = data.readUInt16BE(offset);
        if (length < 2 || offset + length > data.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
            const dimensions = { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
            if (dimensions.width > 0 && dimensions.height > 0) return dimensions;
            throw new Error('HDC returned a screenshot with invalid dimensions.');
        }
        offset += length;
    }
    throw new Error('HDC returned a screenshot without readable dimensions.');
}
