/**
 * Built-in PAID advertising connectors — the networks a budget is actually spent on.
 *
 * Deliberately separate from `defaults/social.ts`, which is ORGANIC publishing. The two
 * look adjacent and are not: an organic post is free, immediate and owned by a page,
 * while an ad is a funded object with a budget, a bid, a targeting group and a daily
 * reporting grain. Meta makes the distinction concrete — the same `graph.facebook.com`
 * host serves both, but a Page post is `/{page_id}/feed` on a Page token and an ad is
 * `/act_{id}/campaigns` on an ads token with `ads_management`. One manifest cannot hold
 * both without making every action's credential requirements a guess.
 *
 * ── ACCOUNT-SCOPE FIELDS ─────────────────────────────────────────────────────
 * Every one of these networks bills a specific ACCOUNT, and no token implies which:
 * a Google Ads OAuth grant reaches every customer the login can administer, a Meta
 * token reaches every ad account the user has a role on. So each manifest declares the
 * account id as a NON-SECRET auth field, exactly as the social manifests declare a Page
 * id. That is what lets {@link ../../advertising/adsProviders} refuse a spend it could
 * not place, instead of placing it on the wrong account — the single most expensive
 * version of that bug.
 *
 * ── WHY THE HEADER PARAMS LOOK ODD ───────────────────────────────────────────
 * `defaultHeaders` are static strings; only `baseUrl`, action paths and param DEFAULTS
 * are `{{auth.x}}`-filled by the runtime. Google Ads needs its developer token and
 * login-customer-id as HEADERS drawn from the connection, so those ride as header params
 * with templated defaults — the same shape Trello's key-as-query-param already uses.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, ba, bn, bo, h, p, q, qn } from './dsl';

/** The account-scope field help text differs per network but the ROLE is identical,
 *  so the shape is declared once and the wording supplied per manifest. */
const accountField = (label: string, placeholder: string, help: string) =>
  ({ key: 'adAccountId', label, secret: false, required: false, placeholder, help });

// ---------------------------------------------------------------------------
// Google Ads
// ---------------------------------------------------------------------------

/**
 * Google Ads is query-shaped rather than resource-shaped: campaigns, ad groups, ads
 * AND their metrics are all read through one GAQL `search` call, and every write is a
 * `:mutate` taking an operations array. Modelling it as one read + four mutates matches
 * the API instead of inventing REST resources that do not exist.
 */
const googleAds: ConnectorManifest = {
  key: 'google-ads', name: 'Google Ads', category: 'marketing', icon: '🅖',
  description: 'Run and report on Google Search, Display, YouTube, Performance Max and Demand Gen campaigns.',
  baseUrl: 'https://googleads.googleapis.com/v18', docsUrl: 'https://developers.google.com/google-ads/api/docs/start',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'A user-context token with the https://www.googleapis.com/auth/adwords scope.' },
    { key: 'developerToken', label: 'Developer token', secret: true, required: true, help: 'From your Google Ads manager account — API Center. Basic access is required to touch a production account.' },
    { key: 'loginCustomerId', label: 'Manager (MCC) customer ID', secret: false, required: false, placeholder: '1234567890', help: 'Digits only, no dashes. Required when the token authenticates through a manager account.' },
    { key: 'adAccountId', label: 'Customer ID', secret: false, required: false, placeholder: '1234567890', help: 'Digits only, no dashes — the account this connection spends on and reports for.' },
  ] },
  actions: [
    { key: 'search', label: 'Run a GAQL query', description: 'Read campaigns, ad groups, ads or metrics with a Google Ads Query Language statement.', method: 'POST', path: '/customers/{customer_id}/googleAds:search', mutates: false, required: ['customer_id', 'query'], resultPath: 'results', params: {
      customer_id: p('Customer id, digits only'), query: b('GAQL statement, e.g. SELECT campaign.id, metrics.cost_micros FROM campaign'), pageSize: bn('Rows per page, up to 10000'), pageToken: b('Continuation token from a previous page'),
      'developer-token': h('Developer token', { default: '{{auth.developerToken}}' }), 'login-customer-id': h('Manager customer id', { default: '{{auth.loginCustomerId}}' }),
    } },
    { key: 'list_accessible_customers', label: 'List accessible accounts', description: 'List the Google Ads customer ids this token can administer.', method: 'GET', path: '/customers:listAccessibleCustomers', mutates: false, resultPath: 'resourceNames', params: {
      'developer-token': h('Developer token', { default: '{{auth.developerToken}}' }), 'login-customer-id': h('Manager customer id', { default: '{{auth.loginCustomerId}}' }),
    } },
    { key: 'mutate_campaign_budgets', label: 'Create or update budgets', description: 'Create, update or remove campaign budgets. A Google Ads campaign cannot exist without one.', method: 'POST', path: '/customers/{customer_id}/campaignBudgets:mutate', mutates: true, required: ['customer_id', 'operations'], resultPath: 'results', params: {
      customer_id: p('Customer id, digits only'), operations: ba('Array of create/update/remove budget operations'), partialFailure: { type: 'boolean', in: 'body', description: 'Apply the operations that succeed instead of failing the batch' },
      'developer-token': h('Developer token', { default: '{{auth.developerToken}}' }), 'login-customer-id': h('Manager customer id', { default: '{{auth.loginCustomerId}}' }),
    } },
    { key: 'mutate_campaigns', label: 'Create or update campaigns', description: 'Create, update, pause, resume or remove Google Ads campaigns.', method: 'POST', path: '/customers/{customer_id}/campaigns:mutate', mutates: true, required: ['customer_id', 'operations'], resultPath: 'results', params: {
      customer_id: p('Customer id, digits only'), operations: ba('Array of create/update/remove campaign operations'), partialFailure: { type: 'boolean', in: 'body', description: 'Apply the operations that succeed instead of failing the batch' },
      'developer-token': h('Developer token', { default: '{{auth.developerToken}}' }), 'login-customer-id': h('Manager customer id', { default: '{{auth.loginCustomerId}}' }),
    } },
    { key: 'mutate_ad_groups', label: 'Create or update ad groups', description: 'Create, update or remove ad groups inside a campaign.', method: 'POST', path: '/customers/{customer_id}/adGroups:mutate', mutates: true, required: ['customer_id', 'operations'], resultPath: 'results', params: {
      customer_id: p('Customer id, digits only'), operations: ba('Array of create/update/remove ad-group operations'),
      'developer-token': h('Developer token', { default: '{{auth.developerToken}}' }), 'login-customer-id': h('Manager customer id', { default: '{{auth.loginCustomerId}}' }),
    } },
    { key: 'mutate_ad_group_ads', label: 'Create or update ads', description: 'Create, update, pause or remove the ads running in an ad group.', method: 'POST', path: '/customers/{customer_id}/adGroupAds:mutate', mutates: true, required: ['customer_id', 'operations'], resultPath: 'results', params: {
      customer_id: p('Customer id, digits only'), operations: ba('Array of create/update/remove ad operations'),
      'developer-token': h('Developer token', { default: '{{auth.developerToken}}' }), 'login-customer-id': h('Manager customer id', { default: '{{auth.loginCustomerId}}' }),
    } },
    // Google keeps WHO an ad group is shown to in a different resource from the ad group
    // itself: geography, demographics and keywords are all `ad_group_criterion` rows.
    // Without this action an ad group can be created and can never be targeted.
    { key: 'mutate_ad_group_criteria', label: 'Create or update targeting criteria', description: 'Create, update or remove the location, demographic and keyword criteria that decide who an ad group is shown to.', method: 'POST', path: '/customers/{customer_id}/adGroupCriteria:mutate', mutates: true, required: ['customer_id', 'operations'], resultPath: 'results', params: {
      customer_id: p('Customer id, digits only'), operations: ba('Array of create/update/remove criterion operations'), partialFailure: { type: 'boolean', in: 'body', description: 'Apply the operations that succeed instead of failing the batch' },
      'developer-token': h('Developer token', { default: '{{auth.developerToken}}' }), 'login-customer-id': h('Manager customer id', { default: '{{auth.loginCustomerId}}' }),
    } },
    // Google puts LOCATION on the campaign, not the ad group — there is no ad-group
    // location criterion to write to, so geographic targeting is a different resource
    // from the demographic targeting immediately above.
    { key: 'mutate_campaign_criteria', label: 'Create or update campaign criteria', description: 'Create, update or remove the location and device criteria that scope a whole campaign.', method: 'POST', path: '/customers/{customer_id}/campaignCriteria:mutate', mutates: true, required: ['customer_id', 'operations'], resultPath: 'results', params: {
      customer_id: p('Customer id, digits only'), operations: ba('Array of create/update/remove criterion operations'), partialFailure: { type: 'boolean', in: 'body', description: 'Apply the operations that succeed instead of failing the batch' },
      'developer-token': h('Developer token', { default: '{{auth.developerToken}}' }), 'login-customer-id': h('Manager customer id', { default: '{{auth.loginCustomerId}}' }),
    } },
    // Google will not accept a country CODE as a location — it takes a geo target
    // constant id. This is the documented lookup that turns "GB" into one.
    { key: 'suggest_geo_targets', label: 'Look up locations', description: 'Resolve country or place names into the geo target constants Google requires for location targeting.', method: 'POST', path: '/geoTargetConstants:suggest', mutates: false, resultPath: 'geoTargetConstantSuggestions', params: {
      locale: b('Locale of the supplied names, e.g. en'), countryCode: b('Restrict suggestions to this ISO 3166-1 alpha-2 country'), locationNames: bo('Object with a names array, e.g. {"names":["United Kingdom"]}'),
      'developer-token': h('Developer token', { default: '{{auth.developerToken}}' }), 'login-customer-id': h('Manager customer id', { default: '{{auth.loginCustomerId}}' }),
    } },
  ],
};

