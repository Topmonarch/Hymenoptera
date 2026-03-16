// api/stripe-webhook.js — Stripe webhook handler for plan activation
//
// Listens for Stripe billing events and reliably activates the correct
// Hymenoptera plan on the user account stored in Redis.
//
// Required environment variables:
//   STRIPE_SECRET_KEY        — Stripe secret API key
//   STRIPE_WEBHOOK_SECRET    — Stripe webhook signing secret (whsec_...)
//   UPSTASH_REDIS_REST_URL   — Upstash Redis REST base URL
//   UPSTASH_REDIS_REST_TOKEN — Upstash Redis REST token
//
// Optional price-ID mapping (falls back to metadata/description detection):
//   STRIPE_PRICE_BASIC        — Stripe price ID for the Basic plan
//   STRIPE_PRICE_PREMIUM      — Stripe price ID for the Premium plan
//   STRIPE_PRICE_ULTIMATE     — Stripe price ID for the Ultimate plan

'use strict';

let _redis = null;
try {
  _redis = require('../lib/redis').redis;
} catch (e) {
  console.warn('stripe-webhook: Redis unavailable:', e.message);
}

// Redis key prefix for user plan records
const PLAN_KEY_PREFIX = 'user_plan:';

// TTL of 400 days — plan records must outlive any annual billing cycle (365 days)
// and survive a brief lapse in renewal. 400 days provides a safe margin.
const PLAN_TTL_SECONDS = 400 * 24 * 60 * 60;

/**
 * Canonical Hymenoptera plan names.
 */
const VALID_PLANS = ['starter', 'basic', 'premium', 'ultimate'];

/**
 * Build the Redis key for a user plan record.
 * @param {string} email
 * @returns {string}
 */
function planKey(email) {
  return `${PLAN_KEY_PREFIX}${email.toLowerCase().trim()}`;
}

/**
 * Persist a plan record for a user in Redis.
 * @param {string} email
 * @param {{ plan: string, billingStatus: string, customerId?: string, subscriptionId?: string }} record
 */
async function savePlanRecord(email, record) {
  if (!_redis) throw new Error('Redis not configured');
  const key = planKey(email);
  await _redis.command('SET', key, JSON.stringify(record), 'EX', String(PLAN_TTL_SECONDS));
}

/**
 * Retrieve a plan record for a user from Redis.
 * @param {string} email
 * @returns {Promise<object|null>}
 */
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

/**
 * Map a Stripe price ID to a Hymenoptera plan name.
 * Checks environment-variable overrides first, then falls back to
 * name/description-based detection so the mapping works even before
 * the Stripe Dashboard price IDs have been added to the environment.
 *
 * @param {string} priceId
 * @param {string} [productName] — Stripe product name (optional)
 * @returns {string|null} plan name or null if unknown
 */
function mapPriceIdToPlan(priceId, productName) {
  // 1. Exact price-ID matches via environment variables
  if (process.env.STRIPE_PRICE_BASIC    && priceId === process.env.STRIPE_PRICE_BASIC)    return 'basic';
  if (process.env.STRIPE_PRICE_PREMIUM  && priceId === process.env.STRIPE_PRICE_PREMIUM)  return 'premium';
  if (process.env.STRIPE_PRICE_ULTIMATE && priceId === process.env.STRIPE_PRICE_ULTIMATE) return 'ultimate';

  // 2. Fall back to product-name keyword detection (case-insensitive)
  const name = (productName || '').toLowerCase();
  if (name.includes('ultimate')) return 'ultimate';
  if (name.includes('premium'))  return 'premium';
  if (name.includes('basic'))    return 'basic';

  return null;
}

/**
 * Determine the Hymenoptera plan from a Stripe checkout session or subscription.
 * Checks (in order): session metadata, line-item price IDs.
 *
 * @param {object} stripe — authenticated Stripe client
 * @param {object} session — checkout.session object
 * @returns {Promise<string|null>}
 */
