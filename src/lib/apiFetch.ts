/**
 * Drop-in wrapper around the native fetch that automatically attaches the
 * stored JWT token as `Authorization: Bearer <token>`.
 *
 * On a 401 response the stored session is cleared and the user is sent to
 * /login so expired tokens never leave the user stuck.
 *
 * Usage - same signature as fetch():
 *   const res = await apiFetch("/api/customers");
 *   const res = await apiFetch("/api/communicate/sms", { method: "POST", body: JSON.stringify({...}) });
 */
const TOKEN_KEY = "tp_crm_token";
const USER_KEY  = "tp_crm_user";

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;

  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.replace("/login");
  }

  return res;
}