// ---------------------------------------------------------------------------
// Meta Ads (Facebook + Instagram)
// ---------------------------------------------------------------------------

const metaAds: ConnectorManifest = {
  key: 'meta-ads', name: 'Meta Ads', category: 'marketing', icon: '◈',
  description: 'Run and report on paid campaigns across Facebook, Instagram, Messenger and Audience Network.',
  baseUrl: 'https://graph.facebook.com/v25.0', docsUrl: 'https://developers.facebook.com/docs/marketing-apis',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'Access token', secret: true, required: true, help: 'A token with ads_management and ads_read. Publishing spend requires an app with Advanced Access reviewed.' },
    accountField('Ad account ID', 'act_1234567890', 'Including the act_ prefix — the account the spend is billed to.'),
    // Only ads need it: a campaign and its ad sets are created and budgeted without a
    // Page, and Meta then refuses the creative because every Meta ad is published BY a
    // Page. Optional here so an account connected before ad-level support keeps working.
    { key: 'pageId', label: 'Facebook Page ID', secret: false, required: false, placeholder: '1234567890', help: 'The Page an ad is published from. Not needed to run campaigns — needed to create the creative an ad renders.' },
  ] },
  actions: [
    { key: 'list_ad_accounts', label: 'List ad accounts', description: 'List the Meta ad accounts this token can spend on.', method: 'GET', path: '/me/adaccounts', mutates: false, resultPath: 'data', params: { fields: q('Fields such as id,name,account_status,currency'), limit: qn('Page size') } },
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read paid campaigns on the ad account with their budgets and status.', method: 'GET', path: '/{ad_account_id}/campaigns', mutates: false, required: ['ad_account_id'], resultPath: 'data', params: { ad_account_id: p('Ad account id including act_'), fields: q('Fields such as id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time'), effective_status: q('JSON array of statuses to include'), limit: qn('Page size') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create a paid Meta campaign. Spends money once its ad sets and ads are active.', method: 'POST', path: '/{ad_account_id}/campaigns', mutates: true, required: ['ad_account_id', 'name', 'objective'], params: {
      ad_account_id: p('Ad account id including act_'), name: b('Campaign name'), objective: b('Objective, e.g. OUTCOME_TRAFFIC, OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_AWARENESS'), status: b('ACTIVE or PAUSED', { default: 'PAUSED' }), special_ad_categories: ba('Required declaration array — empty for most campaigns', { default: [] }), daily_budget: bn('Daily budget in the account currency minor unit'), lifetime_budget: bn('Lifetime budget in the account currency minor unit'), buying_type: b('AUCTION or RESERVED'), bid_strategy: b('LOWEST_COST_WITHOUT_CAP, LOWEST_COST_WITH_BID_CAP or COST_CAP'),
    } },
    { key: 'update_campaign', label: 'Update campaign', description: 'Rename, re-budget, pause or resume an existing Meta campaign.', method: 'POST', path: '/{campaign_id}', mutates: true, required: ['campaign_id'], params: { campaign_id: p('Meta campaign id'), name: b('New campaign name'), status: b('ACTIVE, PAUSED or ARCHIVED'), daily_budget: bn('Daily budget in the account currency minor unit'), lifetime_budget: bn('Lifetime budget in the account currency minor unit') } },
    { key: 'list_adsets', label: 'List ad sets', description: 'Read the targeting groups inside the account with their budgets and schedules.', method: 'GET', path: '/{ad_account_id}/adsets', mutates: false, required: ['ad_account_id'], resultPath: 'data', params: { ad_account_id: p('Ad account id including act_'), fields: q('Fields such as id,name,campaign_id,status,daily_budget,targeting,optimization_goal'), limit: qn('Page size') } },
    { key: 'create_adset', label: 'Create ad set', description: 'Create a targeting and budget group inside a campaign.', method: 'POST', path: '/{ad_account_id}/adsets', mutates: true, required: ['ad_account_id', 'name', 'campaign_id'], params: {
      ad_account_id: p('Ad account id including act_'), name: b('Ad set name'), campaign_id: b('Parent campaign id'), status: b('ACTIVE or PAUSED', { default: 'PAUSED' }), daily_budget: bn('Daily budget in the account currency minor unit'), lifetime_budget: bn('Lifetime budget in the account currency minor unit'), billing_event: b('IMPRESSIONS, LINK_CLICKS or THRUPLAY'), optimization_goal: b('LINK_CLICKS, OFFSITE_CONVERSIONS, REACH, LEAD_GENERATION and similar'), bid_amount: bn('Bid cap in the account currency minor unit'), targeting: bo('Targeting spec — geo_locations, age_min, age_max, interests'), start_time: b('ISO 8601 start'), end_time: b('ISO 8601 end'), promoted_object: bo('Page, pixel or application the ad set optimizes for'),
    } },
    { key: 'update_adset', label: 'Update ad set', description: 'Re-budget, retarget, pause or resume an ad set.', method: 'POST', path: '/{adset_id}', mutates: true, required: ['adset_id'], params: { adset_id: p('Meta ad set id'), name: b('New ad set name'), status: b('ACTIVE, PAUSED or ARCHIVED'), daily_budget: bn('Daily budget in the account currency minor unit'), targeting: bo('Replacement targeting spec'), bid_amount: bn('Bid cap in the account currency minor unit') } },
    { key: 'create_ad_creative', label: 'Create ad creative', description: 'Create the reusable creative an ad renders — copy, image or video, and the destination.', method: 'POST', path: '/{ad_account_id}/adcreatives', mutates: true, required: ['ad_account_id', 'name'], params: { ad_account_id: p('Ad account id including act_'), name: b('Creative name'), object_story_spec: bo('Page id plus the link, photo or video story data'), degrees_of_freedom_spec: bo('Optional generative-enhancement opt-outs') } },
    { key: 'list_ads', label: 'List ads', description: 'Read the individual ads running on the account.', method: 'GET', path: '/{ad_account_id}/ads', mutates: false, required: ['ad_account_id'], resultPath: 'data', params: { ad_account_id: p('Ad account id including act_'), fields: q('Fields such as id,name,adset_id,status,creative'), limit: qn('Page size') } },
    { key: 'create_ad', label: 'Create ad', description: 'Place a creative into an ad set as a running ad.', method: 'POST', path: '/{ad_account_id}/ads', mutates: true, required: ['ad_account_id', 'name', 'adset_id', 'creative'], params: { ad_account_id: p('Ad account id including act_'), name: b('Ad name'), adset_id: b('Parent ad set id'), creative: bo('Creative reference, e.g. {"creative_id":"123"}'), status: b('ACTIVE or PAUSED', { default: 'PAUSED' }) } },
    { key: 'update_ad', label: 'Update ad', description: 'Rename, pause or resume a single ad.', method: 'POST', path: '/{ad_id}', mutates: true, required: ['ad_id'], params: { ad_id: p('Meta ad id'), name: b('New ad name'), status: b('ACTIVE, PAUSED or ARCHIVED') } },
    // Meta takes interest IDs, never interest names — `{"name":"Cycling"}` is accepted
    // and matches nobody. This is the documented lookup that turns a phrase into an id.
    { key: 'search_targeting', label: 'Look up targeting options', description: 'Resolve interest, behaviour or location names into the ids Meta requires in a targeting spec.', method: 'GET', path: '/search', mutates: false, required: ['type'], resultPath: 'data', params: { type: q('adinterest, adgeolocation, adTargetingCategory and similar'), q: q('The phrase to look up'), class: q('Narrower class within the type'), limit: qn('Page size') } },
    { key: 'get_insights', label: 'Get insights', description: 'Read spend, impressions, clicks and conversions for an account, campaign, ad set or ad.', method: 'GET', path: '/{node_id}/insights', mutates: false, required: ['node_id'], resultPath: 'data', params: { node_id: p('Ad account, campaign, ad set or ad id'), fields: q('Fields such as spend,impressions,clicks,ctr,cpc,actions,date_start,date_stop'), level: q('account, campaign, adset or ad'), time_range: q('JSON object, e.g. {"since":"2026-08-01","until":"2026-08-15"}'), time_increment: q('1 for daily rows, or all_days'), limit: qn('Page size') } },
  ],
};

// ---------------------------------------------------------------------------
// LinkedIn Ads
// ---------------------------------------------------------------------------

