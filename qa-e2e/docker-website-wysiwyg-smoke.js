import { chromium } from 'playwright';

const origin = 'http://localhost:3000';
const followUp = 'Use Home, About, Services, and Contact. This is a conversion-focused website for Acme Analytics. Headline: Turn operational data into confident decisions. CTA: Book a demo.';
const initialPages = [{
  id: 'home', name: 'Home', path: '/', sections: [
    { id: 'hero', kind: 'hero', eyebrow: 'Independent studio', heading: 'Ideas become useful digital experiences', body: 'A responsive, content-first website shaped around your goals and audience.', cta: 'Start a project' },
    { id: 'features', kind: 'features', heading: 'Designed for clarity', body: 'Strategy, design, and delivery in one focused engagement.', items: [{ title: 'Intentional systems', body: 'Every component supports the story.' }, { title: 'Responsive by default', body: 'The experience adapts cleanly to every viewport.' }, { title: 'Ready to publish', body: 'Complete content and navigation, not a placeholder.' }] },
    { id: 'cta', kind: 'cta', heading: 'Make the next idea real', body: 'Bring the brief. Leave with a website.', cta: 'Start a project' },
  ],
}];

const acmePages = ['Home', 'About', 'Services', 'Contact'].map((name, index) => ({
  id: name.toLowerCase(), name, path: index === 0 ? '/' : `/${name.toLowerCase()}`,
  sections: [
    { id: `${name.toLowerCase()}-hero`, kind: 'hero', eyebrow: 'Acme Analytics', heading: index === 0 ? 'Turn operational data into confident decisions' : `${name} — Acme Analytics`, body: `${name} content designed for operators who need clear, actionable answers from complex data.`, cta: 'Book a demo' },
    { id: `${name.toLowerCase()}-content`, kind: index === 2 ? 'features' : 'content', heading: index === 2 ? 'Analytics services built for action' : `A clearer path through ${name.toLowerCase()}`, body: 'Connect teams, metrics, and decisions through a focused analytics operating layer.', items: index === 2 ? [{ title: 'Operational dashboards', body: 'See performance without spreadsheet archaeology.' }, { title: 'Decision workflows', body: 'Turn signals into consistent action.' }] : undefined },
    { id: `${name.toLowerCase()}-cta`, kind: 'cta', heading: 'See what confident decisions feel like', body: 'Talk with an Acme Analytics specialist.', cta: 'Book a demo' },
  ],
}));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function dismissIfVisible(locator, timeout = 5000) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();
    return true;
  } catch {
    return false;
  }
}

async function snapshot(page) {
  return page.evaluate(() => {
    const id = location.pathname.split('/').filter(Boolean).at(-1);
    const raw = id ? localStorage.getItem(`builderforce:create:${id}`) : null;
    return raw ? JSON.parse(raw) : null;
  });
}

async function waitForBrain(page, minimumTimeline) {
  await page.waitForFunction((minimum) => {
    const id = location.pathname.split('/').filter(Boolean).at(-1);
    const raw = id ? localStorage.getItem(`builderforce:create:${id}`) : null;
    if (!raw) return false;
    const saved = JSON.parse(raw);
    const chat = saved.nodes?.find((node) => node.data?.kind === 'chat');
    return saved.timeline?.length >= minimum && chat?.data?.brainRunning !== true;
  }, minimumTimeline, { timeout: 180000, polling: 1500 });
  await page.waitForTimeout(1500);
  return snapshot(page);
}

