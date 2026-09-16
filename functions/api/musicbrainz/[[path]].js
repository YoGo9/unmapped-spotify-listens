const MUSICBRAINZ_ORIGIN = 'https://musicbrainz.org';
const USER_AGENT = 'UnmappedSpotifyListens-Issue9Debug/0.1 ( https://github.com/YoGo9/unmapped-spotify-listens )';

function buildUpstreamUrl(path, search) {
  const url = new URL(`/ws/2/${path}`, MUSICBRAINZ_ORIGIN);
  url.search = search;
  return url;
}

function buildHeaders(request) {
  const headers = new Headers();
  headers.set('Accept', request.headers.get('Accept') || 'application/json');
  headers.set('User-Agent', USER_AGENT);
  return headers;
}

export async function onRequest(context) {
  const request = context.request;
  const incomingUrl = new URL(request.url);
  const rawPath = context.params.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Allow': 'GET, HEAD',
      },
    });
  }

  try {
    const upstreamResponse = await fetch(
      buildUpstreamUrl(path, incomingUrl.search),
      {
        method: request.method,
        headers: buildHeaders(request),
        redirect: 'follow',
      }
    );

    const headers = new Headers();
    const contentType = upstreamResponse.headers.get('Content-Type');
    const retryAfter = upstreamResponse.headers.get('Retry-After');

    if (contentType) headers.set('Content-Type', contentType);
    if (retryAfter) headers.set('Retry-After', retryAfter);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Unmapped-Spotify-MusicBrainz-Proxy', 'issue-9-debug');

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'MusicBrainz proxy request failed',
      detail: error instanceof Error ? error.message : String(error),
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }
}
