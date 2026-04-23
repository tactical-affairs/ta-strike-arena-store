import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const useS3 = Boolean(process.env.S3_ACCESS_KEY_ID)

const fileProvider = useS3
  ? {
      resolve: "@medusajs/medusa/file-s3",
      id: "s3",
      options: {
        file_url: process.env.S3_FILE_URL,
        access_key_id: process.env.S3_ACCESS_KEY_ID,
        secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
        region: process.env.S3_REGION,
        bucket: process.env.S3_BUCKET,
        endpoint: process.env.S3_ENDPOINT,
      },
    }
  : {
      resolve: "@medusajs/medusa/file-local",
      id: "local",
    }

const paymentProviders: Array<Record<string, unknown>> = []
if (process.env.FLUIDPAY_API_KEY) {
  paymentProviders.push({
    resolve: "./src/modules/payment-fluidpay",
    id: "fluidpay",
    options: {
      apiKey: process.env.FLUIDPAY_API_KEY,
      publicKey: process.env.FLUIDPAY_PUBLIC_KEY,
      baseUrl:
        process.env.FLUIDPAY_BASE_URL ?? "https://sandbox.fluidpay.com",
      captureMode:
        (process.env.FLUIDPAY_CAPTURE_MODE as "sale" | "authorize") ??
        "authorize",
    },
  })
}

const fulfillmentProviders: Array<Record<string, unknown>> = [
  { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
]
if (process.env.SHIPPO_API_KEY) {
  fulfillmentProviders.push({
    resolve: "./src/modules/fulfillment-shippo",
    id: "shippo",
    options: {
      apiKey: process.env.SHIPPO_API_KEY,
      baseUrl: process.env.SHIPPO_BASE_URL,
      webhookSecret: process.env.SHIPPO_WEBHOOK_SECRET,
      fromAddress: {
        name: process.env.SHIPPO_FROM_NAME,
        street1: process.env.SHIPPO_FROM_STREET1 ?? "",
        street2: process.env.SHIPPO_FROM_STREET2,
        city: process.env.SHIPPO_FROM_CITY ?? "",
        state: process.env.SHIPPO_FROM_STATE ?? "",
        zip: process.env.SHIPPO_FROM_ZIP ?? "",
        country: process.env.SHIPPO_FROM_COUNTRY ?? "US",
        phone: process.env.SHIPPO_FROM_PHONE,
        email: process.env.SHIPPO_FROM_EMAIL,
      },
    },
  })
}

const modules: Array<Record<string, unknown>> = [
  {
    resolve: "@medusajs/medusa/file",
    options: { providers: [fileProvider] },
  },
  {
    resolve: "@medusajs/medusa/fulfillment",
    options: { providers: fulfillmentProviders },
  },
]
if (paymentProviders.length > 0) {
  modules.push({
    resolve: "@medusajs/medusa/payment",
    options: { providers: paymentProviders },
  })
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  modules,
})
