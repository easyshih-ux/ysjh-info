const LOCAL_SITE_URL = "http://localhost:3000";

export function getPublicSiteUrl(runtimeOrigin?: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return configured
    ? normalizeSiteUrl(configured, true)
    : normalizeSiteUrl(runtimeOrigin || LOCAL_SITE_URL, false);
}

function normalizeSiteUrl(value: string, preservePath: boolean) {
  try {
    const url = new URL(value);
    url.pathname = preservePath ? `${url.pathname.replace(/\/+$/, "")}/` : "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return LOCAL_SITE_URL;
  }
}
