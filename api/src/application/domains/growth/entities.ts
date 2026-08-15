/**
 * Growth & marketing entities — owned by the **CMO** (PRD 20 §3.2, migration 0432).
 *
 * The largest domain in the roster, and the one PRD 19 §2 assembled from all
 * three products: hired.video's feed, boosts and creator content; BurnRateOS's
 * ad manager and journeys; Builderforce's campaigns and landing pages.
 *
 * `email_campaigns` carries the `kind` column §3.3 adjudicated — a nurture send,
 * a newsletter and a recruiter sequence blast are one shape with three kinds —
 * which is why one campaign entity appears here instead of three.
 */
import {
  abTestSegments,
  abTestVariants,
  abTests,
  activityFeed,
  adCampaigns,
  adInsights,
  adSets,
  ads,
  affiliateReferrals,
  announcementBanners,
  blogPosts,
  boostCheckouts,
  boosts,
  brandKits,
  contentAudiences,
  contentLocations,
  creatorYoutubeIngests,
  customerJourneys,
  embedWidgetLayout,
  emailCampaigns,
  employerBrandingPages,
  eventCategories,
  eventMatchmaking,
  eventRemindersSent,
  eventWaitlist,
  experiments,
  feedFeatures,
  feedPosts,
  followUpEnrollments,
  journeyTouchpoints,
  landingPageBlocks,
  landingPages,
  learnVideos,
  marketingContentItems,
  marketingEmails,
  marketingHeatmapPages,
  marketingHeatmapScreenshots,
  marketingLeads,
  marketingSessionPrompts,
  marketingSeoPages,
  nurtureFlows,
  pageEmbedVideos,
  podcastOutreach,
  promoProjects,
  referralEntries,
  siteReleases,
  siteSubscriptions,
  siteUserSessions,
  siteUsers,
  socialCampaignPosts,
  socialCampaigns,
  videos,
  waitlistEntries,
  websitePages,
} from '../../../infrastructure/database/schema/growth';
import { defineDomainEntities, entity } from '../entityDefinition';

export const GROWTH_ENTITIES = defineDomainEntities('growth', [
  entity(emailCampaigns, { kind: 'campaign', registers: true }),
  entity(landingPages, { kind: 'landing_page', registers: true }),
  entity(blogPosts, { kind: 'blog_post', registers: true }),
  entity(marketingLeads, { kind: 'lead', registers: true }),
  entity(experiments, { kind: 'experiment', registers: true }),
  marketingEmails,
  nurtureFlows,
  followUpEnrollments,
  customerJourneys,
  journeyTouchpoints,
  waitlistEntries,
  referralEntries,
  podcastOutreach,
  adCampaigns,
  adSets,
  ads,
  boosts,
  abTests,
  abTestVariants,
  abTestSegments,
  landingPageBlocks,
  websitePages,
  marketingSeoPages,
  employerBrandingPages,
  announcementBanners,
  embedWidgetLayout,
  marketingHeatmapPages,
  brandKits,
  marketingContentItems,
  videos,
  learnVideos,
  pageEmbedVideos,
  creatorYoutubeIngests,
  contentAudiences,
  contentLocations,
  feedPosts,
  feedFeatures,
  eventCategories,
  eventWaitlist,
  eventMatchmaking,
  promoProjects,
  /** A campaign published to the workspace's own social accounts. Authored like
   *  any other campaign, so it is writable like any other campaign — the
   *  counters it also carries are stamped by the publish sweep, and `id`,
   *  tenancy and the timestamps are never writable anywhere. */
  socialCampaigns,
  /** Settled money — a boost is paid for before it runs (§5 step 3 narrowed both
   *  checkout tables to order satellites). */
  entity(boostCheckouts, { readOnly: true }),
  /** An affiliate referral is what the ledger pays a commission against. */
  entity(affiliateReferrals, { readOnly: true }),
  /** Observations and sends: captured by a sweep, not authored. */
  entity(activityFeed, { readOnly: true }),
  /** Delivery read back from the ad networks by the `ad-insights` sweep — restated by
   *  the networks themselves, so never writable from a seat surface. */
  entity(adInsights, { readOnly: true }),
  /** What went out, to which account, under which permalink. The same rule the
   *  email ledger keeps: editing a delivery record would rewrite what the world
   *  already saw, and the retry counter that bounds a requeue is only sound
   *  while the publisher is its single writer. */
  entity(socialCampaignPosts, { readOnly: true }),
  /** A published build, kept so a worse one can be rolled back. Written by the
   *  publish path; `project_sites.r2_prefix` is the pointer to the current one,
   *  so a hand-edited release row would point serving at a build nobody chose. */
  entity(siteReleases, { readOnly: true }),
  /** END USERS of a generated app — a separate identity space from `users`, and
   *  the reason it is read-only here: a generic PATCH over an identity table is
   *  an account takeover in the app the tenant shipped. Sign-up and sign-in own
   *  these rows; a seat surface reads them. */
  entity(siteUsers, { readOnly: true }),
  entity(siteUserSessions, { readOnly: true }),
  /** What an end user of a generated app is PAYING for. Read-only for the same
   *  reason `purchase_orders` is: a generic PATCH over a subscription row hands
   *  out paid access for free, and the billing webhook that moves `status` and
   *  `current_period_end` is only sound while it is the single writer. */
  entity(siteSubscriptions, { readOnly: true }),
  entity(marketingSessionPrompts, { readOnly: true }),
  entity(marketingHeatmapScreenshots, { readOnly: true }),
  entity(eventRemindersSent, { readOnly: true }),
]);
