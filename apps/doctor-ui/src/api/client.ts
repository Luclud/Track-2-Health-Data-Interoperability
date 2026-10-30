import type {
  ApiError,
  ChatMessageView,
  CreateRequestBody,
  CreateRequestResponse,
  DocumentRequestView,
  HeldDecisionResponse,
  MeResponse,
  PatientSnapshot,
  RecipientCheckBody,
  RecipientCheckResponse,
  RequestDetailResponse,
  UiConfigResponse,
} from "@brieftaube/shared";

/** Everything the doctor UI needs from the core (packages/shared/src/api.ts). */
export interface Api {
  uiConfig(): Promise<UiConfigResponse>;
  me(): Promise<MeResponse>;
  patients(q: string): Promise<PatientSnapshot[]>;
  recipientCheck(body: RecipientCheckBody): Promise<RecipientCheckResponse>;
  createRequest(body: CreateRequestBody): Promise<CreateRequestResponse>;
  listRequests(roomId: string): Promise<DocumentRequestView[]>;
  requestDetail(id: string): Promise<RequestDetailResponse>;
  release(id: string): Promise<HeldDecisionResponse>;
  reject(id: string): Promise<HeldDecisionResponse>;
  chatMessages(roomId: string): Promise<ChatMessageView[]>;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type AuthHeaders = () => Promise<Record<string, string>>;

export class HttpApi implements Api {
  constructor(
    private readonly authHeaders: AuthHeaders,
    private readonly base = "",
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", ...(await this.authHeaders()) };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const err = (data ?? {}) as Partial<ApiError>;
      throw new ApiRequestError(res.status, err.error ?? `http-${res.status}`, err.message ?? `Fehler ${res.status} vom Server`);
    }
    return data as T;
  }

  uiConfig() {
    return this.call<UiConfigResponse>("GET", "/api/ui-config");
  }
  me() {
    return this.call<MeResponse>("GET", "/api/me");
  }
  patients(q: string) {
    return this.call<PatientSnapshot[]>("GET", `/api/patients?q=${encodeURIComponent(q)}`);
  }
  recipientCheck(body: RecipientCheckBody) {
    return this.call<RecipientCheckResponse>("POST", "/api/recipient-check", body);
  }
  createRequest(body: CreateRequestBody) {
    return this.call<CreateRequestResponse>("POST", "/api/requests", body);
  }
  listRequests(roomId: string) {
    return this.call<DocumentRequestView[]>("GET", `/api/requests?roomId=${encodeURIComponent(roomId)}`);
  }
  requestDetail(id: string) {
    return this.call<RequestDetailResponse>("GET", `/api/requests/${encodeURIComponent(id)}`);
  }
  release(id: string) {
    return this.call<HeldDecisionResponse>("POST", `/api/requests/${encodeURIComponent(id)}/release`, {});
  }
  reject(id: string) {
    return this.call<HeldDecisionResponse>("POST", `/api/requests/${encodeURIComponent(id)}/reject`, {});
  }
  chatMessages(roomId: string) {
    return this.call<ChatMessageView[]>("GET", `/api/chat/messages?roomId=${encodeURIComponent(roomId)}`);
  }
}
