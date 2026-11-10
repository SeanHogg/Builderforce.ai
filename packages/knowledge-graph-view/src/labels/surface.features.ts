/** The words of the Key features camera: the five feature groups and their empty states. */

import type { FeatureGroup } from '../surface/features/keyFeatures';

export interface KeyFeaturesLabels {
    keyFeatures: {
        title: string;
        description: string;
        groups: Record<FeatureGroup, string>;
        /** Shown in place of a group that found nothing. */
        empty: Record<FeatureGroup, string>;
    };
}

export const KEY_FEATURES_DEFAULTS: KeyFeaturesLabels = {
    keyFeatures: {
        title: 'Key features',
        description: 'Read from the code alone: the capabilities, the API, the entry points, the patterns in use and the parts everything depends on.',
        groups: {
            capabilities: 'Capabilities', endpoints: 'API endpoints', entryPoints: 'Entry points',
            patterns: 'Patterns in use', core: 'Most depended on',
        },
        empty: {
            capabilities: 'No areas or folders were found.',
            endpoints: 'No file registers a route.',
            entryPoints: 'No file is in the entry layer.',
            patterns: 'No design pattern was recognised.',
            core: 'No file is referenced by another.',
        },
    },
};