async function resolvePlanFromSession(stripe, session) {
  // 1. Explicit plan in session metadata (highest priority)
  if (session.metadata && session.metadata.plan) {
    const meta = session.metadata.plan.toLowerCase();
    if (VALID_PLANS.includes(meta)) {
      console.log(`stripe-webhook: plan from session metadata = ${meta}`);
      return meta;
    }
  }

  // 2. Expand line items and map by price ID + product name
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ['data.price.product'],
      limit: 5
    });

    for (const item of (lineItems.data || [])) {
      const price = item.price || {};
      const product = price.product || {};
      const productName = typeof product === 'object' ? (product.name || '') : '';
      const priceId = price.id || '';
      const plan = mapPriceIdToPlan(priceId, productName);
      if (plan) {
        console.log(`stripe-webhook: price ${priceId} (${productName}) mapped to plan = ${plan}`);
        return plan;
      }
    }
  } catch (err) {
    console.warn('stripe-webhook: failed to list line items:', err.message);
  }

  return null;
}

/**
 * Determine the Hymenoptera plan from a Stripe subscription object.
 *
 * @param {object} stripe — authenticated Stripe client
 * @param {object} subscription — subscription object
 * @returns {Promise<string|null>}
 */
async function resolvePlanFromSubscription(stripe, subscription) {
  // 1. Subscription metadata
  if (subscription.metadata && subscription.metadata.plan) {
    const meta = subscription.metadata.plan.toLowerCase();
    if (VALID_PLANS.includes(meta)) {
      console.log(`stripe-webhook: plan from subscription metadata = ${meta}`);
      return meta;
    }
  }

  // 2. Iterate subscription items
  const items = (subscription.items && subscription.items.data) || [];
  for (const item of items) {
    const price = item.price || {};
    let productName = '';
    if (price.product && typeof price.product === 'string') {
      try {
        const prod = await stripe.products.retrieve(price.product);
        productName = prod.name || '';
      } catch (e) {
        // non-fatal
      }
    } else if (price.product && typeof price.product === 'object') {
      productName = price.product.name || '';
    }
    const plan = mapPriceIdToPlan(price.id || '', productName);
    if (plan) {
      console.log(`stripe-webhook: subscription price ${price.id} (${productName}) mapped to plan = ${plan}`);
      return plan;
    }
  }

  return null;
}

/**
 * Retrieve the customer email from a Stripe event object, fetching the full
 * customer record if necessary.
 *
 * @param {object} stripe — authenticated Stripe client
 * @param {object} obj — Stripe event data object (session or subscription)
 * @returns {Promise<string|null>}
 */
async function resolveCustomerEmail(stripe, obj) {
  // Direct email on the session
  if (obj.customer_email) return obj.customer_email.toLowerCase().trim();

  // Customer object already expanded
  if (obj.customer && typeof obj.customer === 'object' && obj.customer.email) {
    return obj.customer.email.toLowerCase().trim();
  }

  // Fetch customer by ID
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;
  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer && customer.email) return customer.email.toLowerCase().trim();
    } catch (err) {
      console.warn('stripe-webhook: failed to retrieve customer:', err.message);
    }
  }

  return null;
}

