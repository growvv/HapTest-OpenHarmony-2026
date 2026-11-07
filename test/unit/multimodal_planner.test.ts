import { describe, expect, it } from 'vitest';
import http from 'http';
import { Component } from '../../src/model/component';
import { Page } from '../../src/model/page';
import { ViewTree } from '../../src/model/viewtree';
import { HarmonyDevice, HarmonyObservation } from '../../src/device/harmony/session';
import { createVisionQuery, parsePlanDecision, planningCandidates, runMultimodalTask } from '../../src/policy/multimodal_planner';

function observation(id = 'o1'): HarmonyObservation {
    const root = new Component();
    const button = new Component();
    Object.assign(button, { clickable: true, enabled: true, visible: true, text: '设置', bounds: [{ x: 10, y: 20 }, { x: 30, y: 40 }] });
    const hidden = new Component();
    Object.assign(hidden, { clickable: true, visible: false, bounds: [{ x: 50, y: 50 }, { x: 80, y: 80 }] });
    root.addChild(button); root.addChild(hidden);
    return { observationId: id, observedAt: '', serial: 'test', width: 100, height: 200, locked: false, coordinateSpace: 'physical-pixels',
        bundleName: 'com.demo', tree: new Page(new ViewTree(root), '', 'com.demo', ''),
        screenshot: { data: Buffer.from('fixture'), mimeType: 'image/png', width: 100, height: 200, pixelToDeviceScale: 1 } };
}

describe('multimodal planner', () => {
    it('sends image bytes and grounded UI candidates over the actual HTTP transport', async () => {
        let received: any;
        const server = http.createServer(async (request, response) => {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            received = JSON.parse(Buffer.concat(chunks).toString());
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ choices: [{ message: { content: '{"actionId":1,"done":false,"reason":"设置入口"}' } }] }));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const port = (server.address() as { port: number }).port;
            const current = observation();
            const candidates = planningCandidates(current);
            const query = createVisionQuery({ model: 'fixture-vision', apiKey: 'fixture-only', baseURL: `http://127.0.0.1:${port}/v1` });
            const decision = parsePlanDecision(await query({ task: '打开设置', observation: current, candidates, history: [] }), candidates);
            expect(decision.actionId).toBe(1);
            const parts = received.messages[1].content;
            expect(parts[1].image_url.url).toBe('data:image/png;base64,' + Buffer.from('fixture').toString('base64'));
            expect(JSON.parse(parts[0].text).candidates[0]).toMatchObject({ label: '设置', x: 20, y: 30 });
        } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    });
    it('grounds candidates in visible controls and rejects invalid model actions', () => {
        const candidates = planningCandidates(observation());
        expect(candidates.filter(item => item.action === 'tap')).toEqual([{ id: 1, action: 'tap', label: '设置', x: 20, y: 30 }]);
        for (const actionId of [0, -1, 999, 1.5, '1']) {
            expect(() => parsePlanDecision(JSON.stringify({ done: false, actionId, reason: 'test' }), candidates)).toThrow('outside');
        }
        expect(() => parsePlanDecision('{"done":true,"actionId":1,"reason":"ok"}', candidates)).toThrow('null');
        expect(() => planningCandidates({ ...observation(), locked: true })).toThrow('unlocked');
    });
    it('previews without mutating and observes again after every executed action', async () => {
        let observed = 0;
        let fresh = false;
        let taps = 0;
        const device = {
            observe: async () => { fresh = true; return observation(`o${++observed}`); },
            tap: async ({ observationId }: { observationId: string }) => {
                if (!fresh || observationId !== `o${observed}`) throw new Error('stale');
                fresh = false; taps++;
            },
        } as unknown as HarmonyDevice;
        const query = async () => '{"done":false,"actionId":1,"reason":"进入设置"}';
        const preview = await runMultimodalTask(device, { task: '进入设置', query });
        expect(preview.status).toBe('preview'); expect(taps).toBe(0);
        const execution = await runMultimodalTask(device, { task: '进入设置', query, execute: true, maxSteps: 2 });
        expect(execution.steps.map(step => step.observationId)).toEqual(['o2', 'o3']);
        expect(taps).toBe(2);
    });
    it('stops on uncertain action and never replays it', async () => {
        let taps = 0;
        const device = { observe: async () => observation(), tap: async () => { taps++; throw new Error('ACTION_OUTCOME_UNCERTAIN'); } } as unknown as HarmonyDevice;
        await expect(runMultimodalTask(device, { task: '设置', execute: true, maxSteps: 5,
            query: async () => '{"done":false,"actionId":1,"reason":"click"}' })).rejects.toThrow('UNCERTAIN');
        expect(taps).toBe(1);
    });
});
