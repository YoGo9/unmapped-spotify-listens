// Compatibility/bootstrap layer for the existing app.
// The original application code is kept in app-original.js so the UI and
// existing behaviour stay unchanged.

(() => {
  const LISTENBRAINZ_ORIGIN = 'https://api.listenbrainz.org';
  const originalFetch = window.fetch.bind(window);
  const REQUEST_TIMEOUT_MS = 90000;
  const LISTEN_PAGE_SIZE = 100;
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

  function getRequestMethod(input, init) {
    return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  }

  function isListenBrainzUrl(url) {
    return url === LISTENBRAINZ_ORIGIN || url.startsWith(`${LISTENBRAINZ_ORIGIN}/`);
  }

  function isUserListensUrl(url) {
    try {
      const parsed = new URL(url);
      return /^\/1\/user\/[^/]+\/listens$/.test(parsed.pathname);
    } catch {
      return false;
    }
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

  async function fetchListenBrainzOnce(originalUrl, input, init) {
    // Prefer the Cloudflare Pages proxy because it can send the identifying
    // User-Agent required by ListenBrainz. If the proxy gets a retired/failed
    // upstream response, retry the original browser request.
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
  }

  async function fetchListenPages(originalUrl, input, init) {
    const requestedUrl = new URL(originalUrl);
    const requestedCount = Math.max(1, Number.parseInt(requestedUrl.searchParams.get('count') || '25', 10) || 25);

    if (requestedCount <= LISTEN_PAGE_SIZE || requestedUrl.searchParams.has('min_ts')) {
      return fetchListenBrainzOnce(originalUrl, input, init);
    }

    const combinedListens = [];
    let remaining = requestedCount;
    let nextMaxTs = requestedUrl.searchParams.get('max_ts');
    let firstPayload = null;
    let lastHeaders = null;

    while (remaining > 0) {
      const pageSize = Math.min(LISTEN_PAGE_SIZE, remaining);
      const pageUrl = new URL(originalUrl);
      pageUrl.searchParams.set('count', String(pageSize));

      if (nextMaxTs) {
        pageUrl.searchParams.set('max_ts', String(nextMaxTs));
      } else {
        pageUrl.searchParams.delete('max_ts');
      }

      const pageResponse = await fetchListenBrainzOnce(pageUrl.toString(), input, init);
      if (!pageResponse.ok) {
        return pageResponse;
      }

      lastHeaders = new Headers(pageResponse.headers);

      let pageData;
      try {
        pageData = await pageResponse.json();
      } catch (error) {
        console.warn('Could not parse paged ListenBrainz response:', error);
        return pageResponse;
      }

      const pageListens = pageData?.payload?.listens;
      if (!Array.isArray(pageListens)) {
        return new Response(JSON.stringify(pageData), {
          status: pageResponse.status,
          statusText: pageResponse.statusText,
          headers: lastHeaders,
        });
      }

      if (!firstPayload && pageData?.payload) {
        firstPayload = { ...pageData.payload };
      }

      combinedListens.push(...pageListens);
      remaining = requestedCount - combinedListens.length;

      if (pageListens.length < pageSize || remaining <= 0) {
        break;
      }

      const oldest = pageListens[pageListens.length - 1]?.listened_at;
      if (!Number.isFinite(Number(oldest))) {
        break;
      }

      nextMaxTs = Number(oldest);
    }

    const payload = firstPayload || {};
    payload.listens = combinedListens.slice(0, requestedCount);
    payload.count = payload.listens.length;

    const headers = lastHeaders || new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store');
    headers.delete('Content-Length');
    headers.set('X-Unmapped-Spotify-Paged', '1');

    return new Response(JSON.stringify({ payload }), {
      status: 200,
      headers,
    });
  }

  window.fetch = async function patchedFetch(input, init) {
    const originalUrl = getRequestUrl(input);

    if (!isListenBrainzUrl(originalUrl)) {
      return originalFetch(input, init);
    }

    if (getRequestMethod(input, init) === 'GET' && isUserListensUrl(originalUrl)) {
      return fetchListenPages(originalUrl, input, init);
    }

    return fetchListenBrainzOnce(originalUrl, input, init);
  };

  function loadMatchingEnhancements() {
    if (!document.getElementById('matching-production-style')) {
      const style = document.createElement('style');
      style.id = 'matching-production-style';
      style.textContent = '.matching-debug-banner { display: none !important; }';
      document.head.appendChild(style);
    }

    if (document.getElementById('matching-production-loader')) return;

    const matcher = document.createElement('script');
    matcher.id = 'matching-production-loader';
    matcher.src = 'matching-debug.js';
    matcher.async = false;
    matcher.addEventListener('load', () => {
      if (document.getElementById('filter-production-loader')) return;
      const filter = document.createElement('script');
      filter.id = 'filter-production-loader';
      filter.src = 'filter-debug.js';
      filter.async = false;
      document.body.appendChild(filter);
    });
    document.body.appendChild(matcher);
  }

  // Load the existing application first, then the tested matching/filter tools.
  const script = document.createElement('script');
  script.src = 'app-original.js';
  script.async = false;
  script.addEventListener('load', loadMatchingEnhancements);
  document.body.appendChild(script);
})();
