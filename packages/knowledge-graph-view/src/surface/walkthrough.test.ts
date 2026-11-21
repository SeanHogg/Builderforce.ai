/** The plain-language sentence for each step of a journey: doors, hallways and rooms. */
import { describe, expect, it } from 'vitest';
import { ACT_DEFAULTS } from '../labels/surface.act';
import type { PathModel } from './path';
import { walkthroughSentence, walkthroughStory } from './walkthrough';

const w = ACT_DEFAULTS.walk;

const path: PathModel = {
    stops: [
        { id: 'a', name: 'Login' },
        { id: 'b', name: 'Accounts' },
        { id: 'c', name: 'Save' },
    ],
    hops: [
        { kind: 'references', count: 2 },
        { kind: 'references', count: 0 },
    ],
};

describe('walkthroughSentence', () => {
    it('asks for a journey when there is no path', () => {
        expect(walkthroughSentence(null, 0, w)).toBe(w.empty);
        expect(walkthroughSentence({ stops: [], hops: [] }, 3, w)).toBe(w.empty);
    });

    it('names a lone stop as a room with no hallway', () => {
        expect(walkthroughSentence({ stops: [{ id: 'a', name: 'Accounts' }], hops: [] }, 0, w))
            .toBe('You are in the room Accounts. There is no hallway yet.');
    });

    it('starts a journey at the entry door', () => {
        expect(walkthroughSentence(path, 0, w)).toBe('Start at the door Login, where this journey begins.');
    });

    it('walks the hallway into a room, and says how many calls that hallway is', () => {
        expect(walkthroughSentence(path, 1, w))
            .toBe('Walk the hallway from Login to Accounts (2 calls). You are in the room Accounts.');
    });

    it('says there is no hallway when nothing calls across, and leaves through the endpoint door', () => {
        expect(walkthroughSentence(path, 2, w))
            .toBe('There is no hallway from Accounts to Save. Leave through the door Save.');
    });

    it('uses the one-call wording for a single call', () => {
        const one: PathModel = {
            stops: [{ id: 'a', name: 'Login' }, { id: 'b', name: 'Accounts' }],
            hops: [{ kind: 'references', count: 1 }],
        };
        expect(walkthroughSentence(one, 1, w))
            .toBe('Walk the hallway from Login to Accounts (one call). Leave through the door Accounts.');
    });

    it('clamps a step that falls outside the journey', () => {
        expect(walkthroughSentence(path, -4, w)).toBe(walkthroughSentence(path, 0, w));
        expect(walkthroughSentence(path, 9, w)).toBe(walkthroughSentence(path, 2, w));
        expect(walkthroughSentence(path, Number.NaN, w)).toBe(walkthroughSentence(path, 0, w));
    });

    it('joins every step into the story, doors first and last', () => {
        const story = walkthroughStory(path, w);
        expect(story).toBe([0, 1, 2].map((i) => walkthroughSentence(path, i, w)).join(' '));
        expect(story.startsWith('Start at the door Login')).toBe(true);
        expect(story.endsWith('Leave through the door Save.')).toBe(true);
    });

    it('fills a host override instead of the English default', () => {
        const custom = { ...w, doorIn: 'Enter {name}.' };
        expect(walkthroughSentence(path, 0, custom)).toBe('Enter Login.');
    });
});
