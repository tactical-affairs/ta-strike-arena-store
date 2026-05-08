/**
 * Order detail status banner — appears above the standard order header.
 *
 * Translates Medusa's three status pills (order / payment / fulfillment)
 * into a single plain-English headline + body so seasonal staff can tell
 * what's happening at a glance without learning the underlying state
 * machines.
 *
 * Mounted at `order.details.before` so it's the first thing on the page.
 * Falls back to a generic "Status: X / Y / Z" with a manual link when an
 * unknown combo shows up — better than silently rendering nothing.
 */

import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Text } from "@medusajs/ui";
import type {
  AdminOrder,
  DetailWidgetProps,
} from "@medusajs/framework/types";

type Tone = "action" | "info" | "ok" | "canceled" | "warning";

type Interpretation = {
  tone: Tone;
  headline: string;
  body: string;
  nextStep?: string;
};

const TONE_STYLES: Record<
  Tone,
  { border: string; bg: string; label: string; labelClass: string }
> = {
  action: {
    border: "border-l-ui-tag-orange-icon",
    bg: "bg-ui-tag-orange-bg",
    label: "Needs your action",
    labelClass: "text-ui-tag-orange-text",
  },
  info: {
    border: "border-l-ui-tag-blue-icon",
    bg: "bg-ui-tag-blue-bg",
    label: "In progress",
    labelClass: "text-ui-tag-blue-text",
  },
  ok: {
    border: "border-l-ui-tag-green-icon",
    bg: "bg-ui-tag-green-bg",
    label: "Complete",
    labelClass: "text-ui-tag-green-text",
  },
  canceled: {
    border: "border-l-ui-tag-neutral-icon",
    bg: "bg-ui-tag-neutral-bg",
    label: "Canceled",
    labelClass: "text-ui-tag-neutral-text",
  },
  warning: {
    border: "border-l-ui-tag-red-icon",
    bg: "bg-ui-tag-red-bg",
    label: "Needs attention",
    labelClass: "text-ui-tag-red-text",
  },
};

