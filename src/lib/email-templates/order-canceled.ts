/**
 * Build the HTML + plain-text body for an order cancellation email.
 *
 * Pure functions — no I/O. Subscriber feeds in the order summary.
 */

export type OrderCanceledInput = {
  display_id: number | string;
  email: string;
  currency_code?: string;
  total: number | string;
  canceled_at?: string | Date | null;
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

function fmtMoney(value: number | string | null | undefined, currency = "USD"): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(Number.isFinite(n) ? n : 0);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildOrderCanceledHtml(input: OrderCanceledInput): string {
  const currency = input.currency_code ?? "usd";
  const canceledDate = input.canceled_at
    ? new Date(input.canceled_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order ${input.display_id} canceled</title>
</head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6F8;">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:8px;overflow:hidden;border:1px solid ${BORDER};">
        <tr>
          <td style="padding:24px 32px;border-bottom:4px solid ${ACCENT};">
            <img src="${LOGO_URL}" alt="Strike Arena" width="${LOGO_DISPLAY_WIDTH}" height="${LOGO_DISPLAY_HEIGHT}" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;height:${LOGO_DISPLAY_HEIGHT}px;width:${LOGO_DISPLAY_WIDTH}px;">
            <h1 style="margin:16px 0 0;font-size:22px;color:${TEXT};">
              Order #${escapeHtml(String(input.display_id))} canceled
            </h1>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <p style="margin:0 0 16px;color:${TEXT};line-height:1.5;">
              Your order has been canceled${canceledDate ? ` on ${escapeHtml(canceledDate)}` : ""}.
              You won't be charged${input.total != null ? `; the ${fmtMoney(input.total, currency)} authorization will release` : ""}.
              If a charge was already captured, we'll process the refund and follow up
              when it posts.
            </p>
            <p style="margin:0;color:${SUBTLE};font-size:13px;line-height:1.5;">
              If you didn't request this cancellation, please reply to this
              email immediately so we can investigate.
            </p>
            <div style="margin-top:32px;padding-top:24px;border-top:1px solid ${BORDER};color:${SUBTLE};font-size:13px;line-height:1.5;">
              Questions? Reply to this email or write to
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

export function buildOrderCanceledText(input: OrderCanceledInput): string {
  const currency = input.currency_code ?? "usd";
  const lines: string[] = [];
  lines.push(`Order #${input.display_id} canceled`);
  lines.push("");
  const datePart = input.canceled_at
    ? ` on ${new Date(input.canceled_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
    : "";
  lines.push(`Your order has been canceled${datePart}.`);
  lines.push(
    `You won't be charged${input.total != null ? `; the ${fmtMoney(input.total, currency)} authorization will release` : ""}.`,
  );
  lines.push(
    "If a charge was already captured, we'll process the refund and follow up.",
  );
  lines.push("");
  lines.push(
    "Didn't request this cancellation? Reply or write to support@strikearena.net.",
  );
  return lines.join("\n");
}
