// Provenance for a filed answer (FHIR-MAPPING.md): who wrote it, who sent it (verified), who assembled it.
import { SYSTEMS } from "@brieftaube/shared";
import type { Provenance } from "fhir/r4.js";
import { narrative, viennaInstant } from "./util.ts";

export interface ProvenanceInput {
  targets: string[];
  authorUrn: string;
  informantUrn: string;
  organizationUrn: string;
  policy: string;
  assembler: string;
  fileName: string;
  sha256: string;
  occurredAt: string;
  recordedAt: string;
  signedAt: string;
  narrativeText: string;
}

const agentType = (code: string) => ({ coding: [{ system: SYSTEMS.provenanceParticipant, code }] });

export function buildProvenance(p: ProvenanceInput): Provenance {
  return {
    resourceType: "Provenance",
    text: narrative(p.narrativeText),
    target: p.targets.map((reference) => ({ reference })),
    occurredDateTime: viennaInstant(p.occurredAt),
    recorded: viennaInstant(p.recordedAt),
    policy: [`${SYSTEMS.identityPolicy}:${p.policy}`],
    activity: { coding: [{ system: SYSTEMS.dataOperation, code: "CREATE" }] },
    agent: [
      { type: agentType("author"), who: { reference: p.authorUrn }, onBehalfOf: { reference: p.organizationUrn } },
      { type: agentType("informant"), who: { reference: p.informantUrn }, onBehalfOf: { reference: p.organizationUrn } },
      { type: agentType("assembler"), who: { display: p.assembler } },
    ],
    entity: [{ role: "source", what: { display: `Uploaded file ${p.fileName} (sha256 ${p.sha256})` } }],
    signature: [
      {
        type: [{ system: SYSTEMS.signatureType, code: "1.2.840.10065.1.12.1.5" }],
        when: viennaInstant(p.signedAt),
        who: { reference: p.informantUrn },
      },
    ],
  };
}
