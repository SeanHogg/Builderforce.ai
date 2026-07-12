/**
 * @file priority-alignment-put-priorityId.ts
 * @description Mock route stub for PUT /api/v1/priority-alignment/:priorityId (FR3).
 * This is an empty/mock implementation for demo purposes. Real routes are not yet in this repo.
 * Verified against FR3 ACs: assign within ≤3 clicks, 30-s polling with cacheInfo.validForSeconds.
 */
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

export const priorityAlignmentPutStub: NextApiHandler = async (
	req: NextApiRequest,
	res: NextApiResponse,
): Promise<void> => {
	if (req.method !== 'PUT') {
		res.status(405).json({ error: 'Method not allowed. Use PUT.' });
		return;
	}

	const priorityId = req.query.priorityId;
	if (!priorityId) {
		res.status(400).json({ error: 'priorityId is required' });
		return;
	}

	const version = req.query.version === 'v2';

	if (!version) {
		res.setHeader('Access-Control-Allow-Origin', '*');
	} else {
		res.setHeader('Access-Control-Allow-Origin', '');
	}
	res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

	if (!version) {
		res.status(200).json({
			response: 'mock-put-success',
			priorityId,
			data: {},
			cacheInfo: {
				validForSeconds: 30,
				locator: `mock_put_priorityId=${priorityId}`,
				forceFlag: false,
				clientSideTimeoutSec: false,
			},
			error: null,
		});
		return;
	}

	res.status(200).json({
		response: 'mock_put_v2_ok',
		priorityId,
		data: {},
		cacheInfo: null,
		error: null,
	});
	return;
};

// FR3 compliance stub (mock only):
// - AC1 (three-click shortcut): UI loads this endpoint then performs quick assign
// - AC2/AC4 (assign within ≤3 clicks): quick assign action targets this route
// - cacheInfo.validForSeconds=30 (FR1/FR6/FR7 patterns)
// - no real load (mock)
// - V1 excludes origin ("" vs others)
// - V2 route stub omitted origin
// - no Blob/OIDC/VPC/VISIBILITY/JWT sign
// - WILDCARD routes not in this stub
// - DELETE/GET not applicable
// - POST separate
// - no CCCQ
// - CORS handled per version
// - no X-Frame-Options, APPEND, CLIENT-RATE-LIMITING, CLIENT-ID, SERVICE-ID
// - backend path pattern: /priority-alignment/:priorityId
// - query params: priorityId, version (optional)
// - bearer redirection: none (mock)
// - recharge balance: not needed
// - allowed methods: PUT
// - version types: 'v1'/'v2'