const linkedinAds: ConnectorManifest = {
  key: 'linkedin-ads', name: 'LinkedIn Ads', category: 'marketing', icon: '▤',
  description: 'Run and report on LinkedIn sponsored content and lead-generation campaigns.',
  baseUrl: 'https://api.linkedin.com/rest', docsUrl: 'https://learn.microsoft.com/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns',
  defaultHeaders: { 'LinkedIn-Version': '202606', 'X-Restli-Protocol-Version': '2.0.0' },
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'Requires the Advertising API with rw_ads — LinkedIn gates this behind its own partner review.' },
    accountField('Ad account ID', '512345678', 'The numeric sponsored account id, without the urn:li:sponsoredAccount: prefix.'),
  ] },
  actions: [
    { key: 'list_ad_accounts', label: 'List ad accounts', description: 'List the LinkedIn sponsored accounts this token can spend on.', method: 'GET', path: '/adAccounts', mutates: false, resultPath: 'elements', params: { q: q('Finder name', { default: 'search' }), count: qn('Page size'), start: qn('Page offset') } },
    { key: 'list_campaign_groups', label: 'List campaign groups', description: 'Read the campaign groups that hold budget on the account.', method: 'GET', path: '/adAccounts/{account_id}/adCampaignGroups', mutates: false, required: ['account_id'], resultPath: 'elements', params: { account_id: p('Numeric sponsored account id'), q: q('Finder name', { default: 'search' }), count: qn('Page size') } },
    { key: 'create_campaign_group', label: 'Create campaign group', description: 'Create the campaign group a LinkedIn campaign must belong to.', method: 'POST', path: '/adAccounts/{account_id}/adCampaignGroups', mutates: true, required: ['account_id', 'name'], params: { account_id: p('Numeric sponsored account id'), name: b('Campaign group name'), status: b('ACTIVE, PAUSED or DRAFT', { default: 'DRAFT' }), account: b('Account URN, e.g. urn:li:sponsoredAccount:512345678'), totalBudget: bo('Budget object with currencyCode and amount'), runSchedule: bo('Start and end times in epoch milliseconds') } },
    { key: 'update_campaign_group', label: 'Update campaign group', description: 'Rename, re-budget, pause or resume a LinkedIn campaign group.', method: 'POST', path: '/adAccounts/{account_id}/adCampaignGroups/{campaign_group_id}', mutates: true, required: ['account_id', 'campaign_group_id', 'patch'], headers: { 'X-RestLi-Method': 'PARTIAL_UPDATE' }, params: { account_id: p('Numeric sponsored account id'), campaign_group_id: p('Numeric campaign group id'), patch: bo('Patch document, e.g. {"$set":{"status":"PAUSED"}}') } },
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read LinkedIn campaigns with their budgets, bids and status.', method: 'GET', path: '/adAccounts/{account_id}/adCampaigns', mutates: false, required: ['account_id'], resultPath: 'elements', params: { account_id: p('Numeric sponsored account id'), q: q('Finder name', { default: 'search' }), search: q('URL-encoded search criteria'), count: qn('Page size'), start: qn('Page offset') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create a LinkedIn campaign. Spends once it is ACTIVE and has creatives.', method: 'POST', path: '/adAccounts/{account_id}/adCampaigns', mutates: true, required: ['account_id', 'name'], params: {
      account_id: p('Numeric sponsored account id'), name: b('Campaign name'), campaignGroup: b('Campaign group URN'), account: b('Account URN, e.g. urn:li:sponsoredAccount:512345678'), type: b('SPONSORED_UPDATES, TEXT_AD, SPONSORED_INMAILS or DYNAMIC'), objectiveType: b('BRAND_AWARENESS, WEBSITE_VISITS, LEAD_GENERATION, WEBSITE_CONVERSIONS and similar'), status: b('ACTIVE, PAUSED or DRAFT', { default: 'DRAFT' }), costType: b('CPM, CPC or CPV'), dailyBudget: bo('Amount object with currencyCode and amount as a decimal string'), totalBudget: bo('Amount object with currencyCode and amount as a decimal string'), unitCost: bo('Bid amount object'), locale: bo('Campaign locale, e.g. {"country":"US","language":"en"}'), targetingCriteria: bo('Include/exclude facet tree'), runSchedule: bo('Start and end times in epoch milliseconds'),
    } },
    { key: 'update_campaign', label: 'Update campaign', description: 'Re-budget, re-bid, pause or resume a LinkedIn campaign.', method: 'POST', path: '/adAccounts/{account_id}/adCampaigns/{campaign_id}', mutates: true, required: ['account_id', 'campaign_id', 'patch'], headers: { 'X-RestLi-Method': 'PARTIAL_UPDATE' }, params: { account_id: p('Numeric sponsored account id'), campaign_id: p('Numeric campaign id'), patch: bo('Patch document, e.g. {"$set":{"status":"PAUSED"}}') } },
    { key: 'list_creatives', label: 'List creatives', description: 'Read the creatives running in the account.', method: 'GET', path: '/adAccounts/{account_id}/creatives', mutates: false, required: ['account_id'], resultPath: 'elements', params: { account_id: p('Numeric sponsored account id'), q: q('Finder name', { default: 'criteria' }), campaigns: q('URL-encoded list of campaign URNs'), count: qn('Page size') } },
    { key: 'create_creative', label: 'Create creative', description: 'Put a sponsored post into a LinkedIn campaign as a running creative.', method: 'POST', path: '/adAccounts/{account_id}/creatives', mutates: true, required: ['account_id', 'campaign'], params: { account_id: p('Numeric sponsored account id'), campaign: b('Parent campaign URN'), inlineContent: b('URN of the share, post or video the creative renders'), intendedStatus: b('ACTIVE, PAUSED or DRAFT', { default: 'DRAFT' }) } },
    { key: 'update_creative', label: 'Update creative', description: 'Pause or resume a LinkedIn creative.', method: 'POST', path: '/adAccounts/{account_id}/creatives/{creative_id}', mutates: true, required: ['account_id', 'creative_id', 'patch'], headers: { 'X-RestLi-Method': 'PARTIAL_UPDATE' }, params: { account_id: p('Numeric sponsored account id'), creative_id: p('URL-encoded creative URN'), patch: bo('Patch document, e.g. {"$set":{"intendedStatus":"PAUSED"}}') } },
    { key: 'get_analytics', label: 'Get analytics', description: 'Read spend, impressions, clicks and conversions for LinkedIn campaigns over a date range.', method: 'GET', path: '/adAnalytics', mutates: false, required: ['q'], resultPath: 'elements', params: { q: q('Finder name', { default: 'analytics' }), pivot: q('CAMPAIGN, CREATIVE, ACCOUNT or CAMPAIGN_GROUP'), timeGranularity: q('DAILY, MONTHLY or ALL'), 'dateRange.start.day': qn('Start day'), 'dateRange.start.month': qn('Start month'), 'dateRange.start.year': qn('Start year'), 'dateRange.end.day': qn('End day'), 'dateRange.end.month': qn('End month'), 'dateRange.end.year': qn('End year'), campaigns: q('URL-encoded List() of campaign URNs'), accounts: q('URL-encoded List() of account URNs'), fields: q('Comma list such as costInLocalCurrency,impressions,clicks,externalWebsiteConversions,dateRange,pivotValues') } },
  ],
};

// ---------------------------------------------------------------------------
// TikTok Ads
// ---------------------------------------------------------------------------

/** TikTok's Business API answers 200 with its own `code` envelope — the adapter, not
 *  the manifest, is what decides success, exactly as the organic TikTok connector does. */
