import { Component } from '../../model/component';
import { Page } from '../../model/page';
import { HarmonyDeviceError } from './errors';

export interface HarmonySelector {
    id?: string;
    text?: string;
    textContains?: string;
    hint?: string;
    name?: string;
    type?: string;
    enabled?: boolean;
}

export interface HarmonyCandidate {
    index: number;
    id?: string;
    text?: string;
    hint?: string;
    name?: string;
    type?: string;
    bounds?: Component['bounds'];
    center: { x: number; y: number };
}

export function findHarmonyComponents(page: Page, selector: HarmonySelector): Component[] {
    if (!Object.values(selector).some((value) => value !== undefined)) {
        throw new HarmonyDeviceError('ACTION_PRECONDITION_FAILED', 'A selector must include at least one match field.');
    }
    return page.getComponents().filter((component) => {
        if (component.visible === false) return false;
        return Object.entries(selector).every(([key, value]) => {
            if (value === undefined) return true;
            if ((key === 'text' || key === 'textContains') && component.inputable) return false;
            if (key === 'textContains') return component.text?.includes(String(value)) ?? false;
            return component[key as keyof Component] === value;
        });
    });
}

export function summarizeHarmonyCandidates(components: Component[]): HarmonyCandidate[] {
    return components.map((component, index) => ({
        index,
        id: component.id,
        text: component.inputable ? undefined : component.text,
        hint: component.hint,
        name: component.name,
        type: component.type,
        bounds: component.bounds,
        center: component.getCenterPoint(),
    }));
}
