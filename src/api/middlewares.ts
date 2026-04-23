import { defineMiddlewares } from "@medusajs/framework/http";

export default defineMiddlewares({
  routes: [
    {
      // Preserve the raw body for Shippo webhooks so we can verify the
      // HMAC signature against the original bytes.
      method: ["POST"],
      matcher: "/hooks/shippo",
      bodyParser: { preserveRawBody: true },
    },
  ],
});