const tiktokAds: ConnectorManifest = {
  key: 'tiktok-ads', name: 'TikTok Ads', category: 'marketing', icon: '◐',
  description: 'Run and report on TikTok paid campaigns, ad groups and creatives.',
  baseUrl: 'https://business-api.tiktok.com/open_api/v1.3', docsUrl: 'https://business-api.tiktok.com/portal/docs',
  auth: { kind: 'api_key', in: 'header', name: 'Access-Token', fields: [
    { key: 'apiKey', label: 'Access token', secret: true, required: true, help: 'A TikTok for Business access token with Ads Management permission.' },
    accountField('Advertiser ID', '7000000000000000000', 'The advertiser account the spend is billed to.'),
  ] },
  actions: [
    { key: 'list_advertisers', label: 'List advertiser accounts', description: 'List the TikTok advertiser accounts this token can spend on.', method: 'GET', path: '/oauth2/advertiser/get/', mutates: false, params: { app_id: q('TikTok app id'), secret: q('TikTok app secret') } },
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read TikTok campaigns with their budgets and status.', method: 'GET', path: '/campaign/get/', mutates: false, required: ['advertiser_id'], params: { advertiser_id: q('Advertiser id'), filtering: q('JSON filter object'), page: qn('Page number'), page_size: qn('Rows per page, up to 1000') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create a TikTok paid campaign.', method: 'POST', path: '/campaign/create/', mutates: true, required: ['advertiser_id', 'campaign_name', 'objective_type'], params: { advertiser_id: b('Advertiser id'), campaign_name: b('Campaign name'), objective_type: b('TRAFFIC, CONVERSIONS, REACH, VIDEO_VIEWS, LEAD_GENERATION and similar'), budget_mode: b('BUDGET_MODE_DAY, BUDGET_MODE_TOTAL or BUDGET_MODE_INFINITE'), budget: bn('Budget in the account currency major unit'), operation_status: b('ENABLE or DISABLE', { default: 'DISABLE' }), special_industries: ba('Required declaration for regulated categories') } },
    { key: 'update_campaign', label: 'Update campaign', description: 'Rename or re-budget a TikTok campaign.', method: 'POST', path: '/campaign/update/', mutates: true, required: ['advertiser_id', 'campaign_id'], params: { advertiser_id: b('Advertiser id'), campaign_id: b('Campaign id'), campaign_name: b('New campaign name'), budget: bn('Budget in the account currency major unit'), budget_mode: b('BUDGET_MODE_DAY or BUDGET_MODE_TOTAL') } },
    { key: 'update_campaign_status', label: 'Pause or resume campaigns', description: 'Enable, disable or delete TikTok campaigns.', method: 'POST', path: '/campaign/status/update/', mutates: true, required: ['advertiser_id', 'campaign_ids', 'operation_status'], params: { advertiser_id: b('Advertiser id'), campaign_ids: ba('Campaign ids to change'), operation_status: b('ENABLE, DISABLE or DELETE') } },
    { key: 'list_adgroups', label: 'List ad groups', description: 'Read TikTok ad groups with their targeting, bids and budgets.', method: 'GET', path: '/adgroup/get/', mutates: false, required: ['advertiser_id'], params: { advertiser_id: q('Advertiser id'), filtering: q('JSON filter object'), page: qn('Page number'), page_size: qn('Rows per page') } },
    { key: 'create_adgroup', label: 'Create ad group', description: 'Create a TikTok targeting and budget group inside a campaign.', method: 'POST', path: '/adgroup/create/', mutates: true, required: ['advertiser_id', 'campaign_id', 'adgroup_name'], params: { advertiser_id: b('Advertiser id'), campaign_id: b('Parent campaign id'), adgroup_name: b('Ad group name'), promotion_type: b('WEBSITE, APP_ANDROID, APP_IOS or LEAD_GENERATION'), placement_type: b('PLACEMENT_TYPE_AUTOMATIC or PLACEMENT_TYPE_NORMAL'), budget_mode: b('BUDGET_MODE_DAY or BUDGET_MODE_TOTAL'), budget: bn('Budget in the account currency major unit'), schedule_type: b('SCHEDULE_FROM_NOW or SCHEDULE_START_END'), schedule_start_time: b('Start time as YYYY-MM-DD HH:MM:SS'), schedule_end_time: b('End time as YYYY-MM-DD HH:MM:SS'), optimization_goal: b('CLICK, CONVERT, REACH, LEAD_GENERATION and similar'), bid_type: b('BID_TYPE_NO_BID or BID_TYPE_CUSTOM'), bid_price: bn('Bid in the account currency major unit'), billing_event: b('CPC, CPM or OCPM'), location_ids: ba('Target location ids'), operation_status: b('ENABLE or DISABLE', { default: 'DISABLE' }) } },
    { key: 'update_adgroup', label: 'Update ad group', description: 'Rename, re-budget, re-bid or retarget a TikTok ad group.', method: 'POST', path: '/adgroup/update/', mutates: true, required: ['advertiser_id', 'adgroup_id'], params: { advertiser_id: b('Advertiser id'), adgroup_id: b('Ad group id'), adgroup_name: b('New ad group name'), budget: bn('Budget in the account currency major unit'), budget_mode: b('BUDGET_MODE_DAY or BUDGET_MODE_TOTAL'), bid_price: bn('Bid in the account currency major unit'), location_ids: ba('Target location ids'), age_groups: ba('Age buckets such as AGE_18_24'), gender: b('GENDER_MALE, GENDER_FEMALE or GENDER_UNLIMITED'), interest_category_ids: ba('Interest category ids'), placements: ba('Placements such as PLACEMENT_TIKTOK'), placement_type: b('PLACEMENT_TYPE_AUTOMATIC or PLACEMENT_TYPE_NORMAL') } },
    { key: 'update_adgroup_status', label: 'Pause or resume ad groups', description: 'Enable, disable or delete TikTok ad groups.', method: 'POST', path: '/adgroup/status/update/', mutates: true, required: ['advertiser_id', 'adgroup_ids', 'operation_status'], params: { advertiser_id: b('Advertiser id'), adgroup_ids: ba('Ad group ids to change'), operation_status: b('ENABLE, DISABLE or DELETE') } },
    { key: 'list_ads', label: 'List ads', description: 'Read the individual TikTok ads with their copy, destination and status.', method: 'GET', path: '/ad/get/', mutates: false, required: ['advertiser_id'], params: { advertiser_id: q('Advertiser id'), filtering: q('JSON filter object'), page: qn('Page number'), page_size: qn('Rows per page') } },
    { key: 'create_ad', label: 'Create ad', description: 'Create a TikTok ad inside an ad group.', method: 'POST', path: '/ad/create/', mutates: true, required: ['advertiser_id', 'adgroup_id', 'creatives'], params: { advertiser_id: b('Advertiser id'), adgroup_id: b('Parent ad group id'), creatives: ba('Array of creative objects with ad_name, ad_format, ad_text, call_to_action, landing_page_url and identity fields') } },
    { key: 'update_ad_status', label: 'Pause or resume ads', description: 'Enable, disable or delete TikTok ads.', method: 'POST', path: '/ad/status/update/', mutates: true, required: ['advertiser_id', 'ad_ids', 'operation_status'], params: { advertiser_id: b('Advertiser id'), ad_ids: ba('Ad ids to change'), operation_status: b('ENABLE, DISABLE or DELETE') } },
    // TikTok takes numeric location ids, never country codes; this is the lookup.
    { key: 'list_regions', label: 'Look up locations', description: 'Resolve country codes into the numeric location ids TikTok requires for geographic targeting.', method: 'GET', path: '/tool/region/', mutates: false, required: ['advertiser_id'], params: { advertiser_id: q('Advertiser id'), objective_type: q('Objective the regions must be valid for'), placements: q('JSON array of placements') } },
    { key: 'list_interest_categories', label: 'Look up interests', description: 'Resolve interest names into the interest category ids TikTok requires.', method: 'GET', path: '/tool/interest_category/', mutates: false, required: ['advertiser_id'], params: { advertiser_id: q('Advertiser id'), placements: q('JSON array of placements'), special_industries: q('JSON array of regulated categories'), language: q('Category language, e.g. en') } },
    { key: 'get_report', label: 'Get report', description: 'Read TikTok spend, impressions, clicks and conversions over a date range.', method: 'GET', path: '/report/integrated/get/', mutates: false, required: ['advertiser_id', 'report_type', 'data_level'], params: { advertiser_id: q('Advertiser id'), report_type: q('BASIC or AUDIENCE'), data_level: q('AUCTION_CAMPAIGN, AUCTION_ADGROUP or AUCTION_AD'), dimensions: q('JSON array, e.g. ["campaign_id","stat_time_day"]'), metrics: q('JSON array, e.g. ["spend","impressions","clicks","conversion"]'), start_date: q('YYYY-MM-DD'), end_date: q('YYYY-MM-DD'), page: qn('Page number'), page_size: qn('Rows per page') } },
  ],
};

// ---------------------------------------------------------------------------
// X Ads
// ---------------------------------------------------------------------------

