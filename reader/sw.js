// Doc Reader helper. It does two things, both only for this folder:
// 1. Adds the two security headers that let the voice engine use several
//    processor cores (GitHub Pages cannot send them itself).
// 2. Keeps a copy of the page so it still opens with no signal.
// It never sends anything anywhere.
const CACHE = "docreader-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave other sites alone
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  e.respondWith(
    (async () => {
      let res;
      try {
        res = await fetch(req);
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
      } catch (err) {
        res = await caches.match(req, { ignoreSearch: true });
        if (!res) throw err;
      }
      if (!res || res.status === 0) return res;
      const h = new Headers(res.headers);
      h.set("Cross-Origin-Embedder-Policy", "require-corp");
      h.set("Cross-Origin-Opener-Policy", "same-origin");
      h.set("Cross-Origin-Resource-Policy", "same-origin");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    })()
  );
});
