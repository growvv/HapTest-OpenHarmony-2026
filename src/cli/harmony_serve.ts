import readline from 'readline';
import { HarmonyDeviceError } from '../device/harmony/errors';
import { HarmonyDevice } from '../device/harmony/session';
import { HarmonyCliDeps, summarizeObservation } from './harmony_command';

export interface HarmonyServeOptions {
    serial?: string;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}

interface Request {
    id?: unknown;
    method?: unknown;
    params?: Record<string, unknown>;
}

const defaultDeps: Pick<HarmonyCliDeps, 'connect'> = {
    connect: (options) => HarmonyDevice.connect(options),
};

function errorBody(error: unknown): { code: string; message: string } {
    if (error instanceof HarmonyDeviceError) return { code: error.code, message: error.message };
    return { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
}

export async function runHarmonyServe(
    options: HarmonyServeOptions = {},
    deps: Pick<HarmonyCliDeps, 'connect'> = defaultDeps,
): Promise<void> {
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const device = await deps.connect({ serial: options.serial });
    const reader = readline.createInterface({ input, crlfDelay: Infinity });
    let closed = false;
    let chain: Promise<void> = Promise.resolve();

    const write = (body: unknown): void => {
        output.write(`${JSON.stringify(body)}\n`);
    };

    const handle = async (line: string): Promise<void> => {
        if (closed) return;
        let request: Request;
        try {
            request = JSON.parse(line) as Request;
        } catch {
            write({ id: null, ok: false, error: { code: 'BAD_REQUEST', message: 'line is not valid JSON' } });
            return;
        }
        const id = request?.id ?? null;
        const method = typeof request?.method === 'string' ? request.method : undefined;
        if (!method) {
            write({ id, ok: false, error: { code: 'BAD_REQUEST', message: 'method is required' } });
            return;
        }
        const params = request?.params ?? {};
        if (method === 'close') {
            write({ id, ok: true, result: { closed: true } });
            closed = true;
            reader.close();
            await device.close();
            return;
        }
        const call = METHODS[method];
        if (!call) {
            write({ id, ok: false, error: { code: 'UNKNOWN_METHOD', message: `unknown method: ${method}` } });
            return;
        }
        try {
            write({ id, ok: true, result: await call(device, params) });
        } catch (error) {
            write({ id, ok: false, error: errorBody(error) });
        }
    };

    const METHODS: Record<string, (device: HarmonyDevice, params: Record<string, unknown>) => Promise<unknown>> = {
        observe: async (session, params) => summarizeObservation(await session.observe({ screenshot: Boolean(params.screenshot) })),
        find: async (session, params) => session.find(params.selector as never),
        tap: async (session, params) => session.tap(params as never),
        swipe: async (session, params) => session.swipe(params as never),
        type_text: async (session, params) => session.typeText(String(params.text ?? ''), { allowNewlines: Boolean(params.allowNewlines) }),
        press_key: async (session, params) => session.pressKey(params.key as never),
        apps: async (session, params) => session.findApps(String(params.query ?? '')),
        launch_app: async (session, params) => session.launchApp(String(params.bundleName ?? '')),
        stop_app: async (session, params) => session.stopApp(String(params.bundleName ?? '')),
    };

    reader.on('line', (line) => {
        chain = chain.then(() => handle(line));
    });
    await new Promise<void>((resolve) => reader.once('close', resolve));
    await chain;
    if (!closed) await device.close();
}
