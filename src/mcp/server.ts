import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HarmonyDeviceError } from '../device/harmony/errors';
import { doctorHarmonyDevices } from '../device/harmony/doctor';
import { discoverHarmonyDevices, HarmonyDeviceSession, HarmonyObservation } from '../device/harmony/session';

export interface HarmonyMcpState {
    session?: HarmonyDeviceSession;
}

export interface HarmonyMcpDependencies {
    doctor(options: { serial?: string }): ReturnType<typeof doctorHarmonyDevices>;
    devices(): ReturnType<typeof discoverHarmonyDevices>;
    connect(options: { serial?: string }): Promise<HarmonyDeviceSession>;
}

const defaultDependencies: HarmonyMcpDependencies = {
    doctor: (options) => doctorHarmonyDevices(options),
    devices: () => discoverHarmonyDevices(),
    connect: (options) => HarmonyDeviceSession.connect(options),
};

export function createHarmonyMcpServer(
    state: HarmonyMcpState = {},
    dependencies: HarmonyMcpDependencies = defaultDependencies,
): McpServer {
    const server = new McpServer({ name: 'haptest-harmonyos', version: '0.2.3' });
    registerHarmonyTools(server, state, dependencies);
    registerScreenPreview(server, state);
    return server;
}

function registerScreenPreview(server: McpServer, state: HarmonyMcpState): void {
    server.registerResource('harmony-screen-preview', 'ui://haptest-harmonyos/screen-preview', {
        description: 'Live HarmonyOS device screen preview with pause and resume controls.',
        mimeType: 'text/html;profile=mcp-app',
        _meta: { ui: { csp: {}, prefersBorder: true } },
    }, async (uri) => ({
        contents: [{
            uri: uri.href,
            mimeType: 'text/html;profile=mcp-app',
            text: screenPreviewHtml,
            _meta: { ui: { csp: {}, prefersBorder: true } },
        }],
    }));

    server.registerTool('screen_preview', {
        title: 'Preview HarmonyOS screen',
        description: 'Start a live preview of the connected HarmonyOS screen. The widget uses the current HapTest session and native frame stream.',
        inputSchema: {},
        _meta: { ui: { resourceUri: 'ui://haptest-harmonyos/screen-preview', visibility: ['model', 'app'] } },
    }, async () => {
        try {
            const extensions = server.server.getClientCapabilities()?.extensions as Record<string, { mimeTypes?: string[] }> | undefined;
            if (!extensions?.['io.modelcontextprotocol/ui']?.mimeTypes?.includes('text/html;profile=mcp-app')) {
                throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'This MCP host did not negotiate MCP Apps UI support; the preview stream was not started.');
            }
            return textResult({ ok: true, ...(await requireSession(state).startPreview()) });
        } catch (error) {
            return errorResult(error);
        }
    });

    const appToolMeta = { ui: { resourceUri: 'ui://haptest-harmonyos/screen-preview', visibility: ['app'] } };
    server.registerTool('screen_preview_frame', {
        description: 'Internal preview frame fetch for the HarmonyOS screen widget.',
        inputSchema: {},
        _meta: appToolMeta,
    }, async () => {
        try {
            const frame = await requireSession(state).getPreviewFrame();
            if (!frame) return textResult({ ok: true, running: false, frameAvailable: false });
            return {
                content: [{ type: 'image' as const, data: frame.data.toString('base64'), mimeType: frame.mimeType }],
                structuredContent: { ok: true, running: true, width: frame.width, height: frame.height },
            };
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('screen_preview_pause', {
        description: 'Pause the HarmonyOS screen widget and stop its native frame stream.',
        inputSchema: {},
        _meta: appToolMeta,
    }, async () => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).pausePreview()) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('screen_preview_resume', {
        description: 'Resume the HarmonyOS screen widget after confirming the device is unlocked.',
        inputSchema: {},
        _meta: appToolMeta,
    }, async () => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).startPreview()) });
        } catch (error) {
            return errorResult(error);
        }
    });
}

