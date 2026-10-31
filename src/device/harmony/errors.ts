export type HarmonyDeviceErrorCode =
    | 'HDC_UNAVAILABLE'
    | 'NO_DEVICE'
    | 'MULTIPLE_DEVICES'
    | 'DEVICE_OFFLINE'
    | 'DEVICE_BUSY'
    | 'SESSION_CLOSED'
    | 'CONNECT_FAILED'
    | 'OBSERVE_FAILED'
    | 'ACTION_PRECONDITION_FAILED'
    | 'SELECTOR_NOT_FOUND'
    | 'SELECTOR_INDEX_OUT_OF_RANGE'
    | 'AMBIGUOUS_TARGET'
    | 'STALE_OBSERVATION'
    | 'INPUT_FOCUS_REQUIRED'
    | 'SENSITIVE_FIELD'
    | 'ACTION_OUTCOME_UNCERTAIN'
    | 'ACTION_VERIFICATION_FAILED'
    | 'APP_NOT_FOUND'
    | 'APP_QUERY_FAILED'
    | 'AGENT_DIAGNOSTIC_FAILED';

export class HarmonyDeviceError extends Error {
    readonly cause?: unknown;

    constructor(
        readonly code: HarmonyDeviceErrorCode,
        message: string,
        readonly details?: Record<string, unknown>,
        cause?: unknown,
    ) {
        super(message);
        this.name = 'HarmonyDeviceError';
        this.cause = cause;
    }
}