const xAds: ConnectorManifest = {
  key: 'x-ads', name: 'X Ads', category: 'marketing', icon: '✕',
  description: 'Run and report on paid campaigns and line items on X.',
  baseUrl: 'https://ads-api.x.com/12', docsUrl: 'https://developer.x.com/en/docs/x-ads-api',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'Requires an approved X Ads API application with ads:write.' },
    accountField('Ads account ID', '18ce54d4x5t', 'The X ads account the spend is billed to.'),
  ] },
  actions: [
    { key: 'list_accounts', label: 'List ads accounts', description: 'List the X ads accounts this token can spend on.', method: 'GET', path: '/accounts', mutates: false, resultPath: 'data', params: { count: qn('Page size'), cursor: q('Pagination cursor') } },
    { key: 'list_funding_instruments', label: 'List funding instruments', description: 'Read the funding instruments an X campaign can bill to, and the account currency.', method: 'GET', path: '/accounts/{account_id}/funding_instruments', mutates: false, required: ['account_id'], resultPath: 'data', params: { account_id: p('X ads account id'), count: qn('Page size'), with_deleted: q('true to include deleted instruments') } },
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read X campaigns with their budgets and status.', method: 'GET', path: '/accounts/{account_id}/campaigns', mutates: false, required: ['account_id'], resultPath: 'data', params: { account_id: p('X ads account id'), campaign_ids: q('Comma list of campaign ids'), count: qn('Page size'), cursor: q('Pagination cursor'), with_deleted: q('true to include deleted campaigns') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create an X paid campaign against a funding instrument.', method: 'POST', path: '/accounts/{account_id}/campaigns', mutates: true, required: ['account_id', 'name', 'funding_instrument_id'], resultPath: 'data', params: { account_id: p('X ads account id'), name: b('Campaign name'), funding_instrument_id: b('Funding instrument the spend bills to'), daily_budget_amount_local_micro: bn('Daily budget in micros of the account currency'), total_budget_amount_local_micro: bn('Total budget in micros of the account currency'), entity_status: b('ACTIVE or PAUSED', { default: 'PAUSED' }), start_time: b('ISO 8601 start'), end_time: b('ISO 8601 end') } },
    { key: 'update_campaign', label: 'Update campaign', description: 'Re-budget, pause or resume an X campaign.', method: 'PUT', path: '/accounts/{account_id}/campaigns/{campaign_id}', mutates: true, required: ['account_id', 'campaign_id'], resultPath: 'data', params: { account_id: p('X ads account id'), campaign_id: p('Campaign id'), name: b('New campaign name'), entity_status: b('ACTIVE or PAUSED'), daily_budget_amount_local_micro: bn('Daily budget in micros of the account currency'), total_budget_amount_local_micro: bn('Total budget in micros of the account currency') } },
    { key: 'list_line_items', label: 'List line items', description: 'Read the bid and targeting groups inside X campaigns.', method: 'GET', path: '/accounts/{account_id}/line_items', mutates: false, required: ['account_id'], resultPath: 'data', params: { account_id: p('X ads account id'), campaign_ids: q('Comma list of campaign ids'), count: qn('Page size'), cursor: q('Pagination cursor') } },
    { key: 'create_line_item', label: 'Create line item', description: 'Create a bid and targeting group inside an X campaign.', method: 'POST', path: '/accounts/{account_id}/line_items', mutates: true, required: ['account_id', 'campaign_id', 'objective', 'product_type'], resultPath: 'data', params: { account_id: p('X ads account id'), campaign_id: b('Parent campaign id'), name: b('Line item name'), objective: b('WEBSITE_CLICKS, ENGAGEMENTS, VIDEO_VIEWS, REACH and similar'), product_type: b('PROMOTED_TWEETS or MEDIA'), placements: ba('Placements, e.g. ["ALL_ON_TWITTER"]'), bid_amount_local_micro: bn('Bid in micros of the account currency'), entity_status: b('ACTIVE or PAUSED', { default: 'PAUSED' }) } },
    { key: 'update_line_item', label: 'Update line item', description: 'Rename, re-bid, pause or resume an X line item.', method: 'PUT', path: '/accounts/{account_id}/line_items/{line_item_id}', mutates: true, required: ['account_id', 'line_item_id'], resultPath: 'data', params: { account_id: p('X ads account id'), line_item_id: p('Line item id'), name: b('New line item name'), entity_status: b('ACTIVE or PAUSED'), bid_amount_local_micro: bn('Bid in micros of the account currency') } },
    // On X, WHO a line item reaches is a separate collection of criterion rows — one
    // per location, age bucket, gender or keyword. A line item with none reaches nobody
    // in particular, at full price.
    { key: 'list_targeting_criteria', label: 'List targeting criteria', description: 'Read the location, age, gender and keyword criteria attached to X line items.', method: 'GET', path: '/accounts/{account_id}/targeting_criteria', mutates: false, required: ['account_id'], resultPath: 'data', params: { account_id: p('X ads account id'), line_item_ids: q('Comma list of line item ids'), count: qn('Page size'), cursor: q('Pagination cursor') } },
    { key: 'create_targeting_criteria', label: 'Create targeting criteria', description: 'Attach location, age, gender or keyword targeting to an X line item.', method: 'POST', path: '/batch/accounts/{account_id}/targeting_criteria', mutates: true, required: ['account_id', 'operations'], resultPath: 'data', params: { account_id: p('X ads account id'), operations: { type: 'array', in: 'body', bodyPath: '$', description: 'Array of {operation_type, params:{line_item_id, targeting_type, targeting_value}} entries' } } },
    { key: 'list_targeting_locations', label: 'Look up locations', description: 'Resolve country names or codes into the location targeting values X requires.', method: 'GET', path: '/targeting_criteria/locations', mutates: false, resultPath: 'data', params: { q: q('Search phrase'), location_type: q('COUNTRY, REGION, CITY or POSTAL_CODE'), country_code: q('ISO 3166-1 alpha-2 filter'), count: qn('Page size') } },
    { key: 'list_promoted_tweets', label: 'List promoted posts', description: 'Read the promoted posts running in X line items.', method: 'GET', path: '/accounts/{account_id}/promoted_tweets', mutates: false, required: ['account_id'], resultPath: 'data', params: { account_id: p('X ads account id'), line_item_ids: q('Comma list of line item ids'), count: qn('Page size'), cursor: q('Pagination cursor'), with_deleted: q('true to include deleted entries') } },
    { key: 'create_promoted_tweet', label: 'Promote a post', description: 'Put an existing post into an X line item as a running ad.', method: 'POST', path: '/accounts/{account_id}/promoted_tweets', mutates: true, required: ['account_id', 'line_item_id', 'tweet_ids'], resultPath: 'data', params: { account_id: p('X ads account id'), line_item_id: b('Parent line item id'), tweet_ids: b('Comma list of post ids to promote') } },
    { key: 'delete_promoted_tweet', label: 'Stop promoting a post', description: 'Remove a promoted post from an X line item. X has no pause for a promoted post — stopping it IS deleting the entry.', method: 'DELETE', path: '/accounts/{account_id}/promoted_tweets/{promoted_tweet_id}', mutates: true, required: ['account_id', 'promoted_tweet_id'], resultPath: 'data', params: { account_id: p('X ads account id'), promoted_tweet_id: p('Promoted post entry id') } },
    { key: 'get_stats', label: 'Get stats', description: 'Read X spend, impressions, engagements and clicks for campaigns or line items.', method: 'GET', path: '/stats/accounts/{account_id}', mutates: false, required: ['account_id', 'entity', 'entity_ids', 'start_time', 'end_time', 'granularity', 'placement'], resultPath: 'data', params: { account_id: p('X ads account id'), entity: q('CAMPAIGN, LINE_ITEM, PROMOTED_TWEET or ACCOUNT'), entity_ids: q('Comma list of entity ids, up to 20'), start_time: q('ISO 8601 start, aligned to the account timezone'), end_time: q('ISO 8601 end'), granularity: q('DAY, HOUR or TOTAL'), metric_groups: q('Comma list such as ENGAGEMENT,BILLING'), placement: q('ALL_ON_TWITTER or PUBLISHER_NETWORK') } },
  ],
};

// ---------------------------------------------------------------------------
// Reddit Ads
// ---------------------------------------------------------------------------

