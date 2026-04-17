# FluidPay Payment Module Provider

Custom Medusa v2 Payment Module Provider for [FluidPay](https://www.fluidpay.com/).

## How it fits together

1. **Storefront** loads FluidPay's [Tokenizer](https://sandbox.fluidpay.com/docs/services/tokenizer) iframe using `FLUIDPAY_PUBLIC_KEY`. Customer enters card data, which goes directly to FluidPay (never through our servers). The iframe returns a `tok_...` token.
2. **Storefront** updates the Medusa payment session with `{ paymentToken: "tok_..." }` before completing the cart.
3. **Medusa** calls `authorizePayment()` on this provider, which POSTs to FluidPay's `/api/transaction` endpoint using `FLUIDPAY_API_KEY` (secret).
4. Subsequent actions (capture, void, refund) use the FluidPay transaction ID stored on `payment.data.transactionId`.

## What this scaffold implements

| Method | Status |
|--------|--------|
| `initiatePayment` | ✅ Stores publicKey + amount on the session for storefront use |
| `authorizePayment` | ✅ Creates an `authorize` or `sale` transaction with the token |
| `capturePayment` | ✅ Captures a previously authorized transaction |
| `refundPayment` | ✅ Issues a partial or full refund |
| `cancelPayment` | ✅ Voids an authorized-but-uncaptured transaction |
| `retrievePayment` / `getPaymentStatus` | ✅ Reads the latest txn state from FluidPay |
| `updatePayment` | ✅ Updates amount/currency on the session |
| `deletePayment` | ✅ No-op (nothing to delete on FluidPay's side) |
| `getWebhookActionAndData` | ⚠️ **Not implemented** — TODO |

## What still needs doing before shipping

1. **Verify FluidPay API payloads.** `client.ts` uses the documented endpoint paths and payload shape, but you should confirm against your actual FluidPay account's API reference — field names like `payment_method.token`, `reference_id` may differ by account / API version.
2. **Map FluidPay statuses → Medusa `PaymentSessionStatus`.** The `mapStatus()` switch in `service.ts` covers the common cases; confirm the full list of statuses your account emits.
3. **Webhooks.** Implement `getWebhookActionAndData()` so Medusa reacts to async state changes (e.g., ACH settlement, chargebacks). Register a webhook URL in the FluidPay dashboard pointing at `${MEDUSA_BACKEND_URL}/hooks/payment/fluidpay_fluidpay`.
4. **Storefront integration** (`ta-strike-arena-website`):
   - Swap the Authorize.net Accept.js script on `/checkout/` for the FluidPay Tokenizer.
   - After tokenization, call `PATCH /store/payment-collections/:id/payment-sessions/:id` (or equivalent SDK call) with `{ data: { paymentToken: "tok_..." } }`.
   - Then `POST /store/carts/:id/complete` to authorize + place the order.
5. **Enable the provider in a region** via Medusa Admin → Settings → Regions → add the `pp_fluidpay_fluidpay` payment provider.

## Activation

The provider only registers when `FLUIDPAY_API_KEY` is set. Until then Medusa runs without it (so Authorize.net can keep handling payments during the migration).
