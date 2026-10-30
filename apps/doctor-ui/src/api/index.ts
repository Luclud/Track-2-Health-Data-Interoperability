import type { UiEnv } from "../env.ts";
import { DEV_USER } from "../env.ts";
import { HttpApi, type Api, type AuthHeaders } from "./client.ts";
import { MockApi } from "./mock.ts";

export function createApi(env: UiEnv, authHeaders?: AuthHeaders): Api {
  if (env.mock) return new MockApi(env.roomId, true, env.mockJury);
  return new HttpApi(authHeaders ?? (async () => ({ "X-Dev-User": env.userId || DEV_USER })));
}
