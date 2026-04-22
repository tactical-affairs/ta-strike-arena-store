import {
  AbstractPaymentProvider,
  PaymentSessionStatus,
} from "@medusajs/framework/utils";
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types";
import {
  FluidPayClient,
  type FluidPayBillingAddress,
  type FluidPayTransaction,
} from "./client";

export type FluidPayProviderOptions = {
  apiKey: string;
  publicKey: string;
  baseUrl?: string;
  /**
   * "sale" captures immediately; "authorize" holds funds until capturePayment
   * is called. Defaults to "authorize" so admins can review before capturing.
   */
  captureMode?: "sale" | "authorize";
};

type InjectedDependencies = {
  logger: Logger;
};

/**
 * Shape stored on PaymentSession.data / Payment.data. Must be safe to expose
 * to the storefront (no secrets). Keep this narrow.
 */
type FluidPaySessionData = {
  /** FluidPay transaction ID once initiated. Null until the token is submitted. */
  transactionId: string | null;
  /** Public key passed through to the storefront for the Tokenizer iframe. */
  publicKey: string;
  amount: number;
  currency: string;
  status: string;
};

class FluidPayProviderService extends AbstractPaymentProvider<FluidPayProviderOptions> {
  static identifier = "fluidpay";

  protected logger_: Logger;
  protected options_: FluidPayProviderOptions;
  protected client_: FluidPayClient;

  constructor(
    { logger }: InjectedDependencies,
    options: FluidPayProviderOptions
  ) {
    super({ logger } as unknown as Record<string, unknown>, options);
    this.logger_ = logger;
    this.options_ = options;
    this.client_ = new FluidPayClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? "https://sandbox.fluidpay.com",
    });
  }

  /**
   * Called when a payment session is created during checkout. Stores the
   * public key + amount so the storefront can render the Tokenizer iframe,
   * and preserves any `paymentToken` the storefront passed through
   * (typical flow: tokenize on the client first, then submit session data
   * including the `tok_...` — `authorizePayment` reads it from here).
   */
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const incoming = (input.data ?? {}) as Partial<
      FluidPaySessionData & { paymentToken?: string }
    >;
    const data: FluidPaySessionData & { paymentToken?: string } = {
      transactionId: incoming.transactionId ?? null,
      publicKey: this.options_.publicKey,
      amount: Number(input.amount),
      currency: input.currency_code,
      status: incoming.status ?? "pending",
      ...(incoming.paymentToken
        ? { paymentToken: incoming.paymentToken }
        : {}),
    };
    return { id: `fluidpay_pending_${Date.now()}`, data };
  }

  /**
   * Called after the storefront sends the tokenized card to Medusa.
   * input.data is expected to include `{ paymentToken: "tok_..." }` from the
   * client — wire that through in the storefront's payment-session update
   * call. This method charges (captureMode="sale") or authorizes the card.
   */
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = input.data as FluidPaySessionData & {
      paymentToken?: string;
    };
    if (!data.paymentToken) {
      throw new Error(
        "FluidPay: paymentToken missing from session data. The storefront must update the payment session with the token returned by the Tokenizer iframe before authorizing."
      );
    }

    const txn = await this.client_.createTransaction({
      type: this.options_.captureMode ?? "authorize",
      amount: data.amount,
      currency: data.currency,
      paymentToken: data.paymentToken,
      billingAddress: extractBillingAddress(input),
    });

    this.logger_.debug(
      `[fluidpay] authorize response: id=${txn.id} status=${txn.status}`
    );

    return {
      status: this.mapStatus(txn.status),
      data: {
        ...data,
        transactionId: txn.id,
        status: txn.status,
      },
    };
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const data = input.data as FluidPaySessionData;
    if (!data.transactionId) {
      throw new Error("FluidPay: no transactionId to capture");
    }
    const txn = await this.client_.captureTransaction(data.transactionId);
    return { data: { ...data, status: txn.status } };
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const data = input.data as FluidPaySessionData;
    if (!data.transactionId) {
      throw new Error("FluidPay: no transactionId to refund");
    }
    const txn = await this.client_.refundTransaction(
      data.transactionId,
      Number(input.amount)
    );
    return { data: { ...data, status: txn.status } };
  }

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    const data = input.data as FluidPaySessionData;
    if (!data.transactionId) return { data };
    // FluidPay uses "void" for cancelling an authorized-but-not-captured txn.
    const txn = await this.client_.voidTransaction(data.transactionId);
    return { data: { ...data, status: txn.status } };
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const data = input.data as FluidPaySessionData;
    if (!data.transactionId) return { data };
    const txn = await this.client_.retrieveTransaction(data.transactionId);
    return { data: { ...data, status: txn.status } };
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const data = input.data as FluidPaySessionData;
    if (!data.transactionId) {
      return { status: "pending" as PaymentSessionStatus };
    }
    const txn = await this.client_.retrieveTransaction(data.transactionId);
    return { status: this.mapStatus(txn.status), data: { ...data, status: txn.status } };
  }

  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    // FluidPay charges are created in authorizePayment once a token exists;
    // the session itself just tracks amount/currency. Update those and return.
    return {
      data: {
        ...(input.data as FluidPaySessionData),
        amount: Number(input.amount),
        currency: input.currency_code,
      },
    };
  }

  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    // Nothing to delete on FluidPay's side — if there's a transaction it's
    // either already captured (kept for audit) or should be voided via cancelPayment.
    return { data: input.data };
  }

  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    // TODO: implement once FluidPay webhooks are configured.
    // See https://sandbox.fluidpay.com/docs/ for event types.
    return { action: "not_supported" };
  }

  private mapStatus(fluidpayStatus: string): PaymentSessionStatus {
    // TODO: confirm full list of FluidPay transaction statuses in prod.
    switch (fluidpayStatus) {
      case "approved":
      case "authorized":
        return "authorized" as PaymentSessionStatus;
      case "captured":
      case "settled":
        return "captured" as PaymentSessionStatus;
      case "voided":
      case "cancelled":
        return "canceled" as PaymentSessionStatus;
      case "declined":
      case "failed":
        return "error" as PaymentSessionStatus;
      default:
        return "pending" as PaymentSessionStatus;
    }
  }
}

/**
 * Pulls the cart's billing address out of Medusa's payment-provider
 * context and maps it to FluidPay's address shape (for AVS on the
 * card-issuer side). Medusa's PaymentAddressDTO only exposes the
 * generic address fields — recipient name comes from
 * context.customer.{first_name,last_name}.
 */
function extractBillingAddress(
  input: AuthorizePaymentInput,
): FluidPayBillingAddress | undefined {
  const customer = input.context?.customer;
  const ba = customer?.billing_address;
  if (!ba) return undefined;
  return {
    first_name: customer?.first_name ?? undefined,
    last_name: customer?.last_name ?? undefined,
    address_line_1: ba.address_1 ?? undefined,
    address_line_2: ba.address_2 ?? undefined,
    city: ba.city ?? undefined,
    state: ba.province ?? undefined,
    postal_code: ba.postal_code ?? undefined,
    country: ba.country_code?.toUpperCase() ?? undefined,
    email: customer?.email ?? undefined,
    phone: ba.phone ?? customer?.phone ?? undefined,
  };
}

export default FluidPayProviderService;
