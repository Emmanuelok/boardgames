/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the billing/entitlements backend (e.g. https://api.example.com).
   * Leave unset to run fully client-side — checkout then shows an honest
   * "not connected" note instead of redirecting to Stripe. See /serverless.
   */
  readonly VITE_API_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