export function registerHarmonyTools(server: McpServer, state: HarmonyMcpState, dependencies = defaultDependencies): void {
    server.registerTool('doctor', {
        description: 'Check host HDC availability and list connected and offline HarmonyOS devices.',
        inputSchema: { serial: z.string().min(1).optional() },
    }, async ({ serial }) => {
        try {
            return textResult({ ok: true, ...dependencies.doctor({ serial }) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('devices', {
        description: 'List HarmonyOS devices visible to HDC, including offline devices.',
        inputSchema: {},
    }, async () => {
        try {
            return textResult({ ok: true, devices: dependencies.devices() });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('ready', {
        description: 'Connect to one HarmonyOS device and read its current screen. Select a serial when multiple devices are connected.',
        inputSchema: { serial: z.string().min(1).optional() },
    }, async ({ serial }) => {
        let connectedNow = false;
        try {
            if (!state.session) {
                state.session = await dependencies.connect({ serial });
                connectedNow = true;
            } else if (serial && serial !== state.session.serial) {
                throw new HarmonyDeviceError('DEVICE_BUSY', 'This MCP process already owns a different device session.', {
                    activeSerial: state.session.serial,
                    requestedSerial: serial,
                });
            }
            const observation = await state.session.observe({ screenshot: true });
            return observationResult({ ok: true, connectedNow, observation });
        } catch (error) {
            if (connectedNow && state.session) {
                await state.session.close().catch(() => {});
                state.session = undefined;
            }
            return errorResult(error);
        }
    });

    server.registerTool('observe', {
        description: 'Observe the current UI tree, screenshot, or both. The screenshot is omitted while the device is locked.',
        inputSchema: { mode: z.enum(['tree', 'screenshot', 'both']).default('tree') },
    }, async ({ mode }) => {
        try {
            const observation = await requireSession(state).observe({ screenshot: mode !== 'tree' });
            return observationResult({ ok: true, observation, includeTree: mode !== 'screenshot' });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('tap', {
        description: 'Tap a visible component by selector, or a physical-pixel point from the latest observation.',
        inputSchema: {
            selector: z.object({
                id: z.string().optional(),
                text: z.string().optional(),
                textContains: z.string().optional(),
                hint: z.string().optional(),
                name: z.string().optional(),
                type: z.string().optional(),
                enabled: z.boolean().optional(),
            }).optional(),
            index: z.number().int().nonnegative().optional(),
            x: z.number().optional(),
            y: z.number().optional(),
            observationId: z.string().optional(),
        },
    }, async (args) => {
        try {
            const coordinateTarget = args.x !== undefined || args.y !== undefined;
            if (Boolean(args.selector) === coordinateTarget || (coordinateTarget && (args.x === undefined || args.y === undefined)) ||
                (args.index !== undefined && !args.selector)) {
                throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'Provide one selector or both x/y coordinates; do not mix target forms.');
            }
            return textResult({ ok: true, ...(await requireSession(state).tap(args)) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('find', {
        description: 'Find visible UI elements by text, id, hint, name, type, or enabled state in the latest observation.',
        inputSchema: {
            selector: z.object({
                id: z.string().optional(),
                text: z.string().optional(),
                textContains: z.string().optional(),
                hint: z.string().optional(),
                name: z.string().optional(),
                type: z.string().optional(),
                enabled: z.boolean().optional(),
            }),
        },
    }, async ({ selector }) => {
        try {
            return textResult({ ok: true, candidates: requireSession(state).find(selector) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('swipe', {
        description: 'Swipe between physical-pixel points from the latest observation.',
        inputSchema: {
            fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number(),
            observationId: z.string().min(1), speed: z.number().int().min(200).max(40000).optional(),
        },
    }, async ({ fromX, fromY, toX, toY, observationId, speed }) => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).swipe({
                from: { x: fromX, y: fromY }, to: { x: toX, y: toY }, observationId, speed,
            })) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('double_tap', {
        description: 'Double-tap a physical-pixel point from the latest observation.',
        inputSchema: { x: z.number(), y: z.number(), observationId: z.string().min(1) },
    }, async ({ x, y, observationId }) => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).doubleTap({ x, y }, observationId)) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('long_press', {
        description: 'Long-press a physical-pixel point from the latest observation.',
        inputSchema: { x: z.number(), y: z.number(), observationId: z.string().min(1) },
    }, async ({ x, y, observationId }) => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).longPress({ x, y }, observationId)) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('drag', {
        description: 'Drag between physical-pixel points from the latest observation.',
        inputSchema: {
            fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number(),
            observationId: z.string().min(1), speed: z.number().int().min(200).max(40000).optional(),
        },
    }, async ({ fromX, fromY, toX, toY, observationId, speed }) => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).drag(
                { x: fromX, y: fromY }, { x: toX, y: toY }, observationId, speed,
            )) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('press_key', {
        description: 'Press a supported HarmonyOS system key.',
        inputSchema: { key: z.enum(['BACK', 'HOME', 'ENTER', 'DELETE', 'SPACE', 'TAB', 'ESCAPE', 'UP', 'DOWN', 'LEFT', 'RIGHT']) },
    }, async ({ key }) => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).pressKey(key)) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('press_button', {
        description: 'Press the HarmonyOS Home or volume hardware button.',
        inputSchema: { name: z.enum(['home', 'volumeup', 'volumedown']) },
    }, async ({ name }) => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).pressButton(name)) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('type_text', {
        description: 'Type ordinary non-secret text into the single currently focused editable field. Authentication fields are rejected.',
        inputSchema: { text: z.string().max(20000), allowNewlines: z.boolean().optional(), verify: z.boolean().optional() },
    }, async ({ text, allowNewlines, verify }) => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).typeText(text, { allowNewlines, verify })) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('apps', {
        description: 'List installed HarmonyOS apps with known display-name guesses, or search by bundle name or guessed display name. Guesses come from a small bundle-name map and may be inaccurate; unknown apps keep only their bundle name. Use the exact bundle name with launch_app.',
        inputSchema: { query: z.string().max(200).optional() },
    }, async ({ query }) => {
        try {
            return textResult({ ok: true, apps: requireSession(state).findApps(query) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('launch_app', {
        description: 'Launch an installed app by its exact bundle name. While locked, only the system Settings app may be launched as a wake attempt.',
        inputSchema: { bundleName: z.string().min(1).max(255) },
    }, async ({ bundleName }) => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).launchApp(bundleName)) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('stop_app', {
        description: 'Force-stop an installed app by its exact bundle name.',
        inputSchema: { bundleName: z.string().min(1).max(255) },
    }, async ({ bundleName }) => {
        try {
            return textResult({ ok: true, ...(await requireSession(state).stopApp(bundleName)) });
        } catch (error) {
            return errorResult(error);
        }
    });

    server.registerTool('disconnect', {
        description: 'Close the HarmonyOS session and release its HDC/RPC resources.',
        inputSchema: {},
    }, async () => {
        if (!state.session) return textResult({ ok: true, disconnected: false });
        try {
            await state.session.close();
            state.session = undefined;
            return textResult({ ok: true, disconnected: true });
        } catch (error) {
            state.session = undefined;
            return errorResult(error);
        }
    });
}

const screenPreviewHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:14px system-ui,sans-serif;margin:0;padding:12px;color:#202124;background:#fff}header{display:flex;align-items:center;gap:8px;margin-bottom:10px}button{border:1px solid #bbb;border-radius:6px;background:#f6f6f6;padding:6px 12px;cursor:pointer}button:disabled{opacity:.5;cursor:default}#status{margin-left:auto;color:#666;font-size:12px}#frame{display:block;max-width:100%;max-height:70vh;margin:auto;object-fit:contain;background:#eee}#empty{display:grid;place-items:center;min-height:180px;color:#666}#frame[hidden],#empty[hidden]{display:none}
</style></head><body>
<header><strong>HarmonyOS screen</strong><button id="resume">Resume</button><button id="pause">Pause</button><span id="status">Connecting…</span></header>
<div id="empty">Waiting for the first frame…</div><img id="frame" hidden alt="Live HarmonyOS screen preview">
<script>
(()=>{
let seq=1;const pending=new Map();let alive=true;let timer;let refreshing=false;
const status=document.getElementById('status'),img=document.getElementById('frame'),empty=document.getElementById('empty');
function request(method,params={}){return new Promise((resolve,reject)=>{const id=seq++;pending.set(id,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id,method,params},'*');setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error('Host request timed out'));}},10000);});}
window.addEventListener('message',event=>{const message=event.data;if(!message||message.jsonrpc!=='2.0')return;if(message.method==='ui/resource-teardown'&&message.id!==undefined){alive=false;clearInterval(timer);call('screen_preview_pause').catch(()=>{}).finally(()=>{event.source?.postMessage({jsonrpc:'2.0',id:message.id,result:{}},'*');});return;}const item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(new Error(message.error.message||'Host request failed')):item.resolve(message.result);}});
function content(result){return result&&Array.isArray(result.content)?result.content:[];}
async function call(name){const result=await request('tools/call',{name,arguments:{}});if(result.isError)throw new Error(content(result).find(x=>x.type==='text')?.text||'Tool failed');return result;}
function clearFrame(){img.hidden=true;img.removeAttribute('src');empty.hidden=false;}
function refresh(){if(!alive||refreshing)return;refreshing=true;call('screen_preview_frame').then(result=>{const image=content(result).find(item=>item.type==='image');if(image){img.src='data:'+image.mimeType+';base64,'+image.data;img.hidden=false;empty.hidden=true;status.textContent='Live';}else{clearFrame();status.textContent='Waiting for frame';}}).catch(error=>{clearFrame();status.textContent=error.message||'Preview stopped';clearInterval(timer);}).finally(()=>{refreshing=false;});}
document.getElementById('pause').onclick=async()=>{try{await call('screen_preview_pause');clearInterval(timer);clearFrame();status.textContent='Paused';}catch(error){status.textContent=error.message;}};
document.getElementById('resume').onclick=async()=>{try{await call('screen_preview_resume');status.textContent='Starting…';if(timer)clearInterval(timer);timer=setInterval(refresh,1200);await refresh();}catch(error){status.textContent=error.message;}};
request('ui/initialize',{appInfo:{name:'haptest-harmonyos-screen-preview',version:'0.2.3'},appCapabilities:{availableDisplayModes:['inline','fullscreen']},protocolVersion:'2026-01-26'}).then(()=>{parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');timer=setInterval(refresh,1200);refresh();}).catch(error=>{status.textContent=error.message;});
window.addEventListener('beforeunload',()=>{alive=false;clearInterval(timer);});
})();
</script></body></html>`;

export async function closeHarmonySession(state: HarmonyMcpState): Promise<void> {
    const session = state.session;
    state.session = undefined;
    await session?.close();
}

function requireSession(state: HarmonyMcpState): HarmonyDeviceSession {
    if (!state.session) throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'Call ready and inspect its observation before using device tools.');
    return state.session;
}

function observationResult(options: { ok: true; observation: HarmonyObservation; includeTree?: boolean; connectedNow?: boolean }) {
    const { observation, includeTree = true, connectedNow } = options;
    const summary = {
        ok: options.ok,
        ...(connectedNow === undefined ? {} : { connectedNow }),
        observation: {
            observationId: observation.observationId,
            observedAt: observation.observedAt,
            serial: observation.serial,
            bundleName: observation.bundleName,
            width: observation.width,
            height: observation.height,
            coordinateSpace: observation.coordinateSpace,
            locked: observation.locked,
            ...(includeTree && observation.tree ? { tree: observation.tree.toJson() } : {}),
            ...(observation.screenshot ? {
                screenshot: {
                    mimeType: observation.screenshot.mimeType,
                    width: observation.screenshot.width,
                    height: observation.screenshot.height,
                    pixelToDeviceScale: observation.screenshot.pixelToDeviceScale,
                },
            } : {}),
        },
    };
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: JSON.stringify(summary) },
    ];
    if (observation.screenshot) {
        content.push({
            type: 'image',
            data: observation.screenshot.data.toString('base64'),
            mimeType: observation.screenshot.mimeType,
        });
    }
    return { content };
}

function textResult(value: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
    const domain = error instanceof HarmonyDeviceError ? error : undefined;
    const nextStep = nextStepFor(domain?.code);
    return {
        isError: true,
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                ok: false,
                errorCode: domain?.code ?? 'INTERNAL_ERROR',
                message: domain?.message ?? 'HarmonyOS operation failed.',
                ...(domain?.details ? { details: domain.details } : {}),
                nextStep,
                replayAction: domain?.details?.replayAction === false ? false : undefined,
            }),
        }],
    };
}

function nextStepFor(code?: string): string {
    switch (code) {
        case 'HDC_UNAVAILABLE': return 'Install DevEco Command Line Tools and add hdc to PATH, then call doctor again.';
        case 'NO_DEVICE': return 'Connect and authorize one HarmonyOS device, then call devices.';
        case 'MULTIPLE_DEVICES': return 'Call devices and pass the intended serial to ready.';
        case 'DEVICE_OFFLINE': return 'Reconnect and authorize the requested serial, then call devices.';
        case 'DEVICE_BUSY': return 'Use or disconnect the existing owner; do not start another session for this device.';
        case 'AGENT_DIAGNOSTIC_FAILED': return 'Check device authorization and HDC output, then call doctor again.';
        case 'SELECTOR_NOT_FOUND': return 'Observe the current screen and choose a visible selector.';
        case 'AMBIGUOUS_TARGET': return 'Choose the intended candidate index from the returned summaries.';
        case 'STALE_OBSERVATION': return 'Observe the current screen again and use the new observationId.';
        case 'INPUT_FOCUS_REQUIRED': return 'Tap the intended ordinary editable field, then call type_text.';
        case 'SENSITIVE_FIELD': return 'Enter authentication data directly on the device.';
        case 'ACTION_OUTCOME_UNCERTAIN': return 'Observe the device state before deciding the next action; do not replay this action automatically.';
        case 'ACTION_VERIFICATION_FAILED': return 'Inspect the current field and screen before deciding what to do; do not resend automatically.';
        case 'SESSION_CLOSED': return 'Call ready to create a new device session.';
        case 'CONNECT_FAILED': return 'Call doctor to check HDC, serial selection and uitest agent compatibility before trying ready again.';
        case 'OBSERVE_FAILED': return 'Call ready to restore a read session, then inspect the current screen before acting.';
        case 'APP_NOT_FOUND': return 'Call apps to find an installed bundle name, then use that exact name.';
        case 'APP_QUERY_FAILED': return 'Check device connection and call doctor before querying apps again.';
        default: return 'Inspect the error details, then observe the device before another state-changing action.';
    }
}
