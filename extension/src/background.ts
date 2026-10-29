/** Relais vers l'API locale : le service worker n'est pas soumis au CORS de la page PSA. */
chrome.runtime.onMessage.addListener((msg: { type: string; path: string; method?: string; body?: unknown }, _sender, sendResponse) => {
  if (msg.type !== "api") return;
  (async () => {
    const { serverUrl = "http://localhost:3000" } = (await chrome.storage.local.get("serverUrl")) as { serverUrl?: string };
    try {
      const res = await fetch(`${serverUrl}${msg.path}`, {
        method: msg.method ?? "GET",
        headers: msg.body ? { "Content-Type": "application/json" } : undefined,
        body: msg.body ? JSON.stringify(msg.body) : undefined,
      });
      const data = await res.json();
      sendResponse(res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `HTTP ${res.status}` });
    } catch (e) {
      sendResponse({ ok: false, error: `Application locale injoignable (${serverUrl}) : lance « npm run dev ». ${e instanceof Error ? e.message : ""}` });
    }
  })();
  return true;
});
