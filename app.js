// Compatibility/bootstrap layer for the existing app.
// The original application code is kept in app-original.js so the UI and
// existing behaviour stay unchanged.

(() => {
  const LISTENBRAINZ_ORIGIN = 'https://api.listenbrainz.org';
  const originalFetch = window.fetch.bind(window);
  const REQUEST_TIMEOUT_MS = 90000;
  const RETRYABLE_PROXY_STATUSES = new Set([410, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526]);

  // When hosted on Cloudflare Pages, use the same-origin Pages Function so
  // ListenBrainz receives the required identifying User-Agent. A custom proxy
  // can also be supplied before this script loads:
  //   window.LISTENBRAINZ_PROXY_BASE = 'https://example.com/api/listenbrainz';
  const proxyBase = window.LISTENBRAINZ_PROXY_BASE ||
    (window.location.hostname.endsWith('.pages.dev')
      ? `${window.location.origin}/api/listenbrainz`
      : null);

  function getRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (input instanceof Request) return input.url;
    return String(input);
  }

  function isListenBrainzUrl(url) {
    return url === LISTENBRAINZ_ORIGIN || url.startsWith(`${LISTENBRAINZ_ORIGIN}/`);
  }

  function toProxyUrl(url) {
    if (!proxyBase) return url;
    const relative = url.slice(LISTENBRAINZ_ORIGIN.length).replace(/^\//, '');
    return `${proxyBase.replace(/\/$/, '')}/${relative}`;
  }

  async function fetchWithTimeout(input, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const suppliedSignal = init?.signal;

    if (suppliedSignal) {
      if (suppliedSignal.aborted) {
        controller.abort();
      } else {
        suppliedSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    try {
      return await originalFetch(input, {
        ...(init || {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function performFetch(targetUrl, input, init) {
    if (input instanceof Request) {
      const request = new Request(targetUrl, input);
      return fetchWithTimeout(request, init);
    }
    return fetchWithTimeout(targetUrl, init);
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
    const originalUrl = getRequestUrl(input);

    if (!isListenBrainzUrl(originalUrl)) {
      return originalFetch(input, init);
    }

    // Prefer the Cloudflare Pages proxy because it can send the identifying
    // User-Agent required by ListenBrainz. Retry transient/proxy-style errors,
    // including 410 responses occasionally seen from the API host.
    if (proxyBase) {
      let proxyResponse = null;

      try {
        proxyResponse = await performFetch(toProxyUrl(originalUrl), input, init);

        if (!RETRYABLE_PROXY_STATUSES.has(proxyResponse.status)) {
          return normalizeListenResponse(proxyResponse, originalUrl);
        }

        console.warn(`ListenBrainz proxy returned ${proxyResponse.status}; retrying direct request.`);
      } catch (error) {
        console.warn('ListenBrainz proxy request failed; retrying direct request.', error);
      }

      try {
        const directResponse = await performFetch(originalUrl, input, init);
        return normalizeListenResponse(directResponse, originalUrl);
      } catch (error) {
        if (proxyResponse) {
          return proxyResponse;
        }
        throw error;
      }
    }

    const response = await performFetch(originalUrl, input, init);
    return normalizeListenResponse(response, originalUrl);
  };

  // Load the existing application without changing its UI or behaviour.
  const script = document.createElement('script');
  script.src = 'app-original.js';
  script.async = false;
  document.body.appendChild(script);
})();
