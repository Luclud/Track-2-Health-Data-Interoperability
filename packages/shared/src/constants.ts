// Code systems and identifiers used across the project. See docs/FHIR-MAPPING.md.

export const SYSTEMS = {
  loinc: "http://loinc.org",
  ucum: "http://unitsofmeasure.org",
  v2_0074: "http://terminology.hl7.org/CodeSystem/v2-0074",
  observationCategory: "http://terminology.hl7.org/CodeSystem/observation-category",
  interpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  provenanceParticipant: "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
  dataOperation: "http://terminology.hl7.org/CodeSystem/v3-DataOperation",
  signatureType: "urn:iso-astm:E1762-95:2013",
  dicom: "http://dicom.nema.org/resources/ontology/DCM",
  auditEventAction: "http://hl7.org/fhir/audit-event-action",
  // Our own (synthetic) identifier systems
  mrn: "urn:example:klinikum-beispielstadt:mrn",
  organization: "urn:brieftaube:organization",
  securitySourceType: "http://terminology.hl7.org/CodeSystem/security-source-type",
  taskCode: "http://hl7.org/fhir/CodeSystem/task-code",
  matrixUser: "urn:brieftaube:matrix-user",
  eidBpk: "urn:brieftaube:mock-id-austria:bpk",
  physicianRegister: "urn:brieftaube:mock-aerzteliste",
  documentAuthor: "urn:brieftaube:document-author",
  requestReference: "urn:brieftaube:request",
  auditStep: "urn:brieftaube:audit-step",
  identityPolicy: "urn:brieftaube:identity-policy",
} as const;

export const SERVICE_NAME = "Brieftaube";
export const MATRIX_SERVER_NAME = "klinikum.example";
export const REQUESTER_ORG = "Klinikum Beispielstadt";

/** Link validity */
export const REQUEST_TTL_HOURS = 72;

export const DOCUMENT_TYPE_LABELS_DE: Record<"lab-result" | "rehab-discharge-report", string> = {
  "lab-result": "Laborbefund",
  "rehab-discharge-report": "Reha-Entlassungsbericht",
};
