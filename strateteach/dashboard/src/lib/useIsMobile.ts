import { useEffect, useState } from "react";

/** True when the viewport is narrower than `bp` (phones + small tablets). */
export function useIsMobile(bp = 860): boolean {
  const get = () => (typeof window !== "undefined" ? window.innerWidth < bp : false);
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    const on = () => setMobile(get());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, [bp]); // eslint-disable-line
  return mobile;
}
