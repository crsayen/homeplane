export function normalizePath(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }
  return pathname.replace(/\/+$/, "");
}
