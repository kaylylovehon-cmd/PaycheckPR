const SERVER_TOKEN_KEY = 'paycheck_rp_server_token_v1';
let inMemoryServerToken: string | null = null;

export function setServerAuthToken(token: string): void {
  inMemoryServerToken = token;
  try {
    sessionStorage.setItem(SERVER_TOKEN_KEY, token);
  } catch {
    // Ignore storage restrictions in sandboxed iframes
  }
}

export function getServerAuthToken(): string | null {
  if (inMemoryServerToken) {
    return inMemoryServerToken;
  }
  try {
    const stored = sessionStorage.getItem(SERVER_TOKEN_KEY);
    if (stored) {
      inMemoryServerToken = stored;
      return stored;
    }
  } catch {
    // Ignore storage restrictions
  }
  return null;
}

export function clearServerAuthToken(): void {
  inMemoryServerToken = null;
  try {
    sessionStorage.removeItem(SERVER_TOKEN_KEY);
  } catch {
    // Ignore storage restrictions
  }
}
