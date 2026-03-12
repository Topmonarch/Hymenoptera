// Stripe Billing Portal session creation
// Requires STRIPE_SECRET_KEY environment variable

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const { customerId } = req.body;
  if (!customerId) {
    return res.status(400).json({ error: 'Customer ID is required' });
  }

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://hymenoptera-ai.vercel.app/?portal=return'
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Billing portal error:', err.message);
    return res.status(500).json({ error: 'Failed to create billing portal session' });
  }
}
