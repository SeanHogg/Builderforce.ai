/** Validate the URL shape for remote registration. The gateway checks whether the destination is public. */
export function isRemoteMcpEndpoint(value: string): boolean {
  const input = value.trim();
  if (!/^https:\/\/\S+$/i.test(input)) return false;
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
