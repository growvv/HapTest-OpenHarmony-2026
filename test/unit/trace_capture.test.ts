import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { captureTrace, TraceCaptureDependencies } from '../../src/device/perf/trace_capture';

describe('trace capture lifecycle', () => {
    it('finishes and preserves the trace after an uncertain action without replaying it', async () => {
        const output = fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-capture-'));
        let tracing = false;
        let actionCount = 0;
        let removed = '';
        const deps: TraceCaptureDependencies = {
            hdc: async (_serial, args) => {
                if (args.includes('--trace_begin')) tracing = true;
                if (args.includes('--trace_finish')) tracing = false;
                if (args[0] === 'file') fs.writeFileSync(args[3], 'captured fixture');
                if (args[1] === 'rm') removed = args[3];
            },
            convert: async () => { throw new Error('must not convert an uncertain action'); },
        };
        try {
            await expect(captureTrace('serial', output, async () => {
                if (!tracing) throw new Error('trace missing');
                actionCount++;
                throw new Error('ACTION_OUTCOME_UNCERTAIN');
            }, {}, deps)).rejects.toThrow('UNCERTAIN');
            expect(actionCount).toBe(1); expect(tracing).toBe(false);
            const metadata = JSON.parse(fs.readFileSync(path.join(output, 'capture.json'), 'utf8'));
            expect(metadata).toMatchObject({ actionOutcome: 'uncertain_or_failed', captureOutcome: 'completed' });
            expect(fs.readFileSync(metadata.trace, 'utf8')).toBe('captured fixture');
            expect(removed).toMatch(/^\/data\/local\/tmp\/haptest-\d+-[a-f0-9]+\.htrace$/);
        } finally { fs.rmSync(output, { recursive: true, force: true }); }
    });
    it('reports capture failure and rejects an invalid budget before executing an action', async () => {
        const output = fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-capture-fail-'));
        let actions = 0;
        const deps: TraceCaptureDependencies = {
            hdc: async (_serial, args) => { if (args.includes('--trace_finish')) throw new Error('permission denied'); },
            convert: async () => { throw new Error('unused'); },
        };
        try {
            await expect(captureTrace('serial', output, async () => { actions++; }, { refreshRate: 0 }, deps)).rejects.toThrow('refreshRate');
            expect(actions).toBe(0);
            await expect(captureTrace('serial', output, async () => { actions++; }, {}, deps)).rejects.toThrow('permission denied');
            expect(actions).toBe(1);
            expect(JSON.parse(fs.readFileSync(path.join(output, 'capture.json'), 'utf8'))).toMatchObject({ actionOutcome: 'completed', captureOutcome: 'failed' });
        } finally { fs.rmSync(output, { recursive: true, force: true }); }
    });
});
