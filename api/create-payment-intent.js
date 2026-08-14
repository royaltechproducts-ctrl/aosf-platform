// Vercel Serverless Function — Stripe PaymentIntent
// This file lives in /api/ and is never exposed to the browser

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "https://aosf-platform.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    res.status(500).json({ error: "Stripe secret key not configured" }); return;
  }

  try {
    const { amount, currency, aosf_code, type } = req.body;

    if (!amount || !currency || !aosf_code) {
      res.status(400).json({ error: "Missing required fields" }); return;
    }

    // Create PaymentIntent via Stripe API
    const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: String(amount),
        currency: currency.toLowerCase(),
        "metadata[aosf_code]": aosf_code,
        "metadata[type]": type || "application_fee",
        description: "AOSF " + (type === "reactivation" ? "Reactivation" : "Application") + " Fee — " + aosf_code,
        automatic_payment_methods: "enabled",
        "automatic_payment_methods[allow_redirects]": "never",
      }),
    });

    const data = await stripeRes.json();

    if (data.error) {
      res.status(400).json({ error: data.error.message }); return;
    }

    res.status(200).json({
      clientSecret: data.client_secret,
      paymentIntentId: data.id,
    });

  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: "Payment processing error. Please try again." });
  }
}
