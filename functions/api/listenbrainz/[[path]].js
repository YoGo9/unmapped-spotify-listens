const PRIMARY_ORIGIN = 'https://api.listenbrainz.org';
const FALLBACK_ORIGIN = 'https://listenbrainz.org';
const USER_AGENT = 'UnmappedSpotifyListens/1.2 ( https://github.com/YoGo9/unmapped-spotify-listens )';
const RETRYABLE_STATUSES = new Set([410, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526]);

function buildHeaders(request) {
  const headers = new Headers();
  const authorization = request.headers.get('Authorization');
  const contentType = request.headers.get('Content-Type');
  const accept = request.headers.get('Accept');

  if (authorization) headers.set('Authorization', authorization);
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Accept', accept || 'application/json');
  headers.set('User-Agent', USER_AGENT);

  return headers;
}

function buildUpstreamUrl(origin, path, search) {
  const url = new URL(`/${path}`, origin);
  url.search = search;
  return url;
}

async function fetchUpstream(origin, path, search, request, bodyBytes) {
  const init = {
    method: request.method,
    headers: buildHeaders(request),
    redirect: 'follow',
  };

  if (!['GET', 'HEAD'].includes(request.method) && bodyBytes) {
    init.body = bodyBytes;
  }

  return fetch(buildUpstreamUrl(origin, path, search), init);
}

function copyResponse(upstreamResponse, upstreamLabel) {
  const headers = new Headers();
  const contentType = upstreamResponse.headers.get('Content-Type');
  const retryAfter = upstreamResponse.headers.get('Retry-After');

  if (contentType) headers.set('Content-Type', contentType);
  if (retryAfter) headers.set('Retry-After', retryAfter);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Unmapped-Spotify-Proxy', '1.2');
  headers.set('X-Unmapped-Spotify-Upstream', upstreamLabel);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const request = context.request;
  const incomingUrl = new URL(request.url);
  const rawPath = context.params.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');
  const bodyBytes = ['GET', 'HEAD'].includes(request.method)
    ? null
    : await request.arrayBuffer();

  try {
    let upstreamLabel = 'api.listenbrainz.org';
    let upstreamResponse = await fetchUpstream(
      PRIMARY_ORIGIN,
      path,
      incomingUrl.search,
      request,
      bodyBytes,
    );

    if (RETRYABLE_STATUSES.has(upstreamResponse.status)) {
      upstreamLabel = 'listenbrainz.org';
      upstreamResponse = await fetchUpstream(
        FALLBACK_ORIGIN,
        path,
        incomingUrl.search,
        request,
        bodyBytes,
      );
    }

    return copyResponse(upstreamResponse, upstreamLabel);
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'ListenBrainz proxy request failed',
      detail: error instanceof Error ? error.message : String(error),
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Unmapped-Spotify-Proxy': '1.2',
      },
    });
  }
}
