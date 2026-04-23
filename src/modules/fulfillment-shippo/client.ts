/**
 * Thin wrapper around the Shippo REST API.
 *
 * Docs: https://docs.goshippo.com/shippoapi/public-api/
 *
 * Auth: `Authorization: ShippoToken {SHIPPO_API_KEY}`. Sandbox keys start
 * with `shippo_test_` and live keys with `shippo_live_`; the API infers
 * which set of carriers to use from the key prefix.
 *
 * All money amounts come back as decimal strings denominated in the
 * response's `currency` field (e.g. `"12.50"` USD). The service layer
 * parses these into numbers at the boundary.
 */

export type ShippoClientOptions = {
  apiKey: string;
  /** Optional base URL override. Defaults to Shippo's production API host. */
  baseUrl?: string;
};

export type ShippoAddress = {
  name?: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
};

export type ShippoParcel = {
  length: string;
  width: string;
  height: string;
  distance_unit: "in" | "cm";
  weight: string;
  mass_unit: "oz" | "lb" | "g" | "kg";
};

export type ShippoRate = {
  object_id: string;
  provider: string;
  servicelevel: { token: string; name: string };
  amount: string;
  currency: string;
  estimated_days?: number;
  duration_terms?: string;
};

export type ShippoShipment = {
  object_id: string;
  status: string;
  rates: ShippoRate[];
  messages?: Array<{ source?: string; code?: string; text: string }>;
};

export type ShippoTransaction = {
  object_id: string;
  status: "QUEUED" | "WAITING" | "SUCCESS" | "ERROR" | "REFUNDED" | string;
  rate: string;
  tracking_number?: string;
  tracking_url_provider?: string;
  label_url?: string;
  commercial_invoice_url?: string;
  messages?: Array<{ source?: string; code?: string; text: string }>;
};

export type ShippoRefund = {
  object_id: string;
  status: "QUEUED" | "SUCCESS" | "ERROR" | string;
  transaction: string;
};

export class ShippoClient {
  private apiKey: string;
  private baseUrl: string;

  constructor({ apiKey, baseUrl }: ShippoClientOptions) {
    if (!apiKey) throw new Error("Shippo apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl ?? "https://api.goshippo.com").replace(/\/$/, "");
  }

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `ShippoToken ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok) {
      const detail =
        (body as { detail?: string; messages?: Array<{ text: string }> })
          .detail ??
        (body as { messages?: Array<{ text: string }> }).messages
          ?.map((m) => m.text)
          .join("; ") ??
        res.statusText;
      throw new Error(
        `Shippo ${init.method ?? "GET"} ${path} failed: ${res.status} ${detail}`
      );
    }
    return body as T;
  }

  /**
   * POST /shipments/
   * Returns rates across all configured carriers for this shipment.
   */
  createShipment(input: {
    addressFrom: ShippoAddress;
    addressTo: ShippoAddress;
    parcels: ShippoParcel[];
    metadata?: string;
    async?: boolean;
  }): Promise<ShippoShipment> {
    return this.request<ShippoShipment>("/shipments/", {
      method: "POST",
      body: JSON.stringify({
        address_from: input.addressFrom,
        address_to: input.addressTo,
        parcels: input.parcels,
        metadata: input.metadata,
        async: input.async ?? false,
      }),
    });
  }

  /**
   * POST /transactions/
   * Buys a label for a specific rate. Synchronous mode waits for the
   * carrier to confirm and returns the tracking number + label URL.
   */
  createTransaction(input: {
    rate: string;
    labelFileType?: "PDF" | "PDF_4x6" | "PNG" | "ZPLII";
    metadata?: string;
  }): Promise<ShippoTransaction> {
    return this.request<ShippoTransaction>("/transactions/", {
      method: "POST",
      body: JSON.stringify({
        rate: input.rate,
        label_file_type: input.labelFileType ?? "PDF_4x6",
        async: false,
        metadata: input.metadata,
      }),
    });
  }

  /**
   * GET /transactions/{id}
   */
  retrieveTransaction(id: string): Promise<ShippoTransaction> {
    return this.request<ShippoTransaction>(`/transactions/${id}`);
  }

  /**
   * POST /refunds/
   * Voids/refunds an unused label. Shippo may take minutes to process.
   */
  createRefund(transactionId: string): Promise<ShippoRefund> {
    return this.request<ShippoRefund>("/refunds/", {
      method: "POST",
      body: JSON.stringify({ transaction: transactionId, async: false }),
    });
  }

  /**
   * POST /returns/
   * Creates a return label from an existing outbound transaction's rate.
   */
  createReturn(input: {
    addressFrom: ShippoAddress;
    addressTo: ShippoAddress;
    parcels: ShippoParcel[];
    originalTransactionId?: string;
  }): Promise<ShippoShipment> {
    return this.request<ShippoShipment>("/shipments/", {
      method: "POST",
      body: JSON.stringify({
        address_from: input.addressFrom,
        address_to: input.addressTo,
        parcels: input.parcels,
        extra: {
          is_return: true,
          ...(input.originalTransactionId
            ? { reference_1: input.originalTransactionId }
            : {}),
        },
        async: false,
      }),
    });
  }

  /**
   * GET /tracks/{carrier}/{tracking_number}
   * Manual tracking poll — webhook path is preferred.
   */
  retrieveTracking(
    carrier: string,
    trackingNumber: string
  ): Promise<{ tracking_status?: { status: string; status_details?: string } }> {
    return this.request(`/tracks/${carrier}/${trackingNumber}`);
  }
}