/**
 * Main serverless handler.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey) {
    console.error('stripe-webhook: STRIPE_SECRET_KEY not configured');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  // ── Construct and verify the Stripe event ─────────────────────────────────
  let event;
  try {
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    console.log('stripe-webhook: webhook received');

    if (webhookSecret) {
      // Collect the raw body; Vercel/Express may have parsed it already
      let rawBody = req.body;
      if (typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)) {
        // Already parsed — reconstruct from the raw request if available
        rawBody = req.rawBody || JSON.stringify(rawBody);
      }
      const sig = req.headers['stripe-signature'];
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        console.log('stripe-webhook: signature verified, event =', event.type);
      } catch (err) {
        console.error('stripe-webhook: signature verification failed:', err.message);
        return res.status(400).json({ error: 'Webhook signature verification failed' });
      }
    } else {
      // No secret configured — parse manually (dev/testing only)
      console.warn('stripe-webhook: STRIPE_WEBHOOK_SECRET not set — skipping signature check');
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      event = body;
    }

    // ── Handle relevant event types ─────────────────────────────────────────
    const eventType = event.type || '';
    const dataObj   = event.data && event.data.object;

    if (eventType === 'checkout.session.completed') {
      await handleCheckoutSessionCompleted(stripe, dataObj);
    } else if (
      eventType === 'customer.subscription.created' ||
      eventType === 'customer.subscription.updated'
    ) {
      await handleSubscriptionActivated(stripe, dataObj);
    } else if (eventType === 'customer.subscription.deleted') {
      await handleSubscriptionDeleted(stripe, dataObj);
    } else {
      // Other events are intentionally ignored
      console.log(`stripe-webhook: ignoring event type ${eventType}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('stripe-webhook: unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal webhook error' });
  }
};

// ── Event handlers ───────────────────────────────────────────────────────────

async function handleCheckoutSessionCompleted(stripe, session) {
  if (!session) return;
  if (session.payment_status !== 'paid') {
    console.log('stripe-webhook: checkout session not paid — skipping', session.payment_status);
    return;
  }

  const email = await resolveCustomerEmail(stripe, session);
  if (!email) {
    console.error('stripe-webhook: checkout.session.completed — could not resolve customer email');
    return;
  }
  console.log('stripe-webhook: customer email identified:', email);

  const plan = await resolvePlanFromSession(stripe, session);
  if (!plan) {
    console.error('stripe-webhook: checkout.session.completed — could not map session to plan', {
      sessionId: session.id,
      lineItemsPrices: 'see logs above'
    });
    return;
  }
  console.log(`stripe-webhook: plan resolved = ${plan} for ${email}`);

  await activatePlan(email, plan, {
    customerId: typeof session.customer === 'string' ? session.customer : null,
    subscriptionId: typeof session.subscription === 'string' ? session.subscription : null
  });
}

async function handleSubscriptionActivated(stripe, subscription) {
  if (!subscription) return;
  const status = subscription.status;
  const activeStatuses = ['active', 'trialing'];
  if (!activeStatuses.includes(status)) {
    console.log(`stripe-webhook: subscription status ${status} — not activating plan`);
    return;
  }

  const email = await resolveCustomerEmail(stripe, subscription);
  if (!email) {
    console.error('stripe-webhook: subscription event — could not resolve customer email');
    return;
  }
  console.log('stripe-webhook: customer email identified:', email);

  const plan = await resolvePlanFromSubscription(stripe, subscription);
  if (!plan) {
    console.error('stripe-webhook: subscription event — could not map to plan', {
      subscriptionId: subscription.id
    });
    return;
  }
  console.log(`stripe-webhook: plan resolved = ${plan} for ${email}`);

  await activatePlan(email, plan, {
    customerId: typeof subscription.customer === 'string' ? subscription.customer : null,
    subscriptionId: subscription.id
  });
}

async function handleSubscriptionDeleted(stripe, subscription) {
  if (!subscription) return;

  const email = await resolveCustomerEmail(stripe, subscription);
  if (!email) {
    console.error('stripe-webhook: subscription.deleted — could not resolve customer email');
    return;
  }
  console.log('stripe-webhook: subscription cancelled for:', email);

  // Downgrade to starter on cancellation
  await activatePlan(email, 'starter', {
    customerId: typeof subscription.customer === 'string' ? subscription.customer : null,
    subscriptionId: subscription.id,
    billingStatus: 'cancelled'
  });
}

/**
 * Persist the plan activation to Redis and log the result.
 *
 * @param {string} email
 * @param {string} plan
 * @param {{ customerId?: string, subscriptionId?: string, billingStatus?: string }} opts
 */
async function activatePlan(email, plan, opts = {}) {
  const record = {
    plan,
    billingStatus: opts.billingStatus || 'active',
    customerId:    opts.customerId    || null,
    subscriptionId: opts.subscriptionId || null,
    updatedAt:     new Date().toISOString()
  };

  try {
    // Idempotency guard: only write if the plan is different or missing
    const existing = await getPlanRecord(email);
    if (
      existing &&
      existing.plan === plan &&
      existing.billingStatus === record.billingStatus
    ) {
      console.log(`stripe-webhook: plan for ${email} already up to date (${plan}) — skipping write`);
      return;
    }

    await savePlanRecord(email, record);
    console.log(`stripe-webhook: account plan updated — email=${email} plan=${plan} status=${record.billingStatus}`);
  } catch (err) {
    console.error(`stripe-webhook: failed to persist plan for ${email}:`, err.message);
    throw err;
  }
}
