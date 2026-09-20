export function isLineWebView(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && /(?:^|[\s;])Line\/[\d.]+/i.test(userAgent);
}

export function shouldWarnBeforeGoogleLogin(
  userAgent: string | null | undefined = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return isLineWebView(userAgent);
}
