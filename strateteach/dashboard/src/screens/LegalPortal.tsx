import Portal from "./Portal";

// The Legal Portal is the generic Portal bound to the "legal" domain — the private workspace
// between the legal counsel (Raz) and the three owners. All behaviour lives in Portal.tsx.
export default function LegalPortal() {
  return <Portal domain="legal" />;
}
