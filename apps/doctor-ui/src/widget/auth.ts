import { WidgetApi, type IOpenIDCredentials } from "matrix-widget-api";
import type { AuthHeaders } from "../api/client.ts";
import type { UiEnv } from "../env.ts";

const READY_TIMEOUT_MS = 10_000;
/** Refresh the OpenID token this long before Synapse says it expires. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Widget mode auth: talk to Element over postMessage (matrix-widget-api), ask for
 * Matrix OpenID credentials and send them to the core as `Authorization: Bearer`.
 * The core verifies them at Synapse's /openid/userinfo.
 */
export function createWidgetAuth(env: UiEnv): AuthHeaders {
  const origin = env.parentUrl ? new URL(env.parentUrl).origin : undefined;
  const api = new WidgetApi(env.widgetId, origin);
  const ready = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Element antwortet nicht (Widget-API).")), READY_TIMEOUT_MS);
    api.once("ready", () => {
      clearTimeout(t);
      resolve();
    });
  });
  api.start();

  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  async function fetchToken(): Promise<string> {
    await ready;
    const creds: IOpenIDCredentials = await api.requestOpenIDConnectToken();
    if (!creds.access_token) throw new Error("Element hat kein OpenID-Token geliefert.");
    cached = { token: creds.access_token, expiresAt: Date.now() + (creds.expires_in ?? 3600) * 1000 };
    return creds.access_token;
  }

  return async () => {
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return { Authorization: `Bearer ${cached.token}` };
    pending ??= fetchToken().finally(() => {
      pending = undefined;
    });
    return { Authorization: `Bearer ${await pending}` };
  };
}
