/**
 * Thin wrapper around the FluidPay REST API.
 *
 * Docs: https://sandbox.fluidpay.com/docs/
 *
 * Auth: Bearer token using the secret API key (`api_...`). Never expose
 * this key to the frontend — only the public key (`pub_...`) goes there
 * for the Tokenizer iframe.
 *
 * Endpoint paths below match FluidPay's public gateway docs at time of
 * writing; verify against your account's API reference before shipping.
 */

export type FluidPayClientOptions = {
  apiKey: string;
  /** Base URL, e.g. https://sandbox.fluidpay.com or https://app.fluidpay.com */
  baseUrl: string;
};

export type FluidPayTransaction = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  [key: string]: unknown;
};

type CreateTransactionInput = {
  /** "sale" (auth + capture) or "authorize" (auth only, capture later) */
  type: "sale" | "authorize";
  /** Amount in the smallest currency unit (cents for USD) */
  amount: number;
  currency: string;
  /** Token from the FluidPay Tokenizer iframe (starts with `tok_`) */
  paymentToken: string;
  /** Idempotency/reference id for reconciliation */
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

export class FluidPayClient {
  private apiKey: string;
  private baseUrl: string;

  constructor({ apiKey, baseUrl }: FluidPayClientOptions) {
    if (!apiKey) throw new Error("FluidPay apiKey is required");
    if (!baseUrl) throw new Error("FluidPay baseUrl is required");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    // FluidPay expects the secret key in the Authorization header verbatim,
    // NOT prefixed with "Bearer " — the Bearer form returns 401.
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: T;
      msg?: string;
      status?: string;
    };
    if (!res.ok || body.status === "error") {
      throw new Error(
        `FluidPay ${init.method ?? "GET"} ${path} failed: ${res.status} ${
          body.msg ?? res.statusText
        }`
      );
    }
    return (body.data ?? (body as unknown as T)) as T;
  }

  createTransaction(
    input: CreateTransactionInput
  ): Promise<FluidPayTransaction> {
    // TODO: verify the exact payload shape against FluidPay's /api/transaction docs.
    return this.request<FluidPayTransaction>("/api/transaction", {
      method: "POST",
      body: JSON.stringify({
        type: input.type,
        amount: input.amount,
        currency: input.currency,
        payment_method: { token: input.paymentToken },
        reference_id: input.referenceId,
        metadata: input.metadata,
      }),
    });
  }

  retrieveTransaction(id: string): Promise<FluidPayTransaction> {
    return this.request<FluidPayTransaction>(`/api/transaction/${id}`);
  }

  captureTransaction(
    id: string,
    amount?: number
  ): Promise<FluidPayTransaction> {
    return this.request<FluidPayTransaction>(
      `/api/transaction/${id}/capture`,
      {
        method: "POST",
        body: JSON.stringify(amount != null ? { amount } : {}),
      }
    );
  }

  refundTransaction(
    id: string,
    amount?: number
  ): Promise<FluidPayTransaction> {
    return this.request<FluidPayTransaction>(
      `/api/transaction/${id}/refund`,
      {
        method: "POST",
        body: JSON.stringify(amount != null ? { amount } : {}),
      }
    );
  }

  voidTransaction(id: string): Promise<FluidPayTransaction> {
    return this.request<FluidPayTransaction>(
      `/api/transaction/${id}/void`,
      { method: "POST" }
    );
  }
}
