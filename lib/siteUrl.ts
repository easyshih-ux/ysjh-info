const LOCAL_SITE_URL = "http://localhost:3000";

export function getPublicSiteUrl(runtimeOrigin?: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return normalizeSiteUrl(configured || runtimeOrigin || LOCAL_SITE_URL);
}

function normalizeSiteUrl(value: string) {
  try {
    const url = new URL(value);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return LOCAL_SITE_URL;
  }
}
