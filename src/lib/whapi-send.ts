const WHAPI_BASE = "https://gate.whapi.cloud";

export async function sendWhapiText(
  token: string,
  whapiId: string,
  body: string
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const res = await fetch(`${WHAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: whapiId, body }),
  });

  const bodyText = await res.text();
  return { ok: res.ok, status: res.status, bodyText };
}

export function looksLikeKickOrForbidden(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}
