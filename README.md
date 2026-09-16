# Unmapped Spotify Listens Tool

This is a web-based tool that fetches unmapped ListenBrainz listens submitted via Spotify. It helps find tracks that are not yet mapped to MusicBrainz and provides links to Spotify, Harmony, MusicBrainz search, and manual MBID mapping.

## Current ListenBrainz compatibility

ListenBrainz now documents a required identifying `User-Agent` for API clients. Browsers cannot reliably set the required custom `User-Agent` on cross-origin `fetch()` requests, so the repository now includes a tiny Cloudflare Pages Function at:

`functions/api/listenbrainz/[[path]].js`

When the site is deployed on Cloudflare Pages, all ListenBrainz requests are automatically routed through that same-origin function and sent upstream with:

`UnmappedSpotifyListens/1.1 ( https://github.com/YoGo9/unmapped-spotify-listens )`

The compatibility layer also accepts the current ListenBrainz response shape where `recording_msid` may be present on the listen itself and makes it available to the existing manual-mapping code.

The existing UI and application logic are preserved in `app-original.js`; `app.js` is only a thin compatibility/bootstrap layer.

## Features

- Fetches up to 1000 recent listens from ListenBrainz.
- Filters unmapped listens submitted via Spotify.
- Links to the Spotify album and artists.
- Links to Harmony for release submission.
- Links to MusicBrainz recording search.
- Supports manual recording MBID mapping back to ListenBrainz.
- Saves the ListenBrainz username and token locally in the browser.

## Deployment

### Cloudflare Pages (recommended)

Connect this repository to Cloudflare Pages and deploy it as a static site. No build command is required. The included Pages Function will handle ListenBrainz API requests automatically.

### GitHub Pages

The existing GitHub Pages deployment remains available at:

https://yogo9.github.io/unmapped-spotify-listens/

GitHub Pages cannot run the included server-side proxy. The app will still attempt direct ListenBrainz requests there, but direct browser requests may be blocked or throttled under ListenBrainz's current User-Agent policy.

## How to Use

1. Enter your ListenBrainz username.
2. Enter your ListenBrainz API token.
3. Choose how many recent listens to fetch (maximum 1000).
4. Click **Fetch Listens**.
5. Use the Spotify, Harmony, or MusicBrainz links, or submit a MusicBrainz recording URL to create a manual mapping.
