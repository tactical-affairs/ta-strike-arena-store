/**
 * Build the HTML + plain-text body for an order confirmation email.
 *
 * Pure functions — no I/O, no module access. Fed an already-loaded
 * Medusa order with items + addresses; subscribers handle the I/O
 * and pass the data through.
 */

export type OrderPlacedItem = {
  title?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  variant_sku?: string | null;
  quantity?: number | null;
  unit_price?: number | string | null;
  subtotal?: number | string | null;
};

export type OrderPlacedAddress = {
  first_name?: string | null;
  last_name?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
};

export type OrderPlacedInput = {
  display_id: number | string;
  email: string;
  currency_code?: string;
  items: OrderPlacedItem[];
  shipping_address?: OrderPlacedAddress | null;
  subtotal?: number | string | null;
  shipping_total?: number | string | null;
  tax_total?: number | string | null;
  total: number | string;
};

const ACCENT = "#FF6A00";
const TEXT = "#0B0D10";
const SUBTLE = "#5C6470";
const BORDER = "#E4E7EC";

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

function formatAddress(addr: OrderPlacedAddress | null | undefined): string {
  if (!addr) return "";
  const name = [addr.first_name, addr.last_name].filter(Boolean).join(" ");
  const street = [addr.address_1, addr.address_2].filter(Boolean).join(", ");
  const cityLine = [
    addr.city,
    addr.province,
    addr.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  return [name, street, cityLine, addr.country_code?.toUpperCase()]
    .filter(Boolean)
    .map(escapeHtml)
    .join("<br>");
}

export function buildOrderPlacedHtml(order: OrderPlacedInput): string {
  const currency = order.currency_code ?? "usd";
  const itemRows = order.items
    .map((it) => {
      const title = it.product_title ?? it.title ?? "Item";
      const variant = it.variant_title && it.variant_title !== "Default"
        ? ` — ${it.variant_title}`
        : "";
      const sku = it.variant_sku ? ` (${it.variant_sku})` : "";
      const qty = Number(it.quantity ?? 0);
      const subtotal = it.subtotal ?? Number(it.unit_price ?? 0) * qty;
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid ${BORDER};vertical-align:top;">
            <div style="color:${TEXT};font-weight:600;">${escapeHtml(title)}${escapeHtml(variant)}</div>
            ${sku ? `<div style="color:${SUBTLE};font-size:13px;">${escapeHtml(sku)}</div>` : ""}
          </td>
          <td style="padding:12px 0;border-bottom:1px solid ${BORDER};text-align:right;color:${SUBTLE};white-space:nowrap;vertical-align:top;">
            ${qty} × ${fmtMoney(it.unit_price, currency)}
          </td>
          <td style="padding:12px 0;border-bottom:1px solid ${BORDER};text-align:right;color:${TEXT};white-space:nowrap;vertical-align:top;">
            ${fmtMoney(subtotal, currency)}
          </td>
        </tr>
      `;
    })
    .join("");

  const addressBlock = order.shipping_address
    ? `
      <div style="margin-top:32px;">
        <div style="color:${SUBTLE};font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:8px;">
          Shipping to
        </div>
        <div style="color:${TEXT};line-height:1.5;">
          ${formatAddress(order.shipping_address)}
        </div>
      </div>
    `
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order ${order.display_id} confirmed</title>
</head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6F8;">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:8px;overflow:hidden;border:1px solid ${BORDER};">
        <tr>
          <td style="padding:24px 32px;border-bottom:4px solid ${ACCENT};">
            <div style="font-size:14px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${ACCENT};">
              Strike Arena
            </div>
            <h1 style="margin:8px 0 0;font-size:22px;color:${TEXT};">
              Order #${escapeHtml(String(order.display_id))} confirmed
            </h1>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <p style="margin:0 0 16px;color:${TEXT};line-height:1.5;">
              Thanks for your order. We've received it and will email you again
              when it ships.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
              <thead>
                <tr>
                  <th align="left" style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${SUBTLE};padding-bottom:8px;font-weight:600;">Item</th>
                  <th align="right" style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${SUBTLE};padding-bottom:8px;font-weight:600;">Qty × Price</th>
                  <th align="right" style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${SUBTLE};padding-bottom:8px;font-weight:600;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows}
              </tbody>
              <tfoot>
                ${
                  order.shipping_total != null
                    ? `<tr>
                        <td colspan="2" style="padding:8px 0 0;text-align:right;color:${SUBTLE};">Shipping</td>
                        <td style="padding:8px 0 0;text-align:right;color:${TEXT};white-space:nowrap;">${fmtMoney(order.shipping_total, currency)}</td>
                      </tr>`
                    : ""
                }
                ${
                  order.tax_total != null
                    ? `<tr>
                        <td colspan="2" style="padding:4px 0 0;text-align:right;color:${SUBTLE};">Tax</td>
                        <td style="padding:4px 0 0;text-align:right;color:${TEXT};white-space:nowrap;">${fmtMoney(order.tax_total, currency)}</td>
                      </tr>`
                    : ""
                }
                <tr>
                  <td colspan="2" style="padding:12px 0 0;text-align:right;font-weight:700;color:${TEXT};border-top:1px solid ${BORDER};">Total</td>
                  <td style="padding:12px 0 0;text-align:right;font-weight:700;color:${TEXT};white-space:nowrap;border-top:1px solid ${BORDER};">${fmtMoney(order.total, currency)}</td>
                </tr>
              </tfoot>
            </table>

            ${addressBlock}

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

export function buildOrderPlacedText(order: OrderPlacedInput): string {
  const currency = order.currency_code ?? "usd";
  const lines: string[] = [];
  lines.push(`Order #${order.display_id} confirmed`);
  lines.push("");
  lines.push("Thanks for your order. We'll email you again when it ships.");
  lines.push("");
  for (const it of order.items) {
    const title = it.product_title ?? it.title ?? "Item";
    const variant =
      it.variant_title && it.variant_title !== "Default"
        ? ` — ${it.variant_title}`
        : "";
    const qty = Number(it.quantity ?? 0);
    const sub = it.subtotal ?? Number(it.unit_price ?? 0) * qty;
    lines.push(
      `  ${qty} × ${title}${variant} — ${fmtMoney(sub, currency)}`,
    );
  }
  lines.push("");
  if (order.shipping_total != null) {
    lines.push(`Shipping: ${fmtMoney(order.shipping_total, currency)}`);
  }
  if (order.tax_total != null) {
    lines.push(`Tax: ${fmtMoney(order.tax_total, currency)}`);
  }
  lines.push(`Total: ${fmtMoney(order.total, currency)}`);
  lines.push("");
  if (order.shipping_address) {
    lines.push("Shipping to:");
    const addr = order.shipping_address;
    const name = [addr.first_name, addr.last_name].filter(Boolean).join(" ");
    if (name) lines.push(`  ${name}`);
    if (addr.address_1) lines.push(`  ${addr.address_1}`);
    if (addr.address_2) lines.push(`  ${addr.address_2}`);
    const city = [addr.city, addr.province, addr.postal_code]
      .filter(Boolean)
      .join(", ");
    if (city) lines.push(`  ${city}`);
    if (addr.country_code) lines.push(`  ${addr.country_code.toUpperCase()}`);
    lines.push("");
  }
  lines.push(
    "Questions? Reply to this email or write to support@strikearena.net.",
  );
  return lines.join("\n");
}