const redditAds: ConnectorManifest = {
  key: 'reddit-ads', name: 'Reddit Ads', category: 'marketing', icon: '◓',
  description: 'Run and report on paid campaigns and ad groups on Reddit.',
  baseUrl: 'https://ads-api.reddit.com/api/v3', docsUrl: 'https://ads-api.reddit.com/docs/v3',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'A Reddit Ads API token with adsedit and adsread.' },
    accountField('Ad account ID', 't2_abc123', 'The Reddit ad account the spend is billed to.'),
  ] },
  actions: [
    { key: 'list_ad_accounts', label: 'List ad accounts', description: 'List the Reddit ad accounts this token can spend on.', method: 'GET', path: '/me/ad_accounts', mutates: false, resultPath: 'data', params: { page_size: qn('Page size') } },
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read Reddit campaigns with their budgets and status.', method: 'GET', path: '/ad_accounts/{ad_account_id}/campaigns', mutates: false, required: ['ad_account_id'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), page_size: qn('Page size'), 'page.token': q('Pagination token') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create a Reddit paid campaign.', method: 'POST', path: '/ad_accounts/{ad_account_id}/campaigns', mutates: true, required: ['ad_account_id', 'name', 'objective'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), name: b('Campaign name'), objective: b('TRAFFIC, CONVERSIONS, IMPRESSIONS, VIDEO_VIEWABLE_IMPRESSIONS or APP_INSTALLS'), configured_status: b('ACTIVE or PAUSED', { default: 'PAUSED' }), spend_cap: bn('Lifetime spend cap in micros of the account currency'), funding_instrument_id: b('Funding instrument the spend bills to') } },
    { key: 'update_campaign', label: 'Update campaign', description: 'Rename, re-cap, pause or resume a Reddit campaign.', method: 'PATCH', path: '/ad_accounts/{ad_account_id}/campaigns/{campaign_id}', mutates: true, required: ['ad_account_id', 'campaign_id'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), campaign_id: p('Campaign id'), name: b('New campaign name'), configured_status: b('ACTIVE, PAUSED or ARCHIVED'), spend_cap: bn('Lifetime spend cap in micros of the account currency') } },
    { key: 'list_ad_groups', label: 'List ad groups', description: 'Read Reddit ad groups with their targeting, bids and budgets.', method: 'GET', path: '/ad_accounts/{ad_account_id}/ad_groups', mutates: false, required: ['ad_account_id'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), page_size: qn('Page size'), 'page.token': q('Pagination token') } },
    { key: 'create_ad_group', label: 'Create ad group', description: 'Create a Reddit targeting and budget group inside a campaign.', method: 'POST', path: '/ad_accounts/{ad_account_id}/ad_groups', mutates: true, required: ['ad_account_id', 'campaign_id', 'name'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), campaign_id: b('Parent campaign id'), name: b('Ad group name'), configured_status: b('ACTIVE or PAUSED', { default: 'PAUSED' }), bid_strategy: b('MAXIMIZE_VOLUME, BIDLESS or MANUAL_BIDDING'), bid_value: bn('Bid in micros of the account currency'), goal_type: b('DAILY_SPEND or LIFETIME_SPEND'), goal_value: bn('Budget in micros of the account currency'), start_time: b('ISO 8601 start'), end_time: b('ISO 8601 end'), targeting: bo('Targeting spec — geolocations, communities, interests, devices') } },
    { key: 'update_ad_group', label: 'Update ad group', description: 'Rename, re-budget, re-bid, retarget, pause or resume a Reddit ad group.', method: 'PATCH', path: '/ad_accounts/{ad_account_id}/ad_groups/{ad_group_id}', mutates: true, required: ['ad_account_id', 'ad_group_id'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), ad_group_id: p('Ad group id'), name: b('New ad group name'), configured_status: b('ACTIVE, PAUSED or ARCHIVED'), bid_value: bn('Bid in micros of the account currency'), goal_value: bn('Budget in micros of the account currency'), goal_type: b('DAILY_SPEND or LIFETIME_SPEND'), targeting: bo('Replacement targeting spec') } },
    { key: 'list_ads', label: 'List ads', description: 'Read the Reddit ads with their copy, destination and status.', method: 'GET', path: '/ad_accounts/{ad_account_id}/ads', mutates: false, required: ['ad_account_id'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), page_size: qn('Page size'), 'page.token': q('Pagination token') } },
    { key: 'create_ad', label: 'Create ad', description: 'Create a Reddit ad inside an ad group.', method: 'POST', path: '/ad_accounts/{ad_account_id}/ads', mutates: true, required: ['ad_account_id', 'ad_group_id', 'name'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), ad_group_id: b('Parent ad group id'), name: b('Ad name'), configured_status: b('ACTIVE or PAUSED', { default: 'PAUSED' }), type: b('TEXT, IMAGE, VIDEO or CAROUSEL'), post_id: b('An existing post to promote instead of new copy'), headline: b('Ad headline'), body: b('Ad body copy'), destination_url: b('Where the click lands'), call_to_action: b('LEARN_MORE, SHOP_NOW, SIGN_UP and similar') } },
    { key: 'update_ad', label: 'Update ad', description: 'Rename, pause or resume a Reddit ad.', method: 'PATCH', path: '/ad_accounts/{ad_account_id}/ads/{ad_id}', mutates: true, required: ['ad_account_id', 'ad_id'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), ad_id: p('Ad id'), name: b('New ad name'), configured_status: b('ACTIVE, PAUSED or ARCHIVED') } },
    { key: 'get_report', label: 'Get report', description: 'Read Reddit spend, impressions, clicks and conversions over a date range.', method: 'POST', path: '/ad_accounts/{ad_account_id}/reports', mutates: false, required: ['ad_account_id', 'data', 'starts_at', 'ends_at'], resultPath: 'data', params: { ad_account_id: p('Reddit ad account id'), data: b('Report grain — CAMPAIGN, AD_GROUP, AD or ACCOUNT'), breakdowns: ba('Breakdowns, e.g. ["DATE"]'), fields: ba('Metrics such as spend, impressions, clicks, conversion_signup_total_items'), starts_at: b('ISO 8601 start'), ends_at: b('ISO 8601 end'), time_zone_id: b('IANA timezone the dates are interpreted in') } },
  ],
};

// ---------------------------------------------------------------------------
// Pinterest Ads
// ---------------------------------------------------------------------------

const pinterestAds: ConnectorManifest = {
  key: 'pinterest-ads', name: 'Pinterest Ads', category: 'marketing', icon: '◉',
  description: 'Run and report on paid Pinterest campaigns, ad groups and promoted pins.',
  baseUrl: 'https://api.pinterest.com/v5', docsUrl: 'https://developers.pinterest.com/docs/api/v5/introduction',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'Requires ads:read and ads:write on a Pinterest business account.' },
    accountField('Ad account ID', '549755885175', 'The Pinterest ad account the spend is billed to.'),
  ] },
  actions: [
    { key: 'list_ad_accounts', label: 'List ad accounts', description: 'List the Pinterest ad accounts this token can spend on.', method: 'GET', path: '/ad_accounts', mutates: false, resultPath: 'items', params: { page_size: qn('Page size'), bookmark: q('Pagination bookmark') } },
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read Pinterest campaigns with their budgets and status.', method: 'GET', path: '/ad_accounts/{ad_account_id}/campaigns', mutates: false, required: ['ad_account_id'], resultPath: 'items', params: { ad_account_id: p('Pinterest ad account id'), entity_statuses: q('Comma list such as ACTIVE,PAUSED'), page_size: qn('Page size'), bookmark: q('Pagination bookmark') } },
    { key: 'create_campaigns', label: 'Create campaigns', description: 'Create one or more Pinterest paid campaigns. The body is an ARRAY, which is what the v5 API takes.', method: 'POST', path: '/ad_accounts/{ad_account_id}/campaigns', mutates: true, required: ['ad_account_id', 'campaigns'], resultPath: 'items', params: { ad_account_id: p('Pinterest ad account id'), campaigns: { type: 'array', in: 'body', bodyPath: '$', description: 'Array of campaign objects with ad_account_id, name, objective_type, status and budget fields' } } },
    { key: 'update_campaigns', label: 'Update campaigns', description: 'Re-budget, pause or resume Pinterest campaigns.', method: 'PATCH', path: '/ad_accounts/{ad_account_id}/campaigns', mutates: true, required: ['ad_account_id', 'campaigns'], resultPath: 'items', params: { ad_account_id: p('Pinterest ad account id'), campaigns: { type: 'array', in: 'body', bodyPath: '$', description: 'Array of campaign objects, each carrying its id and the fields to change' } } },
    { key: 'list_ad_groups', label: 'List ad groups', description: 'Read Pinterest ad groups with their targeting, bids and budgets.', method: 'GET', path: '/ad_accounts/{ad_account_id}/ad_groups', mutates: false, required: ['ad_account_id'], resultPath: 'items', params: { ad_account_id: p('Pinterest ad account id'), campaign_ids: q('Comma list of campaign ids'), page_size: qn('Page size'), bookmark: q('Pagination bookmark') } },
    { key: 'create_ad_groups', label: 'Create ad groups', description: 'Create Pinterest targeting and budget groups inside a campaign.', method: 'POST', path: '/ad_accounts/{ad_account_id}/ad_groups', mutates: true, required: ['ad_account_id', 'ad_groups'], resultPath: 'items', params: { ad_account_id: p('Pinterest ad account id'), ad_groups: { type: 'array', in: 'body', bodyPath: '$', description: 'Array of ad-group objects with campaign_id, name, budget_in_micro_currency, bid_in_micro_currency and targeting_spec' } } },
    { key: 'update_ad_groups', label: 'Update ad groups', description: 'Re-budget, re-bid, retarget, pause or resume Pinterest ad groups.', method: 'PATCH', path: '/ad_accounts/{ad_account_id}/ad_groups', mutates: true, required: ['ad_account_id', 'ad_groups'], resultPath: 'items', params: { ad_account_id: p('Pinterest ad account id'), ad_groups: { type: 'array', in: 'body', bodyPath: '$', description: 'Array of ad-group objects, each carrying its id and the fields to change' } } },
    { key: 'list_ads', label: 'List ads', description: 'Read the promoted pins running on the account.', method: 'GET', path: '/ad_accounts/{ad_account_id}/ads', mutates: false, required: ['ad_account_id'], resultPath: 'items', params: { ad_account_id: p('Pinterest ad account id'), ad_group_ids: q('Comma list of ad group ids'), page_size: qn('Page size'), bookmark: q('Pagination bookmark') } },
    { key: 'create_ads', label: 'Create ads', description: 'Promote existing pins inside an ad group. Pinterest ads always reference a pin — there is no ad-authoring endpoint.', method: 'POST', path: '/ad_accounts/{ad_account_id}/ads', mutates: true, required: ['ad_account_id', 'ads'], resultPath: 'items', params: { ad_account_id: p('Pinterest ad account id'), ads: { type: 'array', in: 'body', bodyPath: '$', description: 'Array of ad objects with ad_group_id, creative_type, pin_id, name and status' } } },
    { key: 'update_ads', label: 'Update ads', description: 'Rename, pause or resume promoted pins.', method: 'PATCH', path: '/ad_accounts/{ad_account_id}/ads', mutates: true, required: ['ad_account_id', 'ads'], resultPath: 'items', params: { ad_account_id: p('Pinterest ad account id'), ads: { type: 'array', in: 'body', bodyPath: '$', description: 'Array of ad objects, each carrying its id and the fields to change' } } },
    { key: 'get_analytics', label: 'Get campaign analytics', description: 'Read Pinterest spend, impressions, clicks and conversions over a date range.', method: 'GET', path: '/ad_accounts/{ad_account_id}/campaigns/analytics', mutates: false, required: ['ad_account_id', 'start_date', 'end_date', 'campaign_ids', 'columns', 'granularity'], params: { ad_account_id: p('Pinterest ad account id'), campaign_ids: q('Comma list of campaign ids'), start_date: q('YYYY-MM-DD'), end_date: q('YYYY-MM-DD'), columns: q('Comma list such as SPEND_IN_MICRO_DOLLAR,IMPRESSION_1,CLICKTHROUGH_1,TOTAL_CONVERSIONS'), granularity: q('TOTAL, DAY, HOUR, WEEK or MONTH') } },
  ],
};

