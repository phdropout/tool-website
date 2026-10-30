(() => {
  const root = document.querySelector("[data-analytics-consent]");
  // No analytics or consent prompt in localhost previews or other deployments.
  if (!root || !["papersandpixels.net", "www.papersandpixels.net"].includes(window.location.hostname)) return;
  const id = root.dataset.measurementId;
  if (!/^G-[A-Z0-9]+$/.test(id)) return;
  const key = "papers-and-pixels-analytics-v1";
  const lifetime = 180 * 24 * 60 * 60 * 1000;
  const disableKey = `ga-disable-${id}`;
  const find = (name) => root.querySelector(`[data-analytics-${name}]`);
  const denied = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
  let choice = null, started = false, loaded = false, configured = false, returningFocus = null;
  window[disableKey] = true;

  function read(value) {
    try {
      const saved = JSON.parse(value);
      if (!["accepted", "declined"].includes(saved?.choice) || !Number.isFinite(saved.time)) return null;
      const age = Date.now() - saved.time;
      return age >= 0 && age < lifetime ? saved.choice : null;
    } catch { return null; }
  }
  function cleanUrl(value) {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : ""; }
    catch { return ""; }
  }
  function tag() { window.dataLayer.push(arguments); }
  function clearCookies() {
    const domains = ["", window.location.hostname, "." + window.location.hostname, "papersandpixels.net", ".papersandpixels.net"];
    try {
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.trim().split("=")[0];
        if (!/^_ga(?:_|$)/.test(name)) continue;
        for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax${domain ? `; domain=${domain}` : ""}`;
      }
    } catch { /* Browsers may block cookie access altogether. */ }
  }
  function start() {
    window[disableKey] = false;
    if (started) {
      window.gtag("consent", "update", { ...denied, analytics_storage: "granted" });
      if (loaded) configure();
      return;
    }
    started = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = tag;
    tag("consent", "default", denied);
    tag("consent", "update", { ...denied, analytics_storage: "granted" });
    tag("js", new Date());
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    script.onload = () => {
      loaded = true;
      // Consent may have been withdrawn while the download was in flight.
      if (choice !== "accepted") return;
      configure();
    };
    script.onerror = () => { script.remove(); started = false; loaded = false; };
    document.head.append(script);
  }
  function configure() {
    if (configured) return;
    configured = true;
    tag("config", id, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: cleanUrl(window.location.href),
      page_referrer: cleanUrl(document.referrer),
      page_title: document.title,
      cookie_expires: lifetime / 1000,
      cookie_update: false,
    });
  }
  function apply(value) {
    choice = value;
    if (value === "accepted") {
      start();
    } else {
      window[disableKey] = true;
      if (started) tag("consent", "update", denied);
      clearCookies();
    }
    root.hidden = value !== null;
    find("current").textContent = value ? `Current choice: analytics ${value === "accepted" ? "enabled" : "disabled"}.` : "";
  }
  function choose(value) {
    try { localStorage.setItem(key, JSON.stringify({ choice: value, time: Date.now() })); }
    catch { /* The choice still applies to this page when storage is blocked. */ }
    apply(value);
    returningFocus?.focus(); returningFocus = null;
  }
  find("accept").addEventListener("click", () => choose("accepted"));
  find("decline").addEventListener("click", () => choose("declined"));
  document.querySelectorAll("[data-analytics-settings]").forEach((button) => {
    button.hidden = false;
    button.addEventListener("click", () => { returningFocus = button; root.hidden = false; find("decline").focus(); });
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) apply(read(event.key === null ? null : event.newValue));
  });
  let saved = null;
  try { saved = read(localStorage.getItem(key)); } catch { /* Ask on this page. */ }
  apply(saved);
})();
