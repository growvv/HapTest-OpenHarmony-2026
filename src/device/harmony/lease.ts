import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarmonyDeviceError } from './errors';

interface LeaseOwner {
    pid: number;
    token: string;
}

export interface DeviceLease {
    release(): void;
}

export function acquireDeviceLease(serial: string, root = os.tmpdir()): DeviceLease {
    const name = crypto.createHash('sha256').update(serial).digest('hex');
    const lockPath = path.join(root, `haptest-device-${name}.lock`);
    const ownerPath = path.join(lockPath, 'owner.json');
    const token = crypto.randomBytes(16).toString('hex');

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.mkdirSync(lockPath, { mode: 0o700 });
            try {
                fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token } satisfies LeaseOwner), {
                    flag: 'wx',
                    mode: 0o600,
                });
            } catch (error) {
                fs.rmSync(lockPath, { recursive: true, force: true });
                throw error;
            }
            return {
                release: () => {
                    try {
                        const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as LeaseOwner;
                        if (owner.pid === process.pid && owner.token === token) {
                            fs.rmSync(lockPath, { recursive: true, force: true });
                        }
                    } catch {
                        // The lease may already have been reclaimed after process termination.
                    }
                },
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            if (attempt === 0 && reclaimDeadLease(lockPath, ownerPath)) continue;
            throw new HarmonyDeviceError('DEVICE_BUSY', `HarmonyOS device ${serial} already has an active HapTest owner.`, {
                serial,
                lockPath,
            });
        }
    }
    throw new HarmonyDeviceError('DEVICE_BUSY', `HarmonyOS device ${serial} is already owned.`, { serial });
}

function reclaimDeadLease(lockPath: string, ownerPath: string): boolean {
    let initialStat: fs.Stats;
    try {
        initialStat = fs.statSync(lockPath);
    } catch {
        return true;
    }

    let owner: LeaseOwner | undefined;
    try {
        owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as LeaseOwner;
    } catch {
        if (Date.now() - initialStat.mtimeMs < 5000) return false;
    }

    if (owner && isProcessAlive(owner.pid)) return false;
    try {
        const currentStat = fs.statSync(lockPath);
        if (currentStat.dev !== initialStat.dev || currentStat.ino !== initialStat.ino) return false;
        const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
        fs.renameSync(lockPath, stalePath);
        fs.rmSync(stalePath, { recursive: true, force: true });
        return true;
    } catch {
        return false;
    }
}

function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}
