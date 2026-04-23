/**
 * Shippo webhook receiver.
 *
 * Shippo POSTs tracking status changes (track_updated, transaction_updated)
 * to this endpoint. We verify the HMAC signature header against
 * `SHIPPO_WEBHOOK_SECRET`, then emit a domain event that downstream
 * subscribers can listen to.
 *
 * Configure the endpoint URL in Shippo dashboard → Settings → Webhooks:
 *   {BACKEND_URL}/hooks/shippo
 *
 * Signature format: HMAC-SHA256 over the raw body, hex-encoded, in the
 * `X-Shippo-Signature` header. See
 * https://docs.goshippo.com/shippoapi/public-api/#tag/Webhooks
 */

import crypto from "node:crypto";
import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

type ShippoWebhookPayload = {
  event?: string;
  test?: boolean;
  data?: {
    object_id?: string;
    tracking_number?: string;
    tracking_status?: { status?: string; status_details?: string };
    carrier?: string;
  };
};

function verifySignature(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  // Guard against length mismatch (timingSafeEqual throws otherwise).
  if (header.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(header, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve("logger") as {
    info: (msg: string) => void;
    warn: (msg: string) => void;
  };
  const secret = process.env.SHIPPO_WEBHOOK_SECRET;

  if (secret) {
    const signature = req.headers["x-shippo-signature"];
    const sigHeader = Array.isArray(signature) ? signature[0] : signature;
    const raw = (req as unknown as { rawBody?: Buffer | string }).rawBody ?? "";
    if (!verifySignature(raw, sigHeader, secret)) {
      logger.warn("[shippo-webhook] signature verification failed");
      res.status(401).json({ message: "invalid signature" });
      return;
    }
  } else {
    logger.warn(
      "[shippo-webhook] SHIPPO_WEBHOOK_SECRET not set — accepting webhook without signature check"
    );
  }

  const payload = (req.body ?? {}) as ShippoWebhookPayload;
  const event = payload.event ?? "unknown";
  const tracking = payload.data?.tracking_number;
  const status = payload.data?.tracking_status?.status;

  logger.info(
    `[shippo-webhook] received ${event} tracking=${tracking ?? "?"} status=${
      status ?? "?"
    }`
  );

  // Emit a domain event for other modules to subscribe to (e.g. an
  // internal subscriber that marks a fulfillment as shipped/delivered).
  // Fulfillment status handling lives outside the provider module so
  // it can evolve without touching the Shippo integration.
  const eventBus = req.scope.resolve(Modules.EVENT_BUS) as {
    emit: (event: { name: string; data: unknown }) => Promise<void>;
  } | null;
  if (eventBus && typeof eventBus.emit === "function") {
    await eventBus.emit({
      name: `shippo.${event}`,
      data: payload.data ?? {},
    });
  }

  res.status(200).json({ ok: true });
}
