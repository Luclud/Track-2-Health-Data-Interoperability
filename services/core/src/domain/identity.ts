// CORE-4 identity policy (DESIGN.md §1): eID LoA high + name match (+ physician register for lab results).
import type { DocumentRequest, IdentityPolicyId, PersonName, RegisterResult, VerifiedIdentity } from "@brieftaube/shared";
import { formatPersonName, parsePersonName, samePerson } from "../parser/names.ts";
import type { PhysicianRegister } from "../ports.ts";

export const REGISTER_NAME = "Ärzteliste (simuliert)";

/** The doctor types the recipient as one string: last token = family, rest = given, titles → prefix. */
export function parseRecipientName(displayName: string): PersonName {
  return parsePersonName(displayName);
}

/** Family name and first given name equal after normalisation; titles ignored. */
export function matchesRecipient(recipient: PersonName, verified: PersonName): boolean {
  return samePerson(recipient, verified);
}

export function policyFor(r: DocumentRequest): IdentityPolicyId {
  return r.documentType === "lab-result" ? "eid-high+register" : "eid-high";
}

export function registerApplies(r: DocumentRequest): boolean {
  return policyFor(r) === "eid-high+register" && r.recipient.isPhysician;
}

export async function lookupRegister(r: DocumentRequest, identity: VerifiedIdentity, register: PhysicianRegister): Promise<RegisterResult> {
  if (!registerApplies(r)) return { checked: false, listed: false, registerName: REGISTER_NAME };
  return register.lookup(identity);
}

export type IdentityDecision =
  | { ok: true; policy: IdentityPolicyId }
  | { ok: false; reason: "name-mismatch" | "loa-too-low" };

export function decideIdentity(r: DocumentRequest, identity: VerifiedIdentity): IdentityDecision {
  if (identity.levelOfAssurance !== "high") return { ok: false, reason: "loa-too-low" };
  if (!matchesRecipient(r.recipient.name, identity.name)) return { ok: false, reason: "name-mismatch" };
  return { ok: true, policy: policyFor(r) };
}

export function identityDisplay(identity: VerifiedIdentity): string {
  return formatPersonName(identity.name);
}

export function chatIdentityMismatch(r: DocumentRequest, identity: VerifiedIdentity): string {
  return (
    `⚠️ ${r.reference}: Jemand anderer als ${r.recipient.displayName} hat versucht, die Anfrage zu öffnen ` +
    `(verifiziert als: ${formatPersonName(identity.name, false)}). Es wurde nichts angezeigt. Bitte Adresse prüfen: ${r.recipient.address}`
  );
}
