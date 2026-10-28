// Mock data for a made-up plant shop. Every name and number here is invented.
// Post times are relative to "now", so the calendar always has upcoming posts.

import type { Channel, ChannelResult, Post, Workspace } from './scheduling-api.js';

/** The Sketchpad account the shop connected in the app. */
export const CONNECTED_SKETCHPAD_ACCOUNT = 'moss-and-fern';

const channels: Channel[] = [
  { id: 'ch_instagram', network: 'Instagram', name: 'Moss & Fern (Instagram)' },
  { id: 'ch_linkedin', network: 'LinkedIn', name: 'Moss & Fern (LinkedIn page)' },
  { id: 'ch_bluesky', network: 'Bluesky', name: 'Moss & Fern (Bluesky)' },
];

export const workspace: Workspace = {
  name: 'Moss & Fern',
  timeZone: 'America/New_York',
  channels,
};

/** A UTC time `days` days from the start of today (UTC), at hour:minute. */
function dayAt(now: Date, days: number, hour: number, minute = 0) {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hour, minute),
  );
  return date.toISOString();
}

export function createSeedPosts(now: Date): Post[] {
  return [
    {
      id: 'post_001',
      status: 'published',
      time: dayAt(now, -40, 15),
      channelIds: ['ch_instagram'],
      text: 'Fresh shipment: 40 Boston ferns arrived this morning. They like bright, indirect light and a weekly mist. Come early for the fullest ones.',
    },
    {
      id: 'post_002',
      status: 'published',
      time: dayAt(now, -20, 14, 30),
      channelIds: ['ch_linkedin'],
      text: 'We are hiring a part-time shop assistant for weekends. You will water, repot and help customers choose plants that fit their homes. No experience needed, only patience and curiosity.',
    },
    {
      id: 'post_003',
      status: 'published',
      time: dayAt(now, -9, 16),
      channelIds: ['ch_instagram', 'ch_bluesky'],
      text: 'Monstera cuttings are back in stock. Each one has at least two leaves and a healthy root. Bring a jar from home and get 10% off.',
    },
    {
      id: 'post_004',
      status: 'published',
      time: dayAt(now, -5, 13),
      channelIds: ['ch_linkedin'],
      text: 'A note from a small business: every plant we sell now grows in peat-free soil. It took us six months of testing to find a mix that works. Here is what we learned.',
    },
    {
      id: 'post_005',
      status: 'published',
      time: dayAt(now, -2, 15, 30),
      channelIds: ['ch_instagram'],
      text: 'Three signs your fern needs more humidity: brown tips, crispy edges and dropped fronds. A pebble tray fixes all three.',
    },
    {
      id: 'post_006',
      status: 'published',
      time: dayAt(now, -1, 17),
      channelIds: ['ch_bluesky'],
      text: 'Rainy day at the shop. The kettle is on and the calatheas look happy. Open until 5 pm.',
    },
    {
      id: 'post_007',
      status: 'scheduled',
      time: dayAt(now, 1, 14),
      channelIds: ['ch_instagram', 'ch_linkedin'],
      text: 'Our autumn repotting workshop is coming up. Bring one plant, leave with a new pot and the know-how to keep it thriving. Ten seats left.',
    },
    {
      id: 'post_008',
      status: 'scheduled',
      time: dayAt(now, 3, 16),
      channelIds: ['ch_bluesky'],
      text: 'Plant clinic this week: bring a sad plant and our staff will tell you what it needs. Free, no booking.',
    },
    {
      id: 'post_009',
      status: 'scheduled',
      time: dayAt(now, 6, 15),
      channelIds: ['ch_instagram'],
      text: 'Staff pick of the week: the ZZ plant. It forgives missed waterings and low light, so it is a good first plant for an office.',
    },
    {
      id: 'post_010',
      status: 'scheduled',
      time: dayAt(now, 10, 14),
      channelIds: ['ch_linkedin'],
      text: 'We now deliver office plants with a monthly care visit. Ask us for a quote for your team.',
    },
    {
      id: 'post_011',
      status: 'scheduled',
      time: dayAt(now, 20, 15),
      channelIds: ['ch_instagram', 'ch_bluesky'],
      text: 'Holiday gift cards are here. Choose any amount, and we add a free guide to growing plants from cuttings.',
    },
    {
      id: 'post_012',
      status: 'draft',
      time: null,
      channelIds: [],
      text: 'Idea: a photo series of customer plants, one year after they left the shop.',
    },
    {
      id: 'post_013',
      status: 'draft',
      time: null,
      channelIds: ['ch_bluesky'],
      text: 'Five houseplants that are safe for cats. A short thread.',
    },
  ];
}

// Results for the published posts. Bluesky does not report impressions, and the
// newest posts have numbers that the networks have not reported yet.
export const seedResults: Record<string, ChannelResult[]> = {
  post_001: [
    { channelId: 'ch_instagram', impressions: 5210, likes: 412, comments: 37, shares: 18 },
  ],
  post_002: [{ channelId: 'ch_linkedin', impressions: 3890, likes: 96, comments: 14, shares: 9 }],
  post_003: [
    { channelId: 'ch_instagram', impressions: 2740, likes: 231, comments: 19, shares: 11 },
    { channelId: 'ch_bluesky', impressions: null, likes: 58, comments: 6, shares: 12 },
  ],
  post_004: [{ channelId: 'ch_linkedin', impressions: 1975, likes: 64, comments: 8, shares: 5 }],
  post_005: [
    { channelId: 'ch_instagram', impressions: 1420, likes: 118, comments: null, shares: null },
  ],
  post_006: [{ channelId: 'ch_bluesky', impressions: null, likes: 21, comments: 3, shares: null }],
};

/** Sketchpad designs. One belongs to another account, so the connected account cannot read it. */
export function createSeedDesigns(now: Date) {
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  return [
    { id: 'SPfernCare1', title: 'Fern care in 3 slides', kind: 'image' as const, pageCount: 3, updatedAt: twoDaysAgo, owner: CONNECTED_SKETCHPAD_ACCOUNT },
    { id: 'SPwinterSal', title: 'Winter sale catalog', kind: 'image' as const, pageCount: 14, updatedAt: twoDaysAgo, owner: CONNECTED_SKETCHPAD_ACCOUNT },
    { id: 'SPrepotReel', title: 'Repotting in 30 seconds', kind: 'video' as const, pageCount: 1, updatedAt: twoDaysAgo, owner: CONNECTED_SKETCHPAD_ACCOUNT },
    { id: 'SPotherAcct', title: 'A poster in another account', kind: 'image' as const, pageCount: 1, updatedAt: twoDaysAgo, owner: 'someone-else' },
  ];
}
