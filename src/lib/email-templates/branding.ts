/**
 * Shared branding constants for transactional emails. Keep these in
 * one place so the three (and future) email templates stay in sync.
 *
 * The logo is hosted in the website project at
 * ta-strike-arena-website/public/email/strike-arena-logo.png and served
 * by the public Railway/Cloudflare deployment. Email clients require an
 * absolute HTTPS URL — they don't honor relative paths or attachments.
 */

export const ACCENT = "#FF6A00";
export const TEXT = "#0B0D10";
export const SUBTLE = "#5C6470";
export const BORDER = "#E4E7EC";

export const LOGO_URL = "https://strikearena.net/email/strike-arena-logo.png";
// Source is 400×134 (2x retina); display under half so we get a crisp logo
// across mainstream clients without bloating per-email payload size — and
// without overpowering the body content visually.
export const LOGO_DISPLAY_WIDTH = 170;
export const LOGO_DISPLAY_HEIGHT = 57;
