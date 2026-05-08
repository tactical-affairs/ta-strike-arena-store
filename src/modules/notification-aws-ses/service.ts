/**
 * AWS SES SMTP notification provider.
 *
 * Sends transactional email through Amazon SES via nodemailer. The same
 * SES identity (strikearena.net + custom MAIL FROM mail.strikearena.net,
 * us-east-2) and SMTP credentials are shared with ta-nexus and the
 * marketing site's /api/contact route.
 *
 * Subscribers call `notificationModuleService.createNotifications({
 *   to, channel: "email", template, content: { subject, html, text },
 *   data, attachments?, replyTo?, ...
 * })`. This provider's `send()` pulls subject/html/text from content
 * and delegates to nodemailer.
 *
 * Required runtime env: AWS_SMTP_ENDPOINT, AWS_SMTP_USERNAME,
 * AWS_SMTP_PASSWORD. Optional: MEDUSA_EMAIL_FROM (default
 * '"Strike Arena" <orders@strikearena.net>').
 */

import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils";
import type { Logger } from "@medusajs/framework/types";
import nodemailer, { type Transporter } from "nodemailer";

type Options = {
  endpoint: string;
  username: string;
  password: string;
  from: string;
};

type InjectedDependencies = {
  logger: Logger;
};

class AwsSesNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "aws-ses";

  protected readonly logger_: Logger;
  protected readonly transporter_: Transporter;
  protected readonly from_: string;

  constructor({ logger }: InjectedDependencies, options: Options) {
    super();
    if (!options?.endpoint || !options?.username || !options?.password) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "AWS SES notification provider requires endpoint, username, and password options",
      );
    }
    this.logger_ = logger;
    this.from_ = options.from;
    this.transporter_ = nodemailer.createTransport({
      host: options.endpoint,
      port: 465,
      secure: true,
      auth: { user: options.username, pass: options.password },
    });
  }

  async send(
    notification: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const to = notification.to as string | undefined;
    const channel = (notification.channel as string | undefined) ?? "email";
    if (channel !== "email") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `AWS SES notification provider only handles the 'email' channel (got '${channel}')`,
      );
    }
    if (!to) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Notification 'to' is required",
      );
    }

    const content = (notification.content ?? {}) as {
      subject?: string;
      html?: string;
      text?: string;
      replyTo?: string;
    };
    const data = (notification.data ?? {}) as Record<string, unknown>;

    const subject =
      content.subject ?? (data.subject as string | undefined) ?? "Strike Arena";
    const html = content.html ?? (data.html as string | undefined);
    const text = content.text ?? (data.text as string | undefined);
    const replyTo =
      content.replyTo ?? (data.replyTo as string | undefined);

    if (!html && !text) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Notification content must include html or text",
      );
    }

    try {
      const info = await this.transporter_.sendMail({
        from: this.from_,
        to,
        subject,
        html,
        text,
        replyTo,
      });
      return { id: info.messageId };
    } catch (err) {
      this.logger_.error(
        `AWS SES send failed for ${to}: ${(err as Error).message}`,
      );
      throw err;
    }
  }
}

export default AwsSesNotificationProviderService;
