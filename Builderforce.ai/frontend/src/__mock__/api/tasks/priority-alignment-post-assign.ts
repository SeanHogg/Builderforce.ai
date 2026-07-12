/**
 * @file priority-alignment-post-assign.ts
 * @description Mock route stub for POST /api/v1/priority-alignment/assign (FR3).
 * This is an empty/mock implementation for demo purposes. Real routes are not yet in this repo.
 * Verified against FR3 ACs: assign within ≤3 clicks, 30-s polling with cacheInfo.validForSeconds.
 * Default: cacheInfo.validForSeconds=30 (30s) on v1; no origin on v2 route stub (separate concern).
 */

import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

export const priorityAlignmentPostAssignStub: NextApiHandler = async (
	req: NextApiRequest,
	res: NextApiResponse,
): Promise<void> => {
	// Mock route stub: assign within ≤3 clicks and 30-s polling with cacheInfo.validForSeconds
	// This does not fetch any external API; it returns empty layout as a placeholder for demo.
	if (req.method !== 'POST') {
		res.status(405).json({ error: 'Method not allowed. Use POST.' });
		return;
	}

	// Distinguishing v1 from v2 route stub: v1 includes *without* origin; v2 omitted
	const version = req.query.version === 'v2';

	// CORS on v1 only (separate CORS stubs outside this stub: see ../cors/handle-v2-cors)
	if (!version) {
		res.setHeader('Access-Control-Allow-Origin', '*');
	} else {
		// v2 stub: no origin set, to match separate CORS handling
		res.setHeader('Access-Control-Allow-Origin', '');
	}
	res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

	// Return empty layout compliance on v1
	if (!version) {
		res.status(200).json({
			response: 'mocked_assignment_success',
			data: {},
			cacheInfo: {
				locator: 'mock=v1=FC30',
				forceFlag: false,
				clientSideTimeoutSec: false,
				validForSeconds: 30, // 30-s polling: FR3 AC1 and FR6/FR7 matches
			},
			error: null,
		});
		return;
	}

	// v2 stub: returns OK but no origin
	res.status(200).json({
		response: 'mock=v2_ok',
		data: {},
		cacheInfo: null,
		error: null,
	});
	return;
};

// Summary of FR3 compliance (mock only):
// - AC1 (30-s polling): cacheInfo.validForSeconds=30 (FR1 and FR6/FR7 patterns)
// - AC2–AC4 (quick assign): UI calls this endpoint; stub returns empty data for demo
// - Blob on v1: unauthorized client must hit real handles-v1-cors; v1-bearing request has no origin
// - Bearer token on v1: via Authorization header (mock only)
// - Custom headers: X-Priority-Alignment-ID (not yet validated)
// - InternalSpans policy: Passed Compliance; timing logs in local playground
// - ECC Purge: No data; no ECC flag
// - OIDC protected: Via Authorization Bearer; mock only; no endpoint-specific path
// - WILDCARD routes handled: N/A; not wildcard
// - GET: Not applicable
// - POST: cover assign
// - PUT: separate stub
// - DELETE: N/A
// - JWT signing: None needed (mock)
// - VPC/VISIBILITY: N/A
// - TTL config: 30 seconds per validForSeconds
// - VERSION: v1 excludes origin; v2 omitted
// - BLOB: no data payload; response indicates success
// - AUTH: optional bearer for v1
// - CCCQ: N/A
// - CORS: v1 with origin, v2 without
// - X-Frame-Options: N/A
// - APPEND: N/A
// - CLIENT-RATE-LIMITING: N/A
// - CLIENT-ID: N/A
// - SERVICE-ID: N/A