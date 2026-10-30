// Practitioner / Organization entries shared by the lab and rehab builders (conditional create).
import type { PersonName, VerifiedIdentity } from "@brieftaube/shared";
import { SYSTEMS } from "@brieftaube/shared";
import type { BundleEntry, Identifier, Organization, Practitioner } from "fhir/r4.js";
import type { FilingContext } from "./types.ts";
import { displayName, humanName, roleDe, slug } from "./util.ts";

export function conditionalEntry(fullUrl: string, resource: Practitioner | Organization, system: string, value: string): BundleEntry {
  return {
    fullUrl,
    resource,
    request: { method: "POST", url: resource.resourceType, ifNoneExist: `identifier=${system}|${value}` },
  };
}

export function organizationEntry(fullUrl: string, name: string): BundleEntry {
  const value = slug(name);
  const org: Organization = { resourceType: "Organization", identifier: [{ system: SYSTEMS.organization, value }], active: true, name };
  return conditionalEntry(fullUrl, org, SYSTEMS.organization, value);
}

/** The verified sender: bPK (+ register number), name from the eID, contact from the request. */
export function senderEntry(fullUrl: string, ctx: FilingContext): BundleEntry {
  const { identity, register, request } = ctx;
  const identifier: Identifier[] = [{ system: SYSTEMS.eidBpk, value: identity.subject }];
  if (register.listed && register.registrationNumber) identifier.push({ system: SYSTEMS.physicianRegister, value: register.registrationNumber });
  const name: PersonName = { ...identity.name, prefix: identity.name.prefix?.length ? identity.name.prefix : request.recipient.name.prefix };
  const qualification = register.listed ? `${request.recipient.role} (${register.registerName.replace(/\s*\((.*)\)\s*$/, ", $1")})` : request.recipient.role;
  const p: Practitioner = {
    resourceType: "Practitioner",
    identifier,
    active: true,
    name: [humanName(name)],
    telecom: [{ system: request.recipient.channel === "email" ? "email" : "phone", value: request.recipient.address, use: "work" }],
  };
  if (qualification) p.qualification = [{ code: { text: qualification } }];
  return conditionalEntry(fullUrl, p, SYSTEMS.eidBpk, identity.subject);
}

/** A person named in the document (not identity-checked). */
export function documentAuthorEntry(fullUrl: string, organization: string, person: { name: PersonName; role?: string }): BundleEntry {
  const value = `${slug(organization)}/${slug(displayName(person.name, false))}`;
  const p: Practitioner = {
    resourceType: "Practitioner",
    identifier: [{ system: SYSTEMS.documentAuthor, value }],
    active: true,
    name: [humanName(person.name)],
  };
  const role = roleDe(person.role, person.name);
  if (role) p.qualification = [{ code: { text: `${role} (laut Dokument)` } }];
  return conditionalEntry(fullUrl, p, SYSTEMS.documentAuthor, value);
}

export function identitySentence(identity: VerifiedIdentity, at: string): string {
  return `ID Austria (simulated), level of assurance ${identity.levelOfAssurance}, at ${at}`;
}
