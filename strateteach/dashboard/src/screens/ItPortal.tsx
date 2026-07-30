import Portal from "./Portal";

// The IT Portal is the generic Portal bound to the "it" domain — the private workspace between
// the IT lead (Oren) and the three owners. All behaviour lives in Portal.tsx. Phase 2 ships the
// chat / sections / tasks tabs; the IT editing (notes + system links) tab and the IT summary
// report land in a later phase.
export default function ItPortal() {
  return <Portal domain="it" />;
}