// ---------------------------------------------------------------------------
// Snapchat Ads
// ---------------------------------------------------------------------------

const snapchatAds: ConnectorManifest = {
  key: 'snapchat-ads', name: 'Snapchat Ads', category: 'marketing', icon: '◔',
  description: 'Run and report on paid Snapchat campaigns, ad squads and ads.',
  baseUrl: 'https://adsapi.snapchat.com/v1', docsUrl: 'https://developers.snap.com/api/marketing-api/Ads-API/introduction',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'A Snap Marketing API token with snapchat-marketing-api scope.' },
    accountField('Ad account ID', '8adc3db7-ce13-4f0d-a5b9-a4a0d1f0f8ab', 'The Snapchat ad account the spend is billed to.'),
  ] },
  actions: [
    { key: 'list_ad_accounts', label: 'List ad accounts', description: 'List the Snapchat ad accounts reachable through an organization.', method: 'GET', path: '/organizations/{organization_id}/adaccounts', mutates: false, required: ['organization_id'], resultPath: 'adaccounts', params: { organization_id: p('Snap organization id'), limit: qn('Page size') } },
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read Snapchat campaigns with their budgets and status.', method: 'GET', path: '/adaccounts/{ad_account_id}/campaigns', mutates: false, required: ['ad_account_id'], resultPath: 'campaigns', params: { ad_account_id: p('Snapchat ad account id'), limit: qn('Page size'), cursor: q('Pagination cursor') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create a Snapchat paid campaign.', method: 'POST', path: '/adaccounts/{ad_account_id}/campaigns', mutates: true, required: ['ad_account_id', 'campaigns'], resultPath: 'campaigns', params: { ad_account_id: p('Snapchat ad account id'), campaigns: ba('Array of campaign objects with name, ad_account_id, status, objective, start_time and budget fields') } },
    { key: 'update_campaign', label: 'Update campaign', description: 'Re-budget, pause or resume Snapchat campaigns.', method: 'PUT', path: '/adaccounts/{ad_account_id}/campaigns', mutates: true, required: ['ad_account_id', 'campaigns'], resultPath: 'campaigns', params: { ad_account_id: p('Snapchat ad account id'), campaigns: ba('Array of campaign objects, each carrying its id and the fields to change') } },
    { key: 'list_ad_squads', label: 'List ad squads', description: 'Read Snapchat ad squads with their targeting, bids and budgets.', method: 'GET', path: '/campaigns/{campaign_id}/adsquads', mutates: false, required: ['campaign_id'], resultPath: 'adsquads', params: { campaign_id: p('Snapchat campaign id'), limit: qn('Page size') } },
    { key: 'create_ad_squad', label: 'Create ad squad', description: 'Create a Snapchat targeting and budget group inside a campaign.', method: 'POST', path: '/campaigns/{campaign_id}/adsquads', mutates: true, required: ['campaign_id', 'adsquads'], resultPath: 'adsquads', params: { campaign_id: p('Snapchat campaign id'), adsquads: ba('Array of ad-squad objects with name, type, targeting, bid_micro, daily_budget_micro and optimization_goal') } },
    { key: 'update_ad_squad', label: 'Update ad squads', description: 'Re-budget, re-bid, retarget, pause or resume Snapchat ad squads.', method: 'PUT', path: '/adsquads/{adsquad_id}', mutates: true, required: ['adsquad_id', 'adsquads'], resultPath: 'adsquads', params: { adsquad_id: p('Snapchat ad squad id'), adsquads: ba('Array of ad-squad objects, each carrying its id and the fields to change') } },
    { key: 'list_ads', label: 'List ads', description: 'Read the Snapchat ads inside an ad squad.', method: 'GET', path: '/adsquads/{adsquad_id}/ads', mutates: false, required: ['adsquad_id'], resultPath: 'ads', params: { adsquad_id: p('Snapchat ad squad id'), limit: qn('Page size') } },
    { key: 'create_ad', label: 'Create ad', description: 'Place a Snapchat creative into an ad squad as a running ad.', method: 'POST', path: '/adsquads/{adsquad_id}/ads', mutates: true, required: ['adsquad_id', 'ads'], resultPath: 'ads', params: { adsquad_id: p('Snapchat ad squad id'), ads: ba('Array of ad objects with name, ad_squad_id, creative_id, type and status') } },
    { key: 'update_ad', label: 'Update ad', description: 'Rename, pause or resume Snapchat ads.', method: 'PUT', path: '/ads/{ad_id}', mutates: true, required: ['ad_id', 'ads'], resultPath: 'ads', params: { ad_id: p('Snapchat ad id'), ads: ba('Array of ad objects, each carrying its id and the fields to change') } },
    { key: 'list_creatives', label: 'List creatives', description: 'Read the reusable Snapchat creatives an ad can reference.', method: 'GET', path: '/adaccounts/{ad_account_id}/creatives', mutates: false, required: ['ad_account_id'], resultPath: 'creatives', params: { ad_account_id: p('Snapchat ad account id'), limit: qn('Page size') } },
    { key: 'get_stats', label: 'Get stats', description: 'Read Snapchat spend, impressions, swipes and conversions over a date range.', method: 'GET', path: '/campaigns/{campaign_id}/stats', mutates: false, required: ['campaign_id'], resultPath: 'timeseries_stats', params: { campaign_id: p('Snapchat campaign id'), granularity: q('DAY, HOUR, LIFETIME or TOTAL'), start_time: q('ISO 8601 start, aligned to the account timezone'), end_time: q('ISO 8601 end'), fields: q('Comma list such as spend,impressions,swipes,conversion_purchases') } },
  ],
};

// ---------------------------------------------------------------------------
// Microsoft Advertising
// ---------------------------------------------------------------------------

/**
 * Microsoft Advertising — Bing, Yahoo, DuckDuckGo, AOL and the Microsoft Audience
 * Network. The only SOAP connector in the catalog, and the reason SOAP is a transport
 * the runtime speaks.
 *
 * ── WHY IT WAS MISSING, AND WHY THAT WAS NOT A REASON ────────────────────────
 * The register recorded Microsoft as un-addable because its Campaign Management API is
 * SOAP and "a ConnectorManifest cannot express it". Every OTHER thing a manifest says —
 * which host, which credentials, which operation, which fields — was always
 * transport-agnostic; only "serialize as JSON" and "parse as JSON" were REST-shaped. So
 * the runtime grew the other pair (see `connectors/soapEnvelope.ts`) and this is
 * ordinary manifest data again, with the same SSRF guard, the same sealed credentials
 * and the same audit-log row as every REST connector.
 *
 * ── THREE THINGS THAT ARE GENUINELY DIFFERENT ────────────────────────────────
 *   1. ONE URL, MANY OPERATIONS. Every Campaign Management call posts to the same
 *      `.svc` endpoint; the operation is the `SOAPAction` header and the envelope's
 *      wrapper element, not the path. So every action here shares a path and differs
 *      only in its `soap` block.
 *   2. CREDENTIALS RIDE IN THE ENVELOPE. `DeveloperToken`, `CustomerId` and
 *      `CustomerAccountId` are SOAP `<Header>` elements, not HTTP headers — and the
 *      access token appears there too, as `AuthenticationToken`, in ADDITION to the
 *      HTTP Authorization header. They are declared as templated `soap.header` entries
 *      so they stay in the same sealed credential store as every other secret.
 *   3. A DEVELOPER TOKEN IS MANDATORY. Microsoft-identity OAuth alone is not enough to
 *      reach the API at all, which is why it is a REQUIRED auth field rather than an
 *      optional one — a connection without it cannot spend, and says so before it tries.
 */

/** The Campaign Management v13 contract namespace, on every envelope. */
const MS_ADS_NS = 'https://bingads.microsoft.com/CampaignManagement/v13';

/**
 * Reporting is a DIFFERENT SERVICE on a different host with its own contract namespace.
 *
 * Microsoft splits campaign management and reporting across two subdomains that share
 * one set of credentials and one account. The per-action `baseUrl` (see
 * `ConnectorAction.baseUrl`) is what lets both live in this one manifest, rather than
 * forcing an operator to connect Microsoft Advertising twice.
 */
const MS_REPORTING_NS = 'https://bingads.microsoft.com/Reporting/v13';
const MS_REPORTING_BASE = 'https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13';

