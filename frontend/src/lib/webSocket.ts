export function toWebSocketUrl(apiBaseUrl: string): string {
  const parsed = new URL(apiBaseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/ws/entities";
  parsed.search = "";
  return parsed.toString();
}