function interpret(order: AdminOrder): Interpretation {
  const status = order.status as string;
  const payment = order.payment_status as string;
  const fulfillment = order.fulfillment_status as string;

  // Canceled orders — the most common case where the duplicate-pill confusion shows up.
  if (status === "canceled") {
    if (payment === "canceled") {
      return {
        tone: "canceled",
        headline: "Canceled before charge",
        body: "The card authorization was voided cleanly — no money moved, nothing to refund. The customer was not charged.",
      };
    }
    if (payment === "refunded" || payment === "partially_refunded") {
      return {
        tone: "canceled",
        headline: "Canceled and refunded",
        body: `Order canceled after the charge was captured. ${
          payment === "refunded" ? "Full refund" : "Partial refund"
        } issued — the customer's bank typically posts it back to the card within 3–5 business days.`,
      };
    }
    if (fulfillment === "partially_fulfilled" || fulfillment === "shipped") {
      return {
        tone: "warning",
        headline: "Canceled mid-shipment",
        body: "Some items have already shipped. Either wait for the customer to receive and return them, or attempt a carrier intercept (USPS Package Intercept / UPS Hold).",
        nextStep:
          "Open the manual section on shipped-order cancellations for the playbook.",
      };
    }
    return {
      tone: "canceled",
      headline: "Canceled",
      body: "This order was canceled. No further action expected.",
    };
  }

  // requires_action is a Medusa flag for "something off — please look".
  if (status === "requires_action") {
    return {
      tone: "warning",
      headline: "Flagged for manual review",
      body: "Medusa flagged this order as requiring action — usually a payment or fulfillment edge case. Open the Payments and Fulfillment sections below to see the specific issue.",
    };
  }

  // From here, status is "pending" or "completed".

  // Returns + refunds.
  if (fulfillment === "returned" && payment === "refunded") {
    return {
      tone: "ok",
      headline: "Returned and refunded",
      body: "Items came back, refund was issued. Order complete — no further action.",
    };
  }
  if (
    fulfillment === "partially_returned" ||
    payment === "partially_refunded"
  ) {
    return {
      tone: "info",
      headline: "Partial return processed",
      body: "Some items came back and were refunded. The rest of the order is still with the customer.",
    };
  }

  // Pre-payment: customer started checkout but never finished.
  if (payment === "not_paid" || payment === "awaiting") {
    return {
      tone: "info",
      headline: "Awaiting payment",
      body: "The customer started checkout but hasn't paid yet. Most carts in this state are abandoned and need no action — they'll either pay or expire.",
    };
  }

  // Authorized but not captured — the most common "ops needs to act" state.
  if (payment === "authorized" && fulfillment === "not_fulfilled") {
    return {
      tone: "action",
      headline: "Awaiting your action: capture and ship",
      body: "The card is authorized but no money has moved yet. Capture the payment and create a fulfillment from the sections below. Authorizations expire in about a week, so don't sit on this.",
      nextStep:
        "Payments → Capture, then Fulfillment → Create fulfillment.",
    };
  }

  // Captured + still not fulfilled — money's in, awaiting label.
  if (payment === "captured" && fulfillment === "not_fulfilled") {
    return {
      tone: "action",
      headline: "Paid — awaiting fulfillment",
      body: "Money was captured. The customer is now waiting for you to create a fulfillment and print a label.",
      nextStep: "Fulfillment → Create fulfillment.",
    };
  }

  // Captured + fulfilled (label bought, not yet handed to carrier).
  if (payment === "captured" && fulfillment === "fulfilled") {
    return {
      tone: "action",
      headline: "Label purchased — awaiting carrier handoff",
      body: "The shipping label was bought but the carrier hasn't scanned the package yet. Pack the box and hand it off, or void the label if plans changed.",
    };
  }

  // Captured + shipped (carrier has it).
  if (payment === "captured" && fulfillment === "shipped") {
    return {
      tone: "info",
      headline: "In transit to customer",
      body: "The carrier has the package and is delivering it. Tracking updates flow in automatically. No action needed unless the customer asks for an update.",
    };
  }

  // Captured + delivered = complete (whether status is pending or completed).
  if (payment === "captured" && fulfillment === "delivered") {
    return {
      tone: "ok",
      headline: "Delivered",
      body: "Customer received the package. Order is complete unless they request a return.",
    };
  }

  // Multi-shipment orders.
  if (fulfillment === "partially_fulfilled") {
    return {
      tone: "info",
      headline: "Partially shipped",
      body: "Some items have shipped, others are still being prepared. Continue creating fulfillments for the remaining items.",
    };
  }

  // Catch-all — show the raw fields with a manual link rather than rendering nothing.
  return {
    tone: "info",
    headline: "Status",
    body: `Order: ${status} · Payment: ${payment} · Fulfillment: ${fulfillment}. Check the Operations Manual → Status reference for what each value means.`,
  };
}

const OrderStatusSummaryWidget = ({
  data,
}: DetailWidgetProps<AdminOrder>) => {
  if (!data) return null;
  const v = interpret(data);
  const styles = TONE_STYLES[v.tone];

  return (
    <Container className={`p-0 border-l-4 ${styles.border} ${styles.bg}`}>
      <div className="px-6 py-4">
        <Text
          size="small"
          weight="plus"
          className={`uppercase tracking-wider ${styles.labelClass}`}
        >
          {styles.label}
        </Text>
        <div className="mt-1 text-ui-fg-base font-semibold">{v.headline}</div>
        <Text size="small" className="mt-2 text-ui-fg-subtle leading-relaxed">
          {v.body}
        </Text>
        {v.nextStep && (
          <Text
            size="small"
            className="mt-2 text-ui-fg-base"
            weight="plus"
          >
            Next: {v.nextStep}
          </Text>
        )}
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "order.details.before",
});

export default OrderStatusSummaryWidget;