/** The four `<Header>` elements every Campaign Management call carries. */
const MS_ADS_SOAP_HEADER: Readonly<Record<string, string>> = {
  AuthenticationToken: '{{auth.token}}',
  DeveloperToken: '{{auth.developerToken}}',
  CustomerId: '{{auth.customerId}}',
  CustomerAccountId: '{{auth.adAccountId}}',
};

/** One Campaign Management operation, since only the operation name ever changes. */
const msAdsAction = (
  key: string,
  operation: string,
  label: string,
  description: string,
  mutates: boolean,
  params: ConnectorManifest['actions'][number]['params'],
): ConnectorManifest['actions'][number] => ({
  key,
  label,
  description,
  method: 'POST',
  path: '/CampaignManagementService.svc',
  mutates,
  params,
  soap: { action: operation, namespace: MS_ADS_NS, operation: `${operation}Request`, version: '1.1', header: MS_ADS_SOAP_HEADER },
  // The response wrapper is always `<OperationResponse>`; unwrapping it here keeps
  // every adapter reading the operation's own fields rather than the envelope's.
  resultPath: `${operation}Response`,
});

/** One Reporting operation. Same credentials and envelope; different service. */
const msReportAction = (
  key: string,
  operation: string,
  label: string,
  description: string,
  params: ConnectorManifest['actions'][number]['params'],
): ConnectorManifest['actions'][number] => ({
  key,
  label,
  description,
  method: 'POST',
  baseUrl: MS_REPORTING_BASE,
  path: '/ReportingService.svc',
  // Submitting a report READS delivery — it changes nothing an operator could regret,
  // so it must not sit behind the mutation confirm gate every write shares.
  mutates: false,
  params,
  soap: { action: operation, namespace: MS_REPORTING_NS, operation: `${operation}Request`, version: '1.1', header: MS_ADS_SOAP_HEADER },
  resultPath: `${operation}Response`,
});

const microsoftAds: ConnectorManifest = {
  key: 'microsoft-ads', name: 'Microsoft Advertising', category: 'marketing', icon: '⊞',
  description: 'Run and report on paid search and audience campaigns across Bing, Yahoo, DuckDuckGo and the Microsoft Audience Network.',
  baseUrl: 'https://campaign.api.bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13',
  docsUrl: 'https://learn.microsoft.com/advertising/campaign-management-service/campaign-management-service-reference',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'A Microsoft-identity token for https://ads.microsoft.com/msads.manage — the same token rides in the SOAP header as AuthenticationToken.' },
    { key: 'developerToken', label: 'Developer token', secret: true, required: true, help: 'From Microsoft Advertising — Account settings, Developer settings. The API refuses every call without it, even with a valid token.' },
    { key: 'customerId', label: 'Customer ID', secret: false, required: false, placeholder: '2500000', help: 'The Microsoft Advertising customer (manager) this account belongs to.' },
    accountField('Account ID', '10000000', 'The numeric Microsoft Advertising account the spend is billed to.'),
  ] },
  actions: [
    msAdsAction('get_campaigns', 'GetCampaignsByAccountId', 'List campaigns', 'Read Microsoft Advertising campaigns with their budgets and status.', false, {
      AccountId: bn('Numeric account id'), CampaignType: b('Space or comma list, e.g. Search Audience DynamicSearchAds'),
    }),
    msAdsAction('add_campaigns', 'AddCampaigns', 'Create campaigns', 'Create Microsoft Advertising campaigns.', true, {
      AccountId: bn('Numeric account id'), Campaigns: bo('Typed array wrapper of Campaign objects'),
    }),
    msAdsAction('update_campaigns', 'UpdateCampaigns', 'Update campaigns', 'Rename, re-budget, pause or resume Microsoft Advertising campaigns.', true, {
      AccountId: bn('Numeric account id'), Campaigns: bo('Typed array wrapper of Campaign objects carrying Id and the fields to change'),
    }),
    msAdsAction('get_ad_groups', 'GetAdGroupsByCampaignId', 'List ad groups', 'Read the ad groups inside a Microsoft Advertising campaign.', false, {
      CampaignId: bn('Parent campaign id'), ReturnAdditionalFields: b('Optional extra field set'),
    }),
    msAdsAction('add_ad_groups', 'AddAdGroups', 'Create ad groups', 'Create Microsoft Advertising ad groups inside a campaign.', true, {
      CampaignId: bn('Parent campaign id'), AdGroups: bo('Typed array wrapper of AdGroup objects'), ReturnInheritedBidStrategyTypes: { type: 'boolean', in: 'body', description: 'Return the bid strategy each ad group inherited' },
    }),
    msAdsAction('update_ad_groups', 'UpdateAdGroups', 'Update ad groups', 'Rename, re-budget, re-bid, pause or resume Microsoft Advertising ad groups.', true, {
      CampaignId: bn('Parent campaign id'), AdGroups: bo('Typed array wrapper of AdGroup objects carrying Id and the fields to change'),
    }),
    msAdsAction('get_ads', 'GetAdsByAdGroupId', 'List ads', 'Read the ads inside a Microsoft Advertising ad group.', false, {
      AdGroupId: bn('Parent ad group id'), AdTypes: bo('Typed array wrapper of AdType values, e.g. ExpandedText ResponsiveSearch'),
    }),
    msAdsAction('add_ads', 'AddAds', 'Create ads', 'Create Microsoft Advertising ads inside an ad group.', true, {
      AdGroupId: bn('Parent ad group id'), Ads: bo('Typed array wrapper of Ad objects'),
    }),
    msAdsAction('update_ads', 'UpdateAds', 'Update ads', 'Rename, pause or resume Microsoft Advertising ads.', true, {
      AdGroupId: bn('Parent ad group id'), Ads: bo('Typed array wrapper of Ad objects carrying Id and the fields to change'),
    }),
    msAdsAction('add_keywords', 'AddKeywords', 'Add keywords', 'Add the keywords a Microsoft Advertising search ad group bids on.', true, {
      AdGroupId: bn('Parent ad group id'), Keywords: bo('Typed array wrapper of Keyword objects with Text, MatchType and Bid'),
    }),
    msAdsAction('get_keywords', 'GetKeywordsByAdGroupId', 'List keywords', 'Read the keywords a Microsoft Advertising ad group bids on.', false, {
      AdGroupId: bn('Parent ad group id'),
    }),
    msAdsAction('add_ad_group_criterions', 'AddAdGroupCriterions', 'Add targeting criteria', 'Attach age, gender or device criteria to a Microsoft Advertising ad group.', true, {
      AdGroupCriterions: bo('Typed array wrapper of BiddableAdGroupCriterion objects'), CriterionType: b('Targets, Audience or a specific criterion type'),
    }),
    msAdsAction('get_ad_group_criterions', 'GetAdGroupCriterionsByIds', 'List targeting criteria', 'Read the age, gender and device criteria on a Microsoft Advertising ad group.', false, {
      AdGroupId: bn('Parent ad group id'), CriterionIds: bo('Typed array wrapper of criterion ids, omit for all'), CriterionType: b('Targets, Audience or a specific criterion type'),
    }),
    /*
     * ── REPORTING IS ASYNCHRONOUS ────────────────────────────────────────────
     * Microsoft does not answer "what did this cost" in one call. A report is
     * SUBMITTED, then POLLED until it is generated, and the result arrives as a URL to
     * a zipped CSV. All three steps are declared here so the adapter composes them
     * rather than reaching outside the connector runtime — the download included, which
     * is why `download_report` exists: fetching a vendor-supplied URL by hand would
     * bypass the SSRF guard, the credential seal and the audit-log row that every other
     * call in this system goes through.
     */
    msReportAction('submit_report', 'SubmitGenerateReport', 'Submit a report', 'Ask Microsoft Advertising to generate a spend and performance report. Returns a report request id to poll.', {
      ReportRequest: bo('A typed report request — CampaignPerformanceReportRequest with its Format, Aggregation, Columns, Scope and Time'),
    }),
    msReportAction('poll_report', 'PollGenerateReport', 'Poll a report', 'Check whether a submitted Microsoft Advertising report is ready, and get its download URL.', {
      ReportRequestId: b('The id returned by SubmitGenerateReport'),
    }),
    {
      key: 'download_report',
      label: 'Download a report',
      description: 'Fetch the generated Microsoft Advertising report archive from the URL PollGenerateReport returned.',
      method: 'GET',
      // The report lives on a storage host Microsoft names at poll time, so the WHOLE url
      // arrives per call as an `in: 'url'` param — guarded by the runtime's SSRF check on
      // the resolved url, exactly as every other call is. `path` is unused in that case,
      // and declared empty rather than left implying a join that never happens.
      path: '',
      mutates: false,
      // A zipped CSV, not a document — decoding it as text would destroy it.
      responseFormat: 'binary',
      params: { report_url: { type: 'string', in: 'url', description: 'The absolute ReportDownloadUrl from PollGenerateReport' } },
    },
  ],
};

export const ADVERTISING_CONNECTORS: readonly ConnectorManifest[] = [
  googleAds, metaAds, linkedinAds, tiktokAds, xAds, redditAds, pinterestAds, snapchatAds, microsoftAds,
];
