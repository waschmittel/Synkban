// Minimal service worker — required for Android install prompt.
// No offline caching: requests pass through to the network unchanged.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
