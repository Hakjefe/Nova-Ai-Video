# NOVA AI Video Studio — Subscription Starter (v2)

A polished, responsive AI video SaaS starter with **email/password accounts, $14.99 recurring Stripe Checkout (Apple Pay eligible), credit checks, billing portal, and Replicate video generation**.

## Local setup
1. Install Node.js 18+ and run `npm install`.
2. Copy `.env.example` to `.env`.
3. Get a Replicate API token, add it as `REPLICATE_API_TOKEN`.
4. Create a Stripe account. In Stripe create **a recurring monthly price of $14.99 USD** (do not use a one-time price). Copy the price ID (starts `price_`) to `STRIPE_PRICE_ID` and Stripe **secret key** to `STRIPE_SECRET_KEY`.
5. Set `PUBLIC_URL` to your app's public HTTPS URL in production (no ending slash). Use `http://localhost:3000` locally.
6. Configure a Stripe webhook endpoint at `https://YOUR_DOMAIN/api/stripe/webhook`, selecting events `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. For local testing, use the Stripe CLI webhook forwarding and corresponding secret.
7. Run `npm start` and visit `http://localhost:3000`. Use Stripe test mode first.

## Apple Pay
Stripe-hosted Checkout displays **Apple Pay automatically when the buyer's browser/device/wallet are eligible and the Stripe account supports it**. Apple Pay may not appear in every browser or on every device. There is no fake or forced Apple Pay button. See https://stripe.com/payments/checkout .

## What is implemented
- Polished responsive website, pricing, login/signup, video studio and video previews.
- Password hashing (scrypt), HttpOnly session cookies, user-specific job ownership, credit reservation, refunds for failed jobs.
- Server-created recurring Stripe Checkout session and customer billing portal.
- Stripe webhook signature verification, simple duplicate event protection, 10 credits per paid billing cycle.
- Replicate Hailuo video-01 six-second text-to-video generation.

## Not ready for a public launch
This is a **functional development starter**, not a production-ready commercial service. Before taking money from the public, use a transactional database and a proper hosted identity system, make credit allocation idempotent across webhook ordering, use a background job worker (and recover abandoned reservations), add bot protection, rate limiting, verified email/reset password, privacy/terms/refund policy, moderation, support, security review, permanent video storage, monitoring, and test the full payment-to-credit experience. Local JSON data is unsuitable for serverless/multi-instance production. The example uses a single server and local persistence. Set appropriate terms, disclosures, taxes and customer support.

**Important:** Secrets must stay in the `.env` file on your server, never in your website frontend or a public Git repository. Generated video URLs can expire. Stripe and Replicate have fees. Monthly credits reset with paid invoices and do not roll over. If invoice delivery gets out of order, a production-grade ledger and reconciliation will be needed. **The appearance of an Apple Pay label in the page does not mean the account is already enabled to accept Apple Pay.**