function authoredWebsite(saved) {
  const websites = saved.nodes.filter((node) => ['website', 'prototype'].includes(node.data?.kind));
  assert(websites.length === 1, `Expected one website/prototype, received ${websites.length}. Nodes: ${saved.nodes.map((node) => `${node.data?.kind}:${node.data?.title}`).join(', ')}. Timeline: ${saved.timeline?.map((message) => `${message.role}:${message.body}`).join(' | ')}`);
  const website = websites[0];
  assert(Array.isArray(website.data.pages) && website.data.pages.length > 0, 'Website has no authored pages.');
  for (const page of website.data.pages) {
    assert(Array.isArray(page.sections) && page.sections.length >= 2, `Page ${page.name || page.id} is not a complete WYSIWYG page.`);
    const hero = page.sections.find((section) => section.kind === 'hero');
    assert(hero?.heading && hero?.body && hero?.cta, `Page ${page.name || page.id} has no complete hero.`);
  }
  assert(website.data.websiteTheme && typeof website.data.websiteTheme === 'object', 'Website has no authored theme.');
  return website;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = [];
  let completionCount = 0;
  let mockWebsiteId = '';
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('requestfailed', (request) => console.log('REQUEST_FAILED', request.method(), request.url(), request.failure()?.errorText));
  page.on('response', (response) => {
    if (response.url().includes(':8787') || response.status() >= 400) console.log('RESPONSE', response.status(), response.request().method(), response.url());
  });

  await page.route('**/llm/v1/chat/completions', async (route) => {
    completionCount += 1;
    let delta;
    let finishReason = 'stop';
    if (completionCount === 1) {
      finishReason = 'tool_calls';
      delta = { tool_calls: [{ index: 0, id: 'add-website', function: { name: 'canvas_add_object', arguments: JSON.stringify({ kind: 'website', title: 'Northstar Digital Studio', fields: { pages: initialPages, websiteTheme: { style: 'editorial', accent: '#d55f3f', background: '#f6f0e7', foreground: '#18211f' } } }) } }] };
    } else if (completionCount === 3) {
      finishReason = 'tool_calls';
      delta = { tool_calls: [{ index: 0, id: 'update-website', function: { name: 'canvas_update_object', arguments: JSON.stringify({ objectId: mockWebsiteId, fields: { title: 'Acme Analytics', pages: acmePages, websiteTheme: { style: 'technical', accent: '#24c8a5', background: '#081713', foreground: '#edfdf8' } } }) } }] };
    } else {
      delta = { content: completionCount === 2 ? 'I created a responsive, authored website with real page sections and its own visual direction.' : 'I updated the selected website with the four requested Acme Analytics pages, headline, and CTA.' };
    }
    const chunk = { id: `mock-${completionCount}`, model: 'docker-wysiwyg-smoke', choices: [{ index: 0, delta, finish_reason: finishReason }] };
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'x-builderforce-model': 'docker-wysiwyg-smoke' },
      body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
    });
  });

  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await dismissIfVisible(page.getByRole('button', { name: /necessary only/i }), 7000);

    await page.getByRole('button', { name: 'Choose a starting point' }).click();
    await page.getByRole('button', { name: 'Website', exact: true }).click();
    const landingPrompt = page.getByRole('textbox', { name: /describe what you want to create/i });
    assert((await landingPrompt.inputValue()).includes('responsive website'), 'Website use case did not populate the composer.');
    await page.getByRole('button', { name: 'Start creating', exact: true }).click();
    await page.waitForURL(/\/create\/local-/, { timeout: 30000 });

    const tourDialog = page.getByRole('dialog').filter({ hasText: 'Guided tour' });
    const tour = tourDialog.getByText('Guided tour', { exact: true });
    await tour.waitFor({ state: 'visible', timeout: 15000 });
    const dismissedTour = await dismissIfVisible(tourDialog.getByRole('button', { name: 'Not now', exact: true }), 5000);
    assert(dismissedTour, 'Guided tour appeared but could not be dismissed.');
    await tour.waitFor({ state: 'hidden', timeout: 10000 });
    await dismissIfVisible(page.getByRole('button', { name: /necessary only/i }), 5000);

    const first = await waitForBrain(page, 2);
    const firstWebsite = authoredWebsite(first);
    mockWebsiteId = firstWebsite.id;
    const firstText = JSON.stringify(firstWebsite.data).toLowerCase();
    assert(!firstText.includes('free shipping') && !firstText.includes('fall in love with every look'), 'Generic ecommerce copy is still present.');
    await page.screenshot({ path: 'docker-website-wysiwyg-initial.png', fullPage: true });

    await page.getByText(firstWebsite.data.title, { exact: true }).first().click();
    const composer = page.getByRole('textbox', { name: 'Ask Brain about this canvas' });
    await composer.fill(followUp);
    await composer.press('Enter');

    const second = await waitForBrain(page, 4);
    const secondWebsite = authoredWebsite(second);
    const secondText = JSON.stringify(secondWebsite.data);
    assert(secondWebsite.id === firstWebsite.id, 'Follow-up replaced the website instead of editing it.');
    assert(secondText.includes('Acme Analytics'), 'Follow-up did not apply the requested business identity.');
    assert(secondText.includes('Turn operational data into confident decisions'), 'Follow-up did not apply the requested headline.');
    assert(secondText.includes('Book a demo'), 'Follow-up did not apply the requested CTA.');
    for (const name of ['Home', 'About', 'Services', 'Contact']) assert(secondText.includes(name), `Follow-up is missing the ${name} page.`);
    assert(!JSON.stringify(second.timeline).includes('did not actually make one'), 'Brain reported a non-mutating canvas change.');
    const aboutPage = page.getByRole('button', { name: 'About', exact: true, includeHidden: true });
    assert(await aboutPage.count() === 1, `Rendered Website nav has ${await aboutPage.count()} About buttons.`);
    const aboutVisibility = await aboutPage.evaluate((element) => ({ display: getComputedStyle(element).display, parentDisplay: getComputedStyle(element.parentElement).display, width: element.getBoundingClientRect().width }));
    assert(aboutVisibility.display !== 'none' && aboutVisibility.parentDisplay !== 'none' && aboutVisibility.width > 0, `Rendered Website nav is hidden: ${JSON.stringify(aboutVisibility)}`);
    await aboutPage.click();
    await page.getByText('About — Acme Analytics', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await dismissIfVisible(page.getByRole('button', { name: /necessary only/i }), 5000);
    const persisted = await snapshot(page);
    const persistedWebsite = authoredWebsite(persisted);
    assert(persistedWebsite.id === secondWebsite.id, 'Reload did not preserve the edited website object.');
    assert(JSON.stringify(persistedWebsite.data.pages) === JSON.stringify(secondWebsite.data.pages), 'Website pages did not persist across reload.');
    await dismissIfVisible(page.getByRole('button', { name: 'Focus', exact: true }), 5000);
    await dismissIfVisible(page.getByRole('button', { name: 'Close inspector', exact: true }), 5000);
    await dismissIfVisible(page.getByRole('button', { name: 'Close palette', exact: true }), 5000);
    await dismissIfVisible(page.getByRole('button', { name: 'Close Brain chat', exact: true }), 5000);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'docker-website-wysiwyg-followup.png', fullPage: true });

    console.log(JSON.stringify({
      status: 'passed',
      url: page.url(),
      tourDismissed: true,
      websiteId: secondWebsite.id,
      title: secondWebsite.data.title,
      pages: secondWebsite.data.pages.map((item) => item.name),
      sectionsPerPage: secondWebsite.data.pages.map((item) => item.sections.length),
      theme: secondWebsite.data.websiteTheme,
      timelineMessages: second.timeline.length,
      browserErrors,
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
