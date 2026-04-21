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

1. **Verify FluidPay API payloads against a real sandbox transaction.** `client.ts` uses the documented endpoint paths and payload shape, but confirm against your account's API reference — field names like `payment_method.token`, `reference_id` may differ by account / API version. First failed transaction's error message is the fastest way to spot any drift.
2. **Map FluidPay statuses → Medusa `PaymentSessionStatus`.** The `mapStatus()` switch in `service.ts` covers the common cases (`approved`, `authorized`, `captured`, `settled`, `voided`, `cancelled`, `declined`, `failed`). Confirm the full list of statuses your account emits and extend if needed.
3. **Webhooks.** Implement `getWebhookActionAndData()` so Medusa reacts to async state changes (e.g., ACH settlement, chargebacks). Register a webhook URL in the FluidPay dashboard pointing at `${MEDUSA_BACKEND_URL}/hooks/payment/fluidpay_fluidpay`.

## Activation

The provider only registers when `FLUIDPAY_API_KEY` is set. To enable it locally: populate the four `FLUIDPAY_*` vars in `.env` (see `.env.template`), restart Medusa, then attach `pp_fluidpay_fluidpay` to the relevant region (Admin → Settings → Regions, or via the Admin API).

## Sandbox testing

The sandbox environment at `https://sandbox.fluidpay.com` processes no real money. Full test-data reference: [`/docs/test_data/`](https://sandbox.fluidpay.com/docs/test_data/).

**Keys**: sandbox uses `pub_...` / `api_...` like production — just a different set tied to your sandbox account.

**Test cards** (sandbox only; these do nothing in prod):

| Card number | Brand | Trigger |
|---|---|---|
| `4111 1111 1111 1111` | Visa | Approved |
| `5555 5555 5555 4444` | Mastercard | Approved |
| `3782 822463 10005` | Amex | Approved |
| `6011 1111 1111 1117` | Discover | Approved |
| `4000 0000 0000 0002` | Visa | Generic decline |
| `4000 0000 0000 9995` | Visa | Insufficient funds |

**Verification mismatch triggers** (combine with any approval card):

| Input | Triggers |
|---|---|
| CVV `200` | CVV does-not-match response |
| Billing ZIP `20000` | AVS does-not-match response |

Any valid future expiration date works (e.g. `12/27`). Any CVV other than `200` is treated as a match.

**Switching to production**: set `FLUIDPAY_BASE_URL=https://app.fluidpay.com` on the backend and `NEXT_PUBLIC_FLUIDPAY_SANDBOX=false` on the storefront. Swap the key pair for your live `pub_.../api_...` credentials. Test cards will be rejected in prod.
