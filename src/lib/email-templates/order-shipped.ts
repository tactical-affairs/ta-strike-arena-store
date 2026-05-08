/**
 * Build the HTML + plain-text body for a shipment notification email.
 *
 * Pure functions — no I/O. Subscribers fetch the order + fulfillment
 * tracking links and feed them in.
 */

export type ShippedTrackingLink = {
  tracking_number?: string | null;
  url?: string | null;
};

export type ShippedItem = {
  title?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  quantity?: number | null;
};

export type OrderShippedInput = {
  display_id: number | string;
  email: string;
  carrier?: string | null;
  tracking_links: ShippedTrackingLink[];
  items: ShippedItem[];
};

import {
  ACCENT,
  BORDER,
  LOGO_DISPLAY_HEIGHT,
  LOGO_DISPLAY_WIDTH,
  LOGO_URL,
  SUBTLE,
  TEXT,
} from "./branding";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildOrderShippedHtml(input: OrderShippedInput): string {
  const trackingRows = input.tracking_links
    .filter((t) => t.tracking_number || t.url)
    .map((t) => {
      const num = escapeHtml(t.tracking_number ?? "Tracking number unavailable");
      if (t.url) {
        return `<div style="margin:8px 0;"><a href="${escapeHtml(t.url)}" style="color:${ACCENT};text-decoration:none;font-weight:600;">${num}</a></div>`;
      }
      return `<div style="margin:8px 0;color:${TEXT};font-weight:600;">${num}</div>`;
    })
    .join("");

  const itemRows = input.items
    .map((it) => {
      const title = it.product_title ?? it.title ?? "Item";
      const variant =
        it.variant_title && it.variant_title !== "Default"
          ? ` — ${it.variant_title}`
          : "";
      const qty = Number(it.quantity ?? 0);
      return `<li style="margin:4px 0;color:${TEXT};">${qty} × ${escapeHtml(title)}${escapeHtml(variant)}</li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order ${input.display_id} shipped</title>
</head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6F8;">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:8px;overflow:hidden;border:1px solid ${BORDER};">
        <tr>
          <td style="padding:24px 32px;border-bottom:4px solid ${ACCENT};">
            <img src="${LOGO_URL}" alt="Strike Arena" width="${LOGO_DISPLAY_WIDTH}" height="${LOGO_DISPLAY_HEIGHT}" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;height:${LOGO_DISPLAY_HEIGHT}px;width:${LOGO_DISPLAY_WIDTH}px;">
            <h1 style="margin:16px 0 0;font-size:22px;color:${TEXT};">
              Order #${escapeHtml(String(input.display_id))} is on its way
            </h1>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <p style="margin:0 0 16px;color:${TEXT};line-height:1.5;">
              Your order shipped${input.carrier ? ` via ${escapeHtml(input.carrier)}` : ""}. Use the tracking number below to follow it.
            </p>
            ${
              trackingRows
                ? `<div style="margin:24px 0;padding:16px;background:#F5F6F8;border-radius:6px;">
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${SUBTLE};font-weight:600;margin-bottom:4px;">Tracking</div>
                    ${trackingRows}
                  </div>`
                : `<p style="color:${SUBTLE};font-style:italic;">Tracking information will be available shortly.</p>`
            }
            ${
              itemRows
                ? `<div style="margin-top:24px;">
                    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${SUBTLE};font-weight:600;margin-bottom:8px;">Shipped in this package</div>
                    <ul style="margin:0;padding-left:20px;">${itemRows}</ul>
                  </div>`
                : ""
            }
            <div style="margin-top:32px;padding-top:24px;border-top:1px solid ${BORDER};color:${SUBTLE};font-size:13px;line-height:1.5;">
              Questions about delivery? Reply to this email or write to
              <a href="mailto:support@strikearena.net" style="color:${ACCENT};text-decoration:none;">support@strikearena.net</a>.
            </div>
          </td>
        </tr>
      </table>
      <div style="max-width:560px;padding:16px 32px;color:${SUBTLE};font-size:12px;line-height:1.5;">
        Strike Arena · <a href="https://strikearena.net" style="color:${SUBTLE};">strikearena.net</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildOrderShippedText(input: OrderShippedInput): string {
  const lines: string[] = [];
  lines.push(`Order #${input.display_id} is on its way`);
  lines.push("");
  lines.push(
    `Your order shipped${input.carrier ? ` via ${input.carrier}` : ""}.`,
  );
  lines.push("");
  const tracking = input.tracking_links.filter(
    (t) => t.tracking_number || t.url,
  );
  if (tracking.length > 0) {
    lines.push("Tracking:");
    for (const t of tracking) {
      if (t.tracking_number && t.url) {
        lines.push(`  ${t.tracking_number} — ${t.url}`);
      } else if (t.url) {
        lines.push(`  ${t.url}`);
      } else if (t.tracking_number) {
        lines.push(`  ${t.tracking_number}`);
      }
    }
    lines.push("");
  }
  if (input.items.length > 0) {
    lines.push("Shipped in this package:");
    for (const it of input.items) {
      const title = it.product_title ?? it.title ?? "Item";
      const variant =
        it.variant_title && it.variant_title !== "Default"
          ? ` — ${it.variant_title}`
          : "";
      lines.push(`  ${Number(it.quantity ?? 0)} × ${title}${variant}`);
    }
    lines.push("");
  }
  lines.push(
    "Questions about delivery? Reply or write to support@strikearena.net.",
  );
  return lines.join("\n");
}
