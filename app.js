// Compatibility/bootstrap layer for the existing app.
// The original application code is kept in app-original.js so the UI and
// existing behaviour stay unchanged.

(() => {
  const LISTENBRAINZ_ORIGIN = 'https://api.listenbrainz.org';
  const originalFetch = window.fetch.bind(window);

  // When hosted on Cloudflare Pages, use the same-origin Pages Function so
  // ListenBrainz receives the required identifying User-Agent. A custom proxy
  // can also be supplied before this script loads:
  //   window.LISTENBRAINZ_PROXY_BASE = 'https://example.com/api/listenbrainz';
  const proxyBase = window.LISTENBRAINZ_PROXY_BASE ||
    (window.location.hostname.endsWith('.pages.dev')
      ? `${window.location.origin}/api/listenbrainz`
      : null);

  function isListenBrainzUrl(url) {
    return url === LISTENBRAINZ_ORIGIN || url.startsWith(`${LISTENBRAINZ_ORIGIN}/`);
  }

  function toProxyUrl(url) {
    if (!proxyBase) return url;
    const relative = url.slice(LISTENBRAINZ_ORIGIN.length).replace(/^\//, '');
    return `${proxyBase.replace(/\/$/, '')}/${relative}`;
  }

  async function normalizeListenResponse(response, originalUrl) {
    if (!response.ok || !/\/1\/user\/[^/]+\/listens(?:\?|$)/.test(originalUrl)) {
      return response;
    }

    try {
      const data = await response.clone().json();
      const listens = data?.payload?.listens;

      if (!Array.isArray(listens)) return response;

      let changed = false;
      for (const listen of listens) {
        const topLevelMsid = listen?.recording_msid;
        const trackMetadata = listen?.track_metadata;
        if (!topLevelMsid || !trackMetadata) continue;

        if (!trackMetadata.additional_info) {
          trackMetadata.additional_info = {};
        }

        if (!trackMetadata.additional_info.recording_msid) {
          trackMetadata.additional_info.recording_msid = topLevelMsid;
          changed = true;
        }
      }

      if (!changed) return response;

      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json');
      headers.delete('Content-Length');

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.warn('Could not normalize ListenBrainz response:', error);
      return response;
    }
  }

  window.fetch = async function patchedFetch(input, init) {
    const originalUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input);

    if (!isListenBrainzUrl(originalUrl)) {
      return originalFetch(input, init);
    }

    const targetUrl = toProxyUrl(originalUrl);
    let response;

    if (input instanceof Request) {
      const request = new Request(targetUrl, input);
      response = await originalFetch(request, init);
    } else {
      response = await originalFetch(targetUrl, init);
    }

    return normalizeListenResponse(response, originalUrl);
  };

  // Load the existing application without changing its UI or behaviour.
  const script = document.createElement('script');
  script.src = 'app-original.js';
  script.async = false;
  document.body.appendChild(script);
})();
