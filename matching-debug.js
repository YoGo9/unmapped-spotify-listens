(() => {
  const DEBUG_LABEL = 'Issue #9 matching debug';
  const MB_PROXY_BASE = `${window.location.origin}/api/musicbrainz`;
  const MB_MIN_INTERVAL_MS = 1100;
  const matchCache = new Map();

  let lastMbRequestAt = 0;
  let mbQueue = Promise.resolve();

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function diceSimilarity(a, b) {
    const left = normalizeText(a);
    const right = normalizeText(b);

    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.length < 2 || right.length < 2) {
      return left === right ? 1 : 0;
    }

    const counts = new Map();
    for (let i = 0; i < left.length - 1; i += 1) {
      const pair = left.slice(i, i + 2);
      counts.set(pair, (counts.get(pair) || 0) + 1);
    }

    let overlap = 0;
    for (let i = 0; i < right.length - 1; i += 1) {
      const pair = right.slice(i, i + 2);
      const count = counts.get(pair) || 0;
      if (count > 0) {
        overlap += 1;
        counts.set(pair, count - 1);
      }
    }

    return (2 * overlap) / ((left.length - 1) + (right.length - 1));
  }

  function formatArtistCredit(credit) {
    if (!Array.isArray(credit)) return '';
    return credit.map(part => {
      const name = part.name || part.artist?.name || '';
      const join = part.joinphrase || part['join-phrase'] || '';
      return `${name}${join}`;
    }).join('');
  }

  function canonicalSpotifyTrackUrl(value) {
    if (!value) return '';

    try {
      const url = new URL(value);
      if (url.hostname === 'open.spotify.com' && /^\/track\/[A-Za-z0-9]+/.test(url.pathname)) {
        const match = url.pathname.match(/^\/track\/([A-Za-z0-9]+)/);
        return `https://open.spotify.com/track/${match[1]}`;
      }
      return `${url.origin}${url.pathname}`;
    } catch {
      return '';
    }
  }

  function getListenInfo(listen) {
    const track = listen?.track_metadata || {};
    const additional = track.additional_info || {};
    const artistNames = Array.isArray(additional.artist_names)
      ? additional.artist_names
      : [];

    const rawOrigin = additional.origin_url || additional.spotify_id || '';
    const originUrl = canonicalSpotifyTrackUrl(rawOrigin);
    const isrcValue = Array.isArray(additional.isrc)
      ? additional.isrc[0]
      : additional.isrc;
    const isrc = String(isrcValue || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase();

    const durationMs = Number(
      additional.duration_ms ||
      additional.duration ||
      track.duration_ms ||
      0
    ) || 0;

    return {
      title: track.track_name || '',
      artist: track.artist_name || artistNames.join(', '),
      release: track.release_name || '',
      originUrl,
      isrc,
      durationMs,
      recordingMsid: additional.recording_msid || listen?.recording_msid || '',
    };
  }

  function durationCloseness(sourceMs, candidateMs) {
    if (!sourceMs || !candidateMs) return { score: 0.5, diff: null };
    const diff = Math.abs(sourceMs - candidateMs);
    if (diff <= 2000) return { score: 1, diff };
    if (diff <= 5000) return { score: 0.9, diff };
    if (diff <= 10000) return { score: 0.7, diff };
    if (diff <= 30000) return { score: 0.4, diff };
    return { score: 0, diff };
  }

  function confidenceRank(value) {
    return { high: 3, medium: 2, low: 1 }[value] || 0;
  }

  function queueMusicBrainzFetch(url) {
    const task = mbQueue.then(async () => {
      const wait = Math.max(0, MB_MIN_INTERVAL_MS - (Date.now() - lastMbRequestAt));
      if (wait) await sleep(wait);

      try {
        return await fetch(url, { headers: { Accept: 'application/json' } });
      } finally {
        lastMbRequestAt = Date.now();
      }
    });

    mbQueue = task.catch(() => {});
    return task;
  }

  async function fetchJson(response, label) {
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`${label} returned ${response.status}`);
    }
    return response.json();
  }

  function makeCandidate({
    mbid,
    title = '',
    artist = '',
    release = '',
    length = 0,
    confidence = 'low',
    score = 0,
    reason = '',
    source = '',
  }) {
    return {
      mbid,
      title,
      artist,
      release,
      length: Number(length) || 0,
      confidence,
      score: Math.max(0, Math.min(100, Math.round(score))),
      reasons: reason ? [reason] : [],
      sources: source ? [source] : [],
    };
  }

  function evaluateIsrcRecording(recording, info, totalMatches) {
    const artist = formatArtistCredit(recording['artist-credit']);
    const titleSimilarity = diceSimilarity(info.title, recording.title);
    const artistSimilarity = diceSimilarity(info.artist, artist);
    const duration = durationCloseness(info.durationMs, recording.length);
    const unique = totalMatches === 1;

    let score = unique ? 82 : 68;
    score += titleSimilarity * 8;
    score += artistSimilarity * 6;
    score += duration.score * 4;

    let confidence = 'low';
    if (
      unique &&
      titleSimilarity >= 0.78 &&
      (artistSimilarity >= 0.55 || !artist)
    ) {
      confidence = 'high';
    } else if (titleSimilarity >= 0.7 && (artistSimilarity >= 0.45 || !artist)) {
      confidence = 'medium';
    }

    const details = [unique ? 'Unique ISRC match' : `ISRC match (${totalMatches} recordings)`];
    if (duration.diff !== null) {
      details.push(`duration ${Math.round(duration.diff / 100) / 10}s apart`);
    }

    return makeCandidate({
      mbid: recording.id,
      title: recording.title,
      artist,
      release: recording.releases?.[0]?.title || '',
      length: recording.length,
      confidence,
      score,
      reason: details.join(' · '),
      source: 'isrc',
    });
  }

  async function lookupBySpotifyUrl(info) {
    if (!info.originUrl) return [];

    const url = `${MB_PROXY_BASE}/url?resource=${encodeURIComponent(info.originUrl)}&inc=recording-rels&fmt=json`;
    const response = await queueMusicBrainzFetch(url);
    const data = await fetchJson(response, 'MusicBrainz URL lookup');
    if (!data) return [];

    const relations = Array.isArray(data.relations) ? data.relations : [];
    const recordings = relations
      .map(relation => relation.recording)
      .filter(recording => recording?.id);

    const unique = new Map();
    for (const recording of recordings) {
      unique.set(recording.id, recording);
    }

    return [...unique.values()].map(recording => makeCandidate({
      mbid: recording.id,
      title: recording.title || '',
      artist: formatArtistCredit(recording['artist-credit']),
      length: recording.length,
      confidence: 'high',
      score: 100,
      reason: 'Exact Spotify track URL relationship',
      source: 'spotify-url',
    }));
  }

  async function lookupByIsrc(info) {
    if (!info.isrc) return [];

    const url = `${MB_PROXY_BASE}/isrc/${encodeURIComponent(info.isrc)}?inc=artist-credits+releases&fmt=json`;
    const response = await queueMusicBrainzFetch(url);
    const data = await fetchJson(response, 'MusicBrainz ISRC lookup');
    if (!data) return [];

    const recordings = Array.isArray(data.recordings) ? data.recordings : [];
    return recordings.map(recording => evaluateIsrcRecording(recording, info, recordings.length));
  }

  async function lookupViaListenBrainz(info) {
    if (!info.title || !info.artist) return [];

    const params = new URLSearchParams({
      artist_name: info.artist,
      recording_name: info.title,
    });
    if (info.release) params.set('release_name', info.release);

    const token = document.getElementById('api-token')?.value?.trim();
    const response = await fetch(
      `https://api.listenbrainz.org/1/metadata/lookup/?${params.toString()}`,
      {
        headers: token ? { Authorization: `Token ${token}` } : {},
      }
    );

    if (!response.ok) {
      throw new Error(`ListenBrainz lookup returned ${response.status}`);
    }

    const data = await response.json();
    if (!data?.recording_mbid) return [];

    const titleSimilarity = diceSimilarity(info.title, data.recording_name || '');
    const artistSimilarity = diceSimilarity(info.artist, data.artist_credit_name || '');
    const releaseSimilarity = info.release && data.release_name
      ? diceSimilarity(info.release, data.release_name)
      : 0.5;

    const score = 58 + (titleSimilarity * 16) + (artistSimilarity * 16) + (releaseSimilarity * 6);
    const confidence = titleSimilarity >= 0.88 && artistSimilarity >= 0.65
      ? 'medium'
      : 'low';

    return [makeCandidate({
      mbid: data.recording_mbid,
      title: data.recording_name || info.title,
      artist: data.artist_credit_name || info.artist,
      release: data.release_name || '',
      confidence,
      score,
      reason: 'ListenBrainz metadata lookup',
      source: 'listenbrainz',
    })];
  }

  function mergeCandidates(candidateGroups) {
    const merged = new Map();

    for (const candidate of candidateGroups.flat()) {
      if (!candidate?.mbid) continue;

      const current = merged.get(candidate.mbid);
      if (!current) {
        merged.set(candidate.mbid, { ...candidate });
        continue;
      }

      current.score = Math.max(current.score, candidate.score);
      if (confidenceRank(candidate.confidence) > confidenceRank(current.confidence)) {
        current.confidence = candidate.confidence;
      }
      current.title ||= candidate.title;
      current.artist ||= candidate.artist;
      current.release ||= candidate.release;
      current.length ||= candidate.length;
      current.reasons = [...new Set([...current.reasons, ...candidate.reasons])];
      current.sources = [...new Set([...current.sources, ...candidate.sources])];

      if (current.sources.length >= 2 && current.sources.includes('isrc')) {
        current.confidence = 'high';
        current.score = Math.max(current.score, 96);
        if (!current.reasons.includes('Confirmed by multiple methods')) {
          current.reasons.push('Confirmed by multiple methods');
        }
      }
    }

    return [...merged.values()]
      .sort((a, b) => {
        const confidenceDiff = confidenceRank(b.confidence) - confidenceRank(a.confidence);
        return confidenceDiff || (b.score - a.score);
      })
      .slice(0, 3);
  }

  async function findMatches(listen) {
    const info = getListenInfo(listen);
    const cacheKey = info.recordingMsid || [info.artist, info.title, info.release, info.isrc].join('|');

    if (matchCache.has(cacheKey)) {
      return matchCache.get(cacheKey);
    }

    const promise = (async () => {
      const lbPromise = lookupViaListenBrainz(info).catch(error => {
        console.warn('ListenBrainz match lookup failed:', error);
        return [];
      });

      const mbPromise = (async () => {
        const urlMatches = await lookupBySpotifyUrl(info).catch(error => {
          console.warn('Spotify URL lookup failed:', error);
          return [];
        });

        const isrcMatches = await lookupByIsrc(info).catch(error => {
          console.warn('ISRC lookup failed:', error);
          return [];
        });

        return [...urlMatches, ...isrcMatches];
      })();

      const [lbMatches, mbMatches] = await Promise.all([lbPromise, mbPromise]);
      return {
        info,
        candidates: mergeCandidates([mbMatches, lbMatches]),
      };
    })();

    matchCache.set(cacheKey, promise);
    return promise;
  }

  function renderCandidate(candidate, input, listen) {
    const card = document.createElement('div');
    card.className = `match-candidate confidence-${candidate.confidence}`;

    const artistText = candidate.artist ? ` — ${escapeHtml(candidate.artist)}` : '';
    const releaseText = candidate.release
      ? `<div class="match-candidate-release">${escapeHtml(candidate.release)}</div>`
      : '';
    const reasons = candidate.reasons.map(escapeHtml).join(' · ');

    card.innerHTML = `
      <div class="match-candidate-top">
        <strong>${escapeHtml(candidate.confidence[0].toUpperCase() + candidate.confidence.slice(1))} confidence</strong>
        <span>${candidate.score}%</span>
      </div>
      <div class="match-candidate-title">${escapeHtml(candidate.title || candidate.mbid)}${artistText}</div>
      ${releaseText}
      <div class="match-reasons">${reasons}</div>
      <div class="match-actions">
        <a href="https://musicbrainz.org/recording/${encodeURIComponent(candidate.mbid)}" target="_blank" rel="noopener">View MusicBrainz</a>
        <button type="button" class="use-match-button">Use Match</button>
      </div>
    `;

    card.querySelector('.use-match-button').addEventListener('click', async (event) => {
      const useButton = event.currentTarget;
      const info = getListenInfo(listen);

      if (!info.recordingMsid) {
        alert('This listen has no recording MSID, so ListenBrainz cannot accept a manual mapping for it.');
        return;
      }

      input.value = `https://musicbrainz.org/recording/${candidate.mbid}`;
      input.classList.add('match-filled');
      useButton.disabled = true;
      useButton.textContent = 'Submitting…';

      try {
        if (typeof window.submitManualMapping !== 'function') {
          throw new Error('Mapping function is not available.');
        }
        await window.submitManualMapping(info.recordingMsid, input.id, info.title || candidate.title || 'recording');
      } catch (error) {
        console.error('Automatic mapping submission failed:', error);
        alert(`Failed to submit mapping: ${error.message || error}`);
      } finally {
        useButton.disabled = false;
        useButton.textContent = 'Use Match';
        setTimeout(() => input.classList.remove('match-filled'), 1200);
      }
    });

    return card;
  }

  function enhanceRenderedListens(listens) {
    const items = document.querySelectorAll('.listens-list .listen-item');

    items.forEach((item, index) => {
      const listen = listens[index];
      if (!listen || item.querySelector('.match-debug-tools')) return;

      const input = item.querySelector('input[type="text"]');
      if (!input) return;

      const tools = document.createElement('div');
      tools.className = 'match-debug-tools';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'find-match-button';
      button.textContent = 'Find Match';

      const results = document.createElement('div');
      results.className = 'match-results';

      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Checking…';
        results.innerHTML = '<div class="match-status">Checking origin URL, ISRC and ListenBrainz…</div>';

        try {
          const { info, candidates } = await findMatches(listen);
          results.innerHTML = '';

          const attempted = [
            info.originUrl ? 'Spotify URL' : null,
            info.isrc ? `ISRC ${info.isrc}` : null,
            'ListenBrainz lookup',
          ].filter(Boolean);

          const diagnostic = document.createElement('div');
          diagnostic.className = 'match-diagnostic';
          diagnostic.textContent = `Checked: ${attempted.join(', ')}`;
          results.appendChild(diagnostic);

          if (!candidates.length) {
            const empty = document.createElement('div');
            empty.className = 'match-status no-match';
            empty.textContent = 'No match found.';
            results.appendChild(empty);
          } else {
            candidates.forEach(candidate => {
              results.appendChild(renderCandidate(candidate, input, listen));
            });
          }
        } catch (error) {
          console.error('Match lookup failed:', error);
          results.innerHTML = `<div class="match-status match-error">Match lookup failed: ${escapeHtml(error.message || error)}</div>`;
        } finally {
          button.disabled = false;
          button.textContent = 'Find Match';
        }
      });

      tools.appendChild(button);
      tools.appendChild(results);
      item.insertBefore(tools, input);
    });
  }

  function addDebugUi() {
    if (!document.getElementById('matching-debug-styles')) {
      const style = document.createElement('style');
      style.id = 'matching-debug-styles';
      style.textContent = `
        .matching-debug-banner {
          padding: 8px 10px;
          margin: -5px 0 15px;
          border: 1px dashed var(--border-color);
          border-radius: 6px;
          color: var(--secondary-text);
          font-size: 13px;
          text-align: center;
        }
        .listen-item > .match-debug-tools {
          flex: 1 0 100%;
          width: 100%;
          margin: 8px 0 4px;
        }
        .match-debug-tools .find-match-button,
        .match-debug-tools .use-match-button {
          width: auto;
          flex: none;
          margin: 0;
          padding: 7px 12px;
          font-size: 14px;
        }
        .match-debug-tools .find-match-button:disabled {
          opacity: 0.65;
          cursor: wait;
        }
        .match-results {
          margin-top: 8px;
        }
        .match-status,
        .match-diagnostic {
          font-size: 13px;
          color: var(--secondary-text);
          padding: 5px 0;
        }
        .match-error {
          color: var(--clear-color);
        }
        .match-candidate {
          margin-top: 8px;
          padding: 9px;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          background: var(--container-bg);
        }
        .match-candidate-top,
        .match-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .match-candidate-top {
          font-size: 13px;
          margin-bottom: 5px;
        }
        .confidence-high .match-candidate-top strong {
          color: var(--primary-color);
        }
        .confidence-medium .match-candidate-top strong {
          color: var(--link-color);
        }
        .match-candidate-title {
          font-size: 14px;
        }
        .match-candidate-release,
        .match-reasons {
          margin-top: 4px;
          font-size: 12px;
          color: var(--secondary-text);
        }
        .match-actions {
          margin-top: 8px;
        }
        .match-actions a {
          font-size: 13px;
        }
        .match-filled {
          outline: 2px solid var(--primary-color);
        }
      `;
      document.head.appendChild(style);
    }

    const container = document.querySelector('.container');
    if (container && !document.querySelector('.matching-debug-banner')) {
      const banner = document.createElement('div');
      banner.className = 'matching-debug-banner';
      banner.textContent = DEBUG_LABEL;
      const heading = container.querySelector('h1');
      container.insertBefore(banner, heading);
    }
  }

  function attachWhenReady() {
    if (typeof window.displayListens !== 'function') {
      setTimeout(attachWhenReady, 50);
      return;
    }

    if (window.__issue9MatchingDebugAttached) return;
    window.__issue9MatchingDebugAttached = true;

    addDebugUi();

    const originalDisplayListens = window.displayListens;
    window.displayListens = function wrappedDisplayListens(listens, filteredArtist = null) {
      const result = originalDisplayListens.call(this, listens, filteredArtist);
      enhanceRenderedListens(listens || []);
      return result;
    };
  }

  attachWhenReady();
})();
