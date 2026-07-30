import Portal from "./Portal";

// The Business Development Portal is the generic Portal bound to the "biz" domain — the private
// workspace between the head of business development (Raful) and the three owners. All behaviour
// lives in Portal.tsx: chat / sections / tasks (fully editable, same pm_tasks system) / summary
// report, plus the shared owner tabs (daily / overview / team / board / vote). Everything EXCEPT
// finances — finance stays owner-only in /owners.
export default function BizPortal() {
  return <Portal domain="biz" />;
}
