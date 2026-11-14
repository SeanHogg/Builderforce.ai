export const REALIZATION_DELIVERY_KEYS = [
    'demo-video',
    'clickable-prototype',
    'smoke-test',
    'wizard-of-oz',
    'poc',
    'pilot',
    'phone-line',
    'live-system',
];
const WEBSITE_PUBLISH = {
    canvasKind: 'website',
    deliveryAction: 'publish',
    outcomeAction: 'artifact.publish',
};
export const REALIZATION_CANVAS_DELIVERY = {
    'demo-video': WEBSITE_PUBLISH,
    'clickable-prototype': WEBSITE_PUBLISH,
    'smoke-test': WEBSITE_PUBLISH,
    'wizard-of-oz': WEBSITE_PUBLISH,
    'poc': WEBSITE_PUBLISH,
    'pilot': WEBSITE_PUBLISH,
    'phone-line': WEBSITE_PUBLISH,
    'live-system': WEBSITE_PUBLISH,
};
export function realizationCanvasDelivery(key) {
    return REALIZATION_CANVAS_DELIVERY[key] ?? null;
}
/**
 * A complete WYSIWYG website from a realization plan — the object
 * `canvas_realize` lands so `website.publish` has something real to ship.
 *
 * Must pass `authoredWebsiteProblem`: an authored hero (heading, body, cta)
 * plus at least one further section. Empty criteria still produce a features
 * section so the canvas never accepts a titled shell.
 */
export function realizationWebsiteFromPlan(input) {
    const heading = input.title.trim().slice(0, 240) || 'Idea to real';
    const body = input.summary.trim().slice(0, 2000) || 'A proof of the idea, ready to publish.';
    const criteria = input.successCriteria.map((criterion) => criterion.trim()).filter(Boolean).slice(0, 8);
    const items = (criteria.length ? criteria : ['A person can open this page and say what the idea does.']).map((criterion) => ({
        title: criterion.slice(0, 80),
        body: criterion.slice(0, 600),
    }));
    const pages = [{
            id: 'home',
            name: 'Home',
            path: '/',
            sections: [
                {
                    id: 'hero-1',
                    kind: 'hero',
                    eyebrow: 'Idea to real',
                    heading,
                    body,
                    cta: 'Review the plan',
                },
                {
                    id: 'features-1',
                    kind: 'features',
                    heading: 'Success looks like',
                    items,
                },
                {
                    id: 'cta-1',
                    kind: 'cta',
                    heading: 'Make it real',
                    body: (input.nextStep ?? 'Publish this site, or open the build wizard to go live.').slice(0, 2000),
                    cta: 'Publish',
                },
            ],
        }];
    return { pages, websiteTheme: { style: 'editorial' } };
}
//# sourceMappingURL=realizationDelivery.js.map