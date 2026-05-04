const WHAPI_BASE = "https://gate.whapi.cloud";

/** WhatsApp URL linkification breaks if ZWSP / word joiners sit next to https:// links. */
export function normalizeWhatsAppPlainText(text: string): string {
  return text.replace(/\u2060|\u200B|\u200C|\u200D|\uFEFF/g, "").replace(/\r\n/g, "\n");
}

export async function sendWhapiText(
  token: string,
  whapiId: string,
  body: string
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const payload = normalizeWhatsAppPlainText(body);

  const res = await fetch(`${WHAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: whapiId,
      body: payload,
      no_link_preview: false,
    }),
  });

  const bodyText = await res.text();
  return { ok: res.ok, status: res.status, bodyText };
}

export function looksLikeKickOrForbidden(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}
