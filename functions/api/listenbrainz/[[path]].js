const LISTENBRAINZ_ORIGIN = 'https://api.listenbrainz.org';
const USER_AGENT = 'UnmappedSpotifyListens/1.1 ( https://github.com/YoGo9/unmapped-spotify-listens )';

export async function onRequest(context) {
  const request = context.request;
  const incomingUrl = new URL(request.url);
  const rawPath = context.params.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');

  const upstreamUrl = new URL(`/${path}`, LISTENBRAINZ_ORIGIN);
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.set('User-Agent', USER_AGENT);
  headers.delete('Host');
  headers.delete('Origin');
  headers.delete('Referer');

  const init = {
    method: request.method,
    headers,
    redirect: 'follow',
  };

  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = request.body;
  }

  const upstreamResponse = await fetch(upstreamUrl, init);
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete('Set-Cookie');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
