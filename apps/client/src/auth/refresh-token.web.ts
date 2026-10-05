// On the web the refresh token lives in an HttpOnly cookie the page can't read, so there's
// nothing to store here; the server sets and clears it.
export const loadRefreshToken = async (): Promise<string | null> => null;
export const saveRefreshToken = async (_token: string) => {};
export const clearRefreshToken = async () => {};
