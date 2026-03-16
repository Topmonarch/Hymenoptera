// api/plan.js — Server-side plan status endpoint
//
// GET  /api/plan?email=user@example.com
//   Returns the stored plan record for the user, or starter defaults if none found.
//   Response: { plan, billingStatus, messageLimit, imageLimit, videoLimit }
//
// POST /api/plan { email }
//   Same as GET but via POST body. Useful for clients that prefer POST.
//
// This endpoint is intentionally read-only. Plan writes are performed exclusively
// by the Stripe webhook handler (api/stripe-webhook.js) to keep the billing source
// of truth server-authoritative.

'use strict';

let _redis = null;
try {
  _redis = require('../lib/redis').redis;
} catch (e) {
  console.warn('api/plan: Redis unavailable:', e.message);
}

const PLAN_KEY_PREFIX = 'user_plan:';

const PLAN_LIMITS = {
  starter: { messageLimit: 30,   imageLimit: 10,   videoLimit: 10   },
  basic:   { messageLimit: 150,  imageLimit: 50,   videoLimit: 20   },
  premium: { messageLimit: 500,  imageLimit: 75,   videoLimit: 30   },
  ultimate:{ messageLimit: null, imageLimit: null, videoLimit: null  }
};

const VALID_PLANS = Object.keys(PLAN_LIMITS);

function planKey(email) {
  return `${PLAN_KEY_PREFIX}${email.toLowerCase().trim()}`;
}

async function getPlanRecord(email) {
  if (!_redis) return null;
  const raw = await _redis.command('GET', planKey(email));
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const params = req.method === 'GET' ? (req.query || {}) : (req.body || {});
  const { email } = params;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.setHeader('Content-Type', 'application/json');
    // Return starter defaults when no valid email is provided
    return res.status(200).json(buildResponse('starter', 'inactive', null));
  }

  try {
    const record = await getPlanRecord(email);
    const plan = (record && VALID_PLANS.includes(record.plan)) ? record.plan : 'starter';
    const billingStatus = (record && record.billingStatus) ? record.billingStatus : 'inactive';
    const customerId = (record && record.customerId) ? record.customerId : null;

    console.log(`api/plan: email=${email} plan=${plan} status=${billingStatus}`);

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(buildResponse(plan, billingStatus, customerId));
  } catch (err) {
    console.warn('api/plan: failed to retrieve plan:', err.message);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(buildResponse('starter', 'inactive', null));
  }
};

function buildResponse(plan, billingStatus, customerId) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  return {
    plan,
    billingStatus,
    customerId,
    messageLimit: limits.messageLimit,
    imageLimit:   limits.imageLimit,
    videoLimit:   limits.videoLimit
  };
}
