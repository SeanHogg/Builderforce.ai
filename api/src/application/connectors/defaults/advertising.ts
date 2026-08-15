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
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read LinkedIn campaigns with their budgets, bids and status.', method: 'GET', path: '/adAccounts/{account_id}/adCampaigns', mutates: false, required: ['account_id'], resultPath: 'elements', params: { account_id: p('Numeric sponsored account id'), q: q('Finder name', { default: 'search' }), search: q('URL-encoded search criteria'), count: qn('Page size'), start: qn('Page offset') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create a LinkedIn campaign. Spends once it is ACTIVE and has creatives.', method: 'POST', path: '/adAccounts/{account_id}/adCampaigns', mutates: true, required: ['account_id', 'name'], params: {
      account_id: p('Numeric sponsored account id'), name: b('Campaign name'), campaignGroup: b('Campaign group URN'), account: b('Account URN, e.g. urn:li:sponsoredAccount:512345678'), type: b('SPONSORED_UPDATES, TEXT_AD, SPONSORED_INMAILS or DYNAMIC'), objectiveType: b('BRAND_AWARENESS, WEBSITE_VISITS, LEAD_GENERATION, WEBSITE_CONVERSIONS and similar'), status: b('ACTIVE, PAUSED or DRAFT', { default: 'DRAFT' }), costType: b('CPM, CPC or CPV'), dailyBudget: bo('Amount object with currencyCode and amount as a decimal string'), totalBudget: bo('Amount object with currencyCode and amount as a decimal string'), unitCost: bo('Bid amount object'), locale: bo('Campaign locale, e.g. {"country":"US","language":"en"}'), targetingCriteria: bo('Include/exclude facet tree'), runSchedule: bo('Start and end times in epoch milliseconds'),
    } },
    { key: 'update_campaign', label: 'Update campaign', description: 'Re-budget, re-bid, pause or resume a LinkedIn campaign.', method: 'POST', path: '/adAccounts/{account_id}/adCampaigns/{campaign_id}', mutates: true, required: ['account_id', 'campaign_id', 'patch'], headers: { 'X-RestLi-Method': 'PARTIAL_UPDATE' }, params: { account_id: p('Numeric sponsored account id'), campaign_id: p('Numeric campaign id'), patch: bo('Patch document, e.g. {"$set":{"status":"PAUSED"}}') } },
    { key: 'list_creatives', label: 'List creatives', description: 'Read the creatives running in the account.', method: 'GET', path: '/adAccounts/{account_id}/creatives', mutates: false, required: ['account_id'], resultPath: 'elements', params: { account_id: p('Numeric sponsored account id'), q: q('Finder name', { default: 'criteria' }), campaigns: q('URL-encoded list of campaign URNs'), count: qn('Page size') } },
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
    { key: 'list_advertisers', label: 'List advertiser accounts', description: 'List the TikTok advertiser accounts this token can spend on.', method: 'GET', path: '/oauth2/advertiser/get/', mutates: false, resultPath: 'data.list', params: { app_id: q('TikTok app id'), secret: q('TikTok app secret') } },
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read TikTok campaigns with their budgets and status.', method: 'GET', path: '/campaign/get/', mutates: false, required: ['advertiser_id'], resultPath: 'data.list', params: { advertiser_id: q('Advertiser id'), filtering: q('JSON filter object'), page: qn('Page number'), page_size: qn('Rows per page, up to 1000') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create a TikTok paid campaign.', method: 'POST', path: '/campaign/create/', mutates: true, required: ['advertiser_id', 'campaign_name', 'objective_type'], resultPath: 'data', params: { advertiser_id: b('Advertiser id'), campaign_name: b('Campaign name'), objective_type: b('TRAFFIC, CONVERSIONS, REACH, VIDEO_VIEWS, LEAD_GENERATION and similar'), budget_mode: b('BUDGET_MODE_DAY, BUDGET_MODE_TOTAL or BUDGET_MODE_INFINITE'), budget: bn('Budget in the account currency major unit'), operation_status: b('ENABLE or DISABLE', { default: 'DISABLE' }), special_industries: ba('Required declaration for regulated categories') } },
    { key: 'update_campaign', label: 'Update campaign', description: 'Rename or re-budget a TikTok campaign.', method: 'POST', path: '/campaign/update/', mutates: true, required: ['advertiser_id', 'campaign_id'], resultPath: 'data', params: { advertiser_id: b('Advertiser id'), campaign_id: b('Campaign id'), campaign_name: b('New campaign name'), budget: bn('Budget in the account currency major unit'), budget_mode: b('BUDGET_MODE_DAY or BUDGET_MODE_TOTAL') } },
    { key: 'update_campaign_status', label: 'Pause or resume campaigns', description: 'Enable, disable or delete TikTok campaigns.', method: 'POST', path: '/campaign/status/update/', mutates: true, required: ['advertiser_id', 'campaign_ids', 'operation_status'], resultPath: 'data', params: { advertiser_id: b('Advertiser id'), campaign_ids: ba('Campaign ids to change'), operation_status: b('ENABLE, DISABLE or DELETE') } },
    { key: 'list_adgroups', label: 'List ad groups', description: 'Read TikTok ad groups with their targeting, bids and budgets.', method: 'GET', path: '/adgroup/get/', mutates: false, required: ['advertiser_id'], resultPath: 'data.list', params: { advertiser_id: q('Advertiser id'), filtering: q('JSON filter object'), page: qn('Page number'), page_size: qn('Rows per page') } },
    { key: 'create_adgroup', label: 'Create ad group', description: 'Create a TikTok targeting and budget group inside a campaign.', method: 'POST', path: '/adgroup/create/', mutates: true, required: ['advertiser_id', 'campaign_id', 'adgroup_name'], resultPath: 'data', params: { advertiser_id: b('Advertiser id'), campaign_id: b('Parent campaign id'), adgroup_name: b('Ad group name'), promotion_type: b('WEBSITE, APP_ANDROID, APP_IOS or LEAD_GENERATION'), placement_type: b('PLACEMENT_TYPE_AUTOMATIC or PLACEMENT_TYPE_NORMAL'), budget_mode: b('BUDGET_MODE_DAY or BUDGET_MODE_TOTAL'), budget: bn('Budget in the account currency major unit'), schedule_type: b('SCHEDULE_FROM_NOW or SCHEDULE_START_END'), schedule_start_time: b('Start time as YYYY-MM-DD HH:MM:SS'), schedule_end_time: b('End time as YYYY-MM-DD HH:MM:SS'), optimization_goal: b('CLICK, CONVERT, REACH, LEAD_GENERATION and similar'), bid_type: b('BID_TYPE_NO_BID or BID_TYPE_CUSTOM'), bid_price: bn('Bid in the account currency major unit'), billing_event: b('CPC, CPM or OCPM'), location_ids: ba('Target location ids'), operation_status: b('ENABLE or DISABLE', { default: 'DISABLE' }) } },
    { key: 'get_report', label: 'Get report', description: 'Read TikTok spend, impressions, clicks and conversions over a date range.', method: 'GET', path: '/report/integrated/get/', mutates: false, required: ['advertiser_id', 'report_type', 'data_level'], resultPath: 'data.list', params: { advertiser_id: q('Advertiser id'), report_type: q('BASIC or AUDIENCE'), data_level: q('AUCTION_CAMPAIGN, AUCTION_ADGROUP or AUCTION_AD'), dimensions: q('JSON array, e.g. ["campaign_id","stat_time_day"]'), metrics: q('JSON array, e.g. ["spend","impressions","clicks","conversion"]'), start_date: q('YYYY-MM-DD'), end_date: q('YYYY-MM-DD'), page: qn('Page number'), page_size: qn('Rows per page') } },
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
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read X campaigns with their budgets and status.', method: 'GET', path: '/accounts/{account_id}/campaigns', mutates: false, required: ['account_id'], resultPath: 'data', params: { account_id: p('X ads account id'), campaign_ids: q('Comma list of campaign ids'), count: qn('Page size'), cursor: q('Pagination cursor'), with_deleted: q('true to include deleted campaigns') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create an X paid campaign against a funding instrument.', method: 'POST', path: '/accounts/{account_id}/campaigns', mutates: true, required: ['account_id', 'name', 'funding_instrument_id'], resultPath: 'data', params: { account_id: p('X ads account id'), name: b('Campaign name'), funding_instrument_id: b('Funding instrument the spend bills to'), daily_budget_amount_local_micro: bn('Daily budget in micros of the account currency'), total_budget_amount_local_micro: bn('Total budget in micros of the account currency'), entity_status: b('ACTIVE or PAUSED', { default: 'PAUSED' }), start_time: b('ISO 8601 start'), end_time: b('ISO 8601 end') } },
    { key: 'update_campaign', label: 'Update campaign', description: 'Re-budget, pause or resume an X campaign.', method: 'PUT', path: '/accounts/{account_id}/campaigns/{campaign_id}', mutates: true, required: ['account_id', 'campaign_id'], resultPath: 'data', params: { account_id: p('X ads account id'), campaign_id: p('Campaign id'), name: b('New campaign name'), entity_status: b('ACTIVE or PAUSED'), daily_budget_amount_local_micro: bn('Daily budget in micros of the account currency'), total_budget_amount_local_micro: bn('Total budget in micros of the account currency') } },
    { key: 'list_line_items', label: 'List line items', description: 'Read the bid and targeting groups inside X campaigns.', method: 'GET', path: '/accounts/{account_id}/line_items', mutates: false, required: ['account_id'], resultPath: 'data', params: { account_id: p('X ads account id'), campaign_ids: q('Comma list of campaign ids'), count: qn('Page size'), cursor: q('Pagination cursor') } },
    { key: 'create_line_item', label: 'Create line item', description: 'Create a bid and targeting group inside an X campaign.', method: 'POST', path: '/accounts/{account_id}/line_items', mutates: true, required: ['account_id', 'campaign_id', 'objective', 'product_type'], resultPath: 'data', params: { account_id: p('X ads account id'), campaign_id: b('Parent campaign id'), name: b('Line item name'), objective: b('WEBSITE_CLICKS, ENGAGEMENTS, VIDEO_VIEWS, REACH and similar'), product_type: b('PROMOTED_TWEETS or MEDIA'), placements: ba('Placements, e.g. ["ALL_ON_TWITTER"]'), bid_amount_local_micro: bn('Bid in micros of the account currency'), entity_status: b('ACTIVE or PAUSED', { default: 'PAUSED' }) } },
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
    { key: 'get_stats', label: 'Get stats', description: 'Read Snapchat spend, impressions, swipes and conversions over a date range.', method: 'GET', path: '/campaigns/{campaign_id}/stats', mutates: false, required: ['campaign_id'], resultPath: 'timeseries_stats', params: { campaign_id: p('Snapchat campaign id'), granularity: q('DAY, HOUR, LIFETIME or TOTAL'), start_time: q('ISO 8601 start, aligned to the account timezone'), end_time: q('ISO 8601 end'), fields: q('Comma list such as spend,impressions,swipes,conversion_purchases') } },
  ],
};

export const ADVERTISING_CONNECTORS: readonly ConnectorManifest[] = [
  googleAds, metaAds, linkedinAds, tiktokAds, xAds, redditAds, pinterestAds, snapchatAds,
];
