/**
 * Thin wrapper around the TaxJar REST API.
 *
 * Docs: https://developers.taxjar.com/api/reference/
 *
 * Auth: Bearer token using the live (`<live>`) or sandbox (`<test>`) token.
 * Live is `https://api.taxjar.com/v2/`; sandbox is
 * `https://api.sandbox.taxjar.com/v2/` — sandbox has a limited fixture
 * set (ship-to 90002 / 90210 only, nexus regions must be added in the
 * sandbox account separately from live).
 */

export type TaxJarClientOptions = {
  apiKey: string;
  sandbox?: boolean;
};

export type TaxJarAddress = {
  country: string;
  zip: string;
  state: string;
  city?: string;
  street?: string;
};

export type TaxJarLineItem = {
  id: string;
  quantity: number;
  unit_price: number;
  /** Optional TaxJar product tax code; omit for general tangible goods. */
  product_tax_code?: string;
  discount?: number;
};

export type TaxJarTaxRequest = {
  from_country: string;
  from_zip: string;
  from_state: string;
  from_city?: string;
  from_street?: string;
  to_country: string;
  to_zip: string;
  to_state: string;
  to_city?: string;
  to_street?: string;
  /** Order total including shipping (before tax). */
  amount: number;
  shipping: number;
  line_items?: TaxJarLineItem[];
};

export type TaxJarLineItemBreakdown = {
  id: string;
  taxable_amount: number;
  tax_collectable: number;
  combined_tax_rate: number;
};

export type TaxJarShippingBreakdown = {
  taxable_amount: number;
  tax_collectable: number;
  combined_tax_rate: number;
};

export type TaxJarBreakdown = {
  taxable_amount?: number;
  tax_collectable?: number;
  combined_tax_rate?: number;
  line_items?: TaxJarLineItemBreakdown[];
  shipping?: TaxJarShippingBreakdown;
};

export type TaxJarTaxResponse = {
  order_total_amount: number;
  shipping: number;
  taxable_amount: number;
  amount_to_collect: number;
  rate: number;
  has_nexus: boolean;
  freight_taxable: boolean;
  tax_source?: string;
  jurisdictions?: Record<string, string>;
  breakdown?: TaxJarBreakdown;
};

export type TaxJarOrderTransaction = {
  transaction_id: string;
  transaction_date: string;
  provider?: string;
  to_country: string;
  to_zip: string;
  to_state: string;
  to_city?: string;
  to_street?: string;
  from_country?: string;
  from_zip?: string;
  from_state?: string;
  from_city?: string;
  from_street?: string;
  amount: number;
  shipping: number;
  sales_tax: number;
  line_items?: Array<{
    id?: string;
    quantity?: number;
    product_identifier?: string;
    description?: string;
    product_tax_code?: string;
    unit_price?: number;
    discount?: number;
    sales_tax?: number;
  }>;
};

export type TaxJarRefundTransaction = TaxJarOrderTransaction & {
  transaction_reference_id: string;
};

export class TaxJarClient {
  private apiKey: string;
  private baseUrl: string;

  constructor({ apiKey, sandbox }: TaxJarClientOptions) {
    if (!apiKey) throw new Error("TaxJar apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = sandbox
      ? "https://api.sandbox.taxjar.com/v2"
      : "https://api.taxjar.com/v2";
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const bodyText = await res.text();
    let parsed: unknown = null;
    if (bodyText) {
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = bodyText;
      }
    }
    if (!res.ok) {
      const detail =
        (parsed as { detail?: string; error?: string })?.detail ??
        (parsed as { error?: string })?.error ??
        res.statusText;
      throw new Error(
        `TaxJar ${init.method ?? "GET"} ${path} failed: ${res.status} ${detail}`,
      );
    }
    return parsed as T;
  }

  async calculateTax(
    input: TaxJarTaxRequest,
  ): Promise<TaxJarTaxResponse> {
    const { tax } = await this.request<{ tax: TaxJarTaxResponse }>(
      "/taxes",
      { method: "POST", body: JSON.stringify(input) },
    );
    return tax;
  }

  async createOrderTransaction(
    input: TaxJarOrderTransaction,
  ): Promise<void> {
    await this.request<{ order: unknown }>("/transactions/orders", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async createRefundTransaction(
    input: TaxJarRefundTransaction,
  ): Promise<void> {
    await this.request<{ refund: unknown }>("/transactions/refunds", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async deleteOrderTransaction(transactionId: string): Promise<void> {
    await this.request<{ order: unknown }>(
      `/transactions/orders/${encodeURIComponent(transactionId)}`,
      { method: "DELETE" },
    );
  }
}
