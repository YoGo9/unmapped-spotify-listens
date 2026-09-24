(() => {
  const LB_PROXY = '/api/listenbrainz';
  const MB_PROXY = '/api/musicbrainz';
  const POLL_MS = 30000;
  const MB_INTERVAL_MS = 1100;
  const PAGE_SIZE = 100;

  const state = {
    token: '',
    currentExport: null,
    pollTimer: null,
    groups: [],
    groupById: new Map(),
    total: 0,
    mapped: 0,
    unmapped: 0,
    visibleLimit: PAGE_SIZE,
    filtered: [],
  };

  let mbQueue = Promise.resolve();
  let lastMbRequestAt = 0;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function saveToken() {
    state.token = $('api-token').value.trim();
    if (state.token) localStorage.setItem('apiToken', state.token);
    return state.token;
  }

  function authHeaders(extra = {}) {
    const token = saveToken();
    if (!token) throw new Error('Enter your ListenBrainz API token first.');
    return {
      Authorization: `Token ${token}`,
      ...extra,
    };
  }

  async function lbFetch(path, options = {}) {
    const response = await fetch(`${LB_PROXY}${path}`, {
      ...options,
      headers: authHeaders(options.headers || {}),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const data = await response.clone().json();
        detail = data?.error || data?.detail || '';
      } catch {
        try { detail = await response.clone().text(); } catch {}
      }
      throw new Error(`ListenBrainz returned ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response;
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }

  function formatListenDate(ts) {
    if (!ts) return '—';
    return new Date(Number(ts) * 1000).toLocaleDateString();
  }

  function setExportPanel(message = '') {
    $('export-panel').classList.remove('hidden');
    if (message) $('export-status').innerHTML = message;
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function renderExport(exp) {
    state.currentExport = exp;
    const statusClass = String(exp.status || 'unknown').replace(/[^a-z0-9_-]/gi, '_');
    const statusLabel = String(exp.status || 'unknown').replace(/_/g, ' ');

    setExportPanel(`
      <div class="export-heading">
        <div>
          <div class="export-eyebrow">ListenBrainz Export</div>
          <div class="export-id">Export #${escapeHtml(exp.export_id)}</div>
        </div>
        <span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="export-progress-text">${escapeHtml(exp.progress || '')}</div>
      <div class="export-meta">
        <div class="export-meta-item">Created<strong>${escapeHtml(formatDate(exp.created))}</strong></div>
        ${exp.available_until ? `<div class="export-meta-item">Available until<strong>${escapeHtml(formatDate(exp.available_until))}</strong></div>` : ''}
        ${exp.filename ? `<div class="export-meta-item" style="grid-column:1/-1">File<strong>${escapeHtml(exp.filename)}</strong></div>` : ''}
      </div>
    `);

    const actions = $('export-actions');
    actions.innerHTML = '';

    if (exp.status === 'completed') {
      stopPolling();
      $('export-progress').classList.add('hidden');
      const button = document.createElement('button');
      button.className = 'process-export-button';
      button.textContent = 'Process Export';
      button.addEventListener('click', () => processRemoteExport(exp));
      actions.appendChild(button);

      const note = document.createElement('div');
      note.className = 'export-action-note';
      note.textContent = 'The ZIP is downloaded and processed locally in your browser.';
      actions.appendChild(note);
    } else if (exp.status === 'failed') {
      stopPolling();
      $('export-progress').classList.add('hidden');
    } else {
      $('export-progress').classList.remove('hidden');
      $('export-progress').firstElementChild.style.width = '100%';
      schedulePoll(exp.export_id);
    }
  }

  function schedulePoll(exportId) {
    stopPolling();
    state.pollTimer = setTimeout(() => refreshExport(exportId), POLL_MS);
  }

  async function refreshExport(exportId) {
    try {
      const response = await lbFetch(`/1/export/${exportId}`);
      const exp = await response.json();
      renderExport(exp);
    } catch (error) {
      setExportPanel(`<span class="error">${escapeHtml(error.message)}</span>`);
      schedulePoll(exportId);
    }
  }

  function isUsableCompletedExport(exp) {
    if (exp?.status !== 'completed') return false;
    if (!exp.available_until) return true;
    return new Date(exp.available_until).getTime() > Date.now();
  }

  async function getExportList() {
    const response = await lbFetch('/1/export/list');
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async function checkExports() {
    stopPolling();
    try {
      setExportPanel('Checking ListenBrainz exports…');
      const exports = await getExportList();
      const pending = exports.find(exp => exp.status === 'waiting' || exp.status === 'in_progress');
      const completed = exports.find(isUsableCompletedExport);

      if (pending) {
        renderExport(pending);
      } else if (completed) {
        renderExport(completed);
      } else {
        setExportPanel('No active or downloadable export found. You can request a new full export.');
        $('export-actions').innerHTML = '';
        $('export-progress').classList.add('hidden');
      }
    } catch (error) {
      setExportPanel(`<span class="error">${escapeHtml(error.message)}</span>`);
    }
  }

  async function requestExport() {
    stopPolling();
    try {
      setExportPanel('Checking for an existing export first…');
      const exports = await getExportList();
      const pending = exports.find(exp => exp.status === 'waiting' || exp.status === 'in_progress');

      if (pending) {
        renderExport(pending);
        return;
      }

      const response = await lbFetch('/1/export/', { method: 'POST' });
      const exp = await response.json();
      renderExport(exp);
    } catch (error) {
      setExportPanel(`<span class="error">${escapeHtml(error.message)}</span>`);
    }
  }

  async function processRemoteExport(exp) {
    try {
      showProcessing('Downloading export…', exp.filename || `Export #${exp.export_id}`, 5);
      const response = await lbFetch(`/1/export/${exp.export_id}/download`);
      const buffer = await response.arrayBuffer();
      await processZip(buffer);
    } catch (error) {
      showProcessing('Could not process export', error.message, 0, true);
    }
  }

  function showProcessing(title, detail = '', percent = 0, isError = false) {
    $('processing-panel').classList.remove('hidden');
    $('processing-title').textContent = title;
    $('processing-title').classList.toggle('error', isError);
    $('processing-detail').textContent = detail;
    $('processing-bar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function sourceLabel(track) {
    const info = track?.additional_info || {};
    const service = String(info.music_service || '').trim();
    const client = String(info.submission_client || '').trim();

    if (service === 'spotify.com') return 'Spotify';
    if (service) return service;
    if (client.toLowerCase() === 'navidrome') return 'Navidrome';
    if (client) return client;
    return 'Unknown';
  }

  function isMapped(listen) {
    return Boolean(listen?.track_metadata?.mbid_mapping?.recording_mbid);
  }

  function normalizeIsrcs(value) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values
      .map(v => String(v).replace(/[^A-Za-z0-9]/g, '').toUpperCase())
      .filter(Boolean);
  }

  function normalizeOrigin(value) {
    if (!value) return '';
    const raw = String(value).trim();
    const spotifyUri = raw.match(/^spotify:track:([A-Za-z0-9]+)$/i);
    if (spotifyUri) return `https://open.spotify.com/track/${spotifyUri[1]}`;

    try {
      const url = new URL(raw);
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  function addUnmappedListen(groups, listen) {
    const track = listen.track_metadata || {};
    const info = track.additional_info || {};
    const msid = listen.recording_msid || info.recording_msid || '';
    const fallback = [
      track.artist_name || '',
      track.track_name || '',
      track.release_name || '',
    ].join('\u0000');
    const key = msid || `missing:${fallback}`;
    let group = groups.get(key);

    if (!group) {
      group = {
        id: `g${groups.size + 1}`,
        recordingMsid: msid,
        title: track.track_name || 'Unknown track',
        artist: track.artist_name || (Array.isArray(info.artist_names) ? info.artist_names.join(', ') : '') || 'Unknown artist',
        release: track.release_name || '',
        count: 0,
        firstTs: null,
        lastTs: null,
        sources: new Set(),
        isrcs: new Set(),
        origins: new Set(),
        durationMs: Number(info.duration_ms || info.duration || track.duration_ms || 0) || 0,
        locallyMapped: false,
      };
      groups.set(key, group);
    }

    group.count += 1;
    const ts = Number(listen.listened_at) || 0;
    if (ts) {
      group.firstTs = group.firstTs ? Math.min(group.firstTs, ts) : ts;
      group.lastTs = group.lastTs ? Math.max(group.lastTs, ts) : ts;
    }

    group.sources.add(sourceLabel(track));
    normalizeIsrcs(info.isrc).forEach(v => group.isrcs.add(v));
    [info.origin_url, info.spotify_id]
      .map(normalizeOrigin)
      .filter(Boolean)
      .forEach(v => group.origins.add(v));

    if (!group.release && track.release_name) group.release = track.release_name;
    if (!group.durationMs) group.durationMs = Number(info.duration_ms || info.duration || 0) || 0;
  }

  async function processZip(buffer) {
    if (!window.JSZip) {
      throw new Error('ZIP library did not load. Refresh the page and try again.');
    }

    showProcessing('Opening export ZIP…', '', 8);
    const zip = await JSZip.loadAsync(buffer);
    const listenFiles = Object.keys(zip.files)
      .filter(name => /^listens\/\d{4}\/\d{1,2}\.jsonl$/.test(name))
      .sort((a, b) => {
        const aa = a.match(/listens\/(\d{4})\/(\d{1,2})/);
        const bb = b.match(/listens\/(\d{4})\/(\d{1,2})/);
        return Number(aa[1]) - Number(bb[1]) || Number(aa[2]) - Number(bb[2]);
      });

    if (!listenFiles.length) {
      throw new Error('No ListenBrainz listen files were found in this ZIP.');
    }

    const groups = new Map();
    let total = 0;
    let mapped = 0;
    let unmapped = 0;

    for (let i = 0; i < listenFiles.length; i += 1) {
      const name = listenFiles[i];
      const text = await zip.file(name).async('string');
      const lines = text.split(/\r?\n/);

      for (const line of lines) {
        if (!line.trim()) continue;
        let listen;
        try {
          listen = JSON.parse(line);
        } catch {
          continue;
        }

        total += 1;
        if (isMapped(listen)) {
          mapped += 1;
        } else {
          unmapped += 1;
          addUnmappedListen(groups, listen);
        }
      }

      const pct = 10 + Math.round(((i + 1) / listenFiles.length) * 85);
      showProcessing(
        'Processing listening history…',
        `${name} · ${total.toLocaleString()} listens processed`,
        pct,
      );

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    let username = '';
    const userFile = zip.file('user.json');
    if (userFile) {
      try {
        const user = JSON.parse(await userFile.async('string'));
        username = user.user_name || user.username || '';
      } catch {}
    }

    state.total = total;
    state.mapped = mapped;
    state.unmapped = unmapped;
    state.groups = [...groups.values()];
    state.groupById = new Map(state.groups.map(group => [group.id, group]));
    state.visibleLimit = PAGE_SIZE;

    showProcessing(
      'Export ready',
      `${username ? `${username} · ` : ''}${total.toLocaleString()} listens · ${state.groups.length.toLocaleString()} unique unmapped recordings`,
      100,
    );

    renderStats();
    buildSourceFilter();
    applyFilters();
    $('results').classList.remove('hidden');
  }

  function renderStats() {
    $('stat-total').textContent = state.total.toLocaleString();
    $('stat-mapped').textContent = state.mapped.toLocaleString();
    $('stat-unmapped').textContent = state.unmapped.toLocaleString();
    $('stat-unique').textContent = state.groups.filter(g => !g.locallyMapped).length.toLocaleString();
  }

  function buildSourceFilter() {
    const current = $('source-filter').value || 'all';
    const sources = new Set();
    state.groups.forEach(group => group.sources.forEach(source => sources.add(source)));

    $('source-filter').innerHTML = '<option value="all">All sources</option>';
    [...sources].sort((a, b) => a.localeCompare(b)).forEach(source => {
      const option = document.createElement('option');
      option.value = source;
      option.textContent = source;
      $('source-filter').appendChild(option);
    });

    if ([...$('source-filter').options].some(option => option.value === current)) {
      $('source-filter').value = current;
    }
  }

  function applyFilters(resetLimit = true) {
    if (resetLimit) state.visibleLimit = PAGE_SIZE;
    const query = $('search').value.trim().toLowerCase();
    const source = $('source-filter').value;
    const sort = $('sort').value;

    let groups = state.groups.filter(group => {
      if (group.locallyMapped) return false;
      if (source !== 'all' && !group.sources.has(source)) return false;
      if (!query) return true;
      return [group.artist, group.title, group.release, ...group.isrcs]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    groups.sort((a, b) => {
      if (sort === 'newest') return (b.lastTs || 0) - (a.lastTs || 0);
      if (sort === 'artist') return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);
      return b.count - a.count || (b.lastTs || 0) - (a.lastTs || 0);
    });

    state.filtered = groups;
    renderHistory();
  }

  function renderHistory() {
    const list = $('history-list');
    list.innerHTML = '';

    const shown = state.filtered.slice(0, state.visibleLimit);
    $('result-summary').textContent = `${state.filtered.length.toLocaleString()} unique unmapped recordings match the current filters.`;

    shown.forEach(group => list.appendChild(renderGroup(group)));

    const more = state.filtered.length > state.visibleLimit;
    $('load-more').classList.toggle('hidden', !more);
    if (more) {
      $('load-more').textContent = `Show More (${(state.filtered.length - state.visibleLimit).toLocaleString()} remaining)`;
    }

    if (!shown.length) {
      list.innerHTML = '<div class="panel muted">No unmapped recordings match these filters.</div>';
    }
  }

  function musicBrainzSearchUrl(group) {
    const query = `artist:"${group.artist}" AND recording:"${group.title}"`;
    return `https://musicbrainz.org/search?query=${encodeURIComponent(query)}&type=recording&method=advanced`;
  }

  function renderGroup(group) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const sourceText = [...group.sources].join(', ');
    const range = group.firstTs && group.lastTs
      ? `${formatListenDate(group.firstTs)} – ${formatListenDate(group.lastTs)}`
      : 'Date unavailable';
    const isrcText = group.isrcs.size ? ` · ISRC ${[...group.isrcs].join(', ')}` : '';

    item.innerHTML = `
      <div class="history-top">
        <div>
          <div class="history-title">${escapeHtml(group.title)}</div>
          <div>${escapeHtml(group.artist)}</div>
          ${group.release ? `<div class="history-meta">${escapeHtml(group.release)}</div>` : ''}
        </div>
        <span class="count-badge">${group.count.toLocaleString()} listen${group.count === 1 ? '' : 's'}</span>
      </div>
      <div class="history-detail">${escapeHtml(sourceText)} · ${escapeHtml(range)}${escapeHtml(isrcText)}</div>
      <div class="item-actions">
        <a href="${escapeHtml(musicBrainzSearchUrl(group))}" target="_blank" rel="noopener">Search MusicBrainz</a>
        <button type="button" class="find-match">Find Match</button>
      </div>
      <div class="match-results"></div>
      <div class="mapping-row">
        <input type="text" class="mb-url" placeholder="MusicBrainz Recording URL">
        <button type="button" class="submit-mapping" ${group.recordingMsid ? '' : 'disabled'}>Submit MBID</button>
      </div>
      ${group.recordingMsid ? '' : '<div class="history-detail error">No recording MSID in this export entry, so ListenBrainz cannot accept a manual mapping for it.</div>'}
    `;

    const input = item.querySelector('.mb-url');
    const results = item.querySelector('.match-results');
    const findButton = item.querySelector('.find-match');
    const submitButton = item.querySelector('.submit-mapping');

    findButton.addEventListener('click', async () => {
      findButton.disabled = true;
      findButton.textContent = 'Checking…';
      results.innerHTML = '<div class="history-detail">Checking origin URL, ISRC and ListenBrainz metadata…</div>';
      try {
        const candidates = await findMatches(group);
        renderCandidates(candidates, group, input, results);
      } catch (error) {
        results.innerHTML = `<div class="history-detail error">${escapeHtml(error.message)}</div>`;
      } finally {
        findButton.disabled = false;
        findButton.textContent = 'Find Match';
      }
    });

    submitButton.addEventListener('click', () => submitMapping(group, input, submitButton));
    return item;
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
    if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;

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

  function durationScore(sourceMs, candidateMs) {
    if (!sourceMs || !candidateMs) return { score: 0.5, diff: null };
    const diff = Math.abs(sourceMs - candidateMs);
    if (diff <= 2000) return { score: 1, diff };
    if (diff <= 5000) return { score: 0.9, diff };
    if (diff <= 10000) return { score: 0.7, diff };
    if (diff <= 30000) return { score: 0.4, diff };
    return { score: 0, diff };
  }

  function queueMbFetch(url) {
    const task = mbQueue.then(async () => {
      const wait = Math.max(0, MB_INTERVAL_MS - (Date.now() - lastMbRequestAt));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      try {
        return await fetch(url, { headers: { Accept: 'application/json' } });
      } finally {
        lastMbRequestAt = Date.now();
      }
    });
    mbQueue = task.catch(() => {});
    return task;
  }

  async function jsonOrNull(response, label) {
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${label} returned ${response.status}`);
    return response.json();
  }

  function candidate(data) {
    return {
      mbid: data.mbid,
      title: data.title || '',
      artist: data.artist || '',
      release: data.release || '',
      score: Math.max(0, Math.min(100, Math.round(data.score || 0))),
      confidence: data.confidence || 'low',
      reasons: data.reason ? [data.reason] : [],
      sources: data.source ? [data.source] : [],
    };
  }

  async function lookupOrigins(group) {
    const results = [];
    for (const origin of [...group.origins].slice(0, 2)) {
      const url = `${MB_PROXY}/url?resource=${encodeURIComponent(origin)}&inc=recording-rels&fmt=json`;
      const response = await queueMbFetch(url);
      const data = await jsonOrNull(response, 'MusicBrainz URL lookup');
      if (!data) continue;

      const relations = Array.isArray(data.relations) ? data.relations : [];
      for (const relation of relations) {
        const recording = relation.recording;
        if (!recording?.id) continue;
        const spotify = origin.includes('open.spotify.com/');
        results.push(candidate({
          mbid: recording.id,
          title: recording.title || group.title,
          artist: formatArtistCredit(recording['artist-credit']) || group.artist,
          score: 100,
          confidence: 'high',
          reason: spotify ? 'Exact Spotify track URL relationship' : 'Exact origin URL relationship',
          source: 'origin',
        }));
      }
      if (results.length) break;
    }
    return results;
  }

  async function lookupIsrcs(group) {
    const results = [];
    for (const isrc of [...group.isrcs].slice(0, 2)) {
      const response = await queueMbFetch(`${MB_PROXY}/isrc/${encodeURIComponent(isrc)}?inc=artist-credits+releases&fmt=json`);
      const data = await jsonOrNull(response, 'MusicBrainz ISRC lookup');
      if (!data) continue;

      const recordings = Array.isArray(data.recordings) ? data.recordings : [];
      recordings.forEach(recording => {
        const artist = formatArtistCredit(recording['artist-credit']);
        const titleSimilarity = diceSimilarity(group.title, recording.title);
        const artistSimilarity = diceSimilarity(group.artist, artist);
        const duration = durationScore(group.durationMs, recording.length);
        const unique = recordings.length === 1;

        let score = unique ? 82 : 68;
        score += titleSimilarity * 8;
        score += artistSimilarity * 6;
        score += duration.score * 4;

        let confidence = 'low';
        if (unique && titleSimilarity >= 0.78 && (artistSimilarity >= 0.55 || !artist)) {
          confidence = 'high';
        } else if (titleSimilarity >= 0.7 && (artistSimilarity >= 0.45 || !artist)) {
          confidence = 'medium';
        }

        const details = [unique ? 'Unique ISRC match' : `ISRC match (${recordings.length} recordings)`];
        if (duration.diff !== null) details.push(`duration ${Math.round(duration.diff / 100) / 10}s apart`);

        results.push(candidate({
          mbid: recording.id,
          title: recording.title,
          artist,
          release: recording.releases?.[0]?.title || '',
          score,
          confidence,
          reason: details.join(' · '),
          source: 'isrc',
        }));
      });
      if (results.some(item => item.confidence === 'high')) break;
    }
    return results;
  }

  async function lookupListenBrainz(group) {
    const params = new URLSearchParams({
      artist_name: group.artist,
      recording_name: group.title,
    });
    if (group.release) params.set('release_name', group.release);

    const response = await lbFetch(`/1/metadata/lookup/?${params.toString()}`);
    const data = await response.json();
    if (!data?.recording_mbid) return [];

    const titleSimilarity = diceSimilarity(group.title, data.recording_name || '');
    const artistSimilarity = diceSimilarity(group.artist, data.artist_credit_name || '');
    const releaseSimilarity = group.release && data.release_name
      ? diceSimilarity(group.release, data.release_name)
      : 0.5;
    const score = 58 + titleSimilarity * 16 + artistSimilarity * 16 + releaseSimilarity * 6;

    return [candidate({
      mbid: data.recording_mbid,
      title: data.recording_name || group.title,
      artist: data.artist_credit_name || group.artist,
      release: data.release_name || '',
      score,
      confidence: titleSimilarity >= 0.88 && artistSimilarity >= 0.65 ? 'medium' : 'low',
      reason: 'ListenBrainz metadata lookup',
      source: 'listenbrainz',
    })];
  }

  function confidenceRank(value) {
    return { high: 3, medium: 2, low: 1 }[value] || 0;
  }

  function mergeCandidates(groups) {
    const merged = new Map();
    groups.flat().forEach(item => {
      if (!item?.mbid) return;
      const current = merged.get(item.mbid);
      if (!current) {
        merged.set(item.mbid, { ...item });
        return;
      }

      current.score = Math.max(current.score, item.score);
      if (confidenceRank(item.confidence) > confidenceRank(current.confidence)) {
        current.confidence = item.confidence;
      }
      current.title ||= item.title;
      current.artist ||= item.artist;
      current.release ||= item.release;
      current.reasons = [...new Set([...current.reasons, ...item.reasons])];
      current.sources = [...new Set([...current.sources, ...item.sources])];

      if (current.sources.length >= 2 && current.sources.includes('isrc')) {
        current.confidence = 'high';
        current.score = Math.max(current.score, 96);
        if (!current.reasons.includes('Confirmed by multiple methods')) {
          current.reasons.push('Confirmed by multiple methods');
        }
      }
    });

    return [...merged.values()]
      .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence) || b.score - a.score)
      .slice(0, 3);
  }

  async function findMatches(group) {
    const lbPromise = lookupListenBrainz(group).catch(error => {
      console.warn('ListenBrainz match lookup failed:', error);
      return [];
    });

    const mbPromise = (async () => {
      const origins = await lookupOrigins(group).catch(error => {
        console.warn('Origin URL lookup failed:', error);
        return [];
      });
      const isrcs = await lookupIsrcs(group).catch(error => {
        console.warn('ISRC lookup failed:', error);
        return [];
      });
      return [...origins, ...isrcs];
    })();

    const [lb, mb] = await Promise.all([lbPromise, mbPromise]);
    return mergeCandidates([mb, lb]);
  }

  function renderCandidates(candidates, group, input, container) {
    container.innerHTML = '';

    if (!candidates.length) {
      container.innerHTML = '<div class="history-detail">No match found.</div>';
      return;
    }

    candidates.forEach(item => {
      const card = document.createElement('div');
      card.className = 'candidate';
      card.innerHTML = `
        <div class="candidate-top">
          <span class="${item.confidence === 'high' ? 'high' : ''}">${escapeHtml(item.confidence[0].toUpperCase() + item.confidence.slice(1))} confidence</span>
          <span>${item.score}%</span>
        </div>
        <div class="candidate-title">${escapeHtml(item.title || item.mbid)}${item.artist ? ` — ${escapeHtml(item.artist)}` : ''}</div>
        ${item.release ? `<div class="candidate-reason">${escapeHtml(item.release)}</div>` : ''}
        <div class="candidate-reason">${escapeHtml(item.reasons.join(' · '))}</div>
        <div class="candidate-actions">
          <a href="https://musicbrainz.org/recording/${encodeURIComponent(item.mbid)}" target="_blank" rel="noopener">View MusicBrainz</a>
          <button type="button">Use Match</button>
        </div>
      `;
      card.querySelector('button').addEventListener('click', async (event) => {
        const useButton = event.currentTarget;
        input.value = `https://musicbrainz.org/recording/${item.mbid}`;
        input.focus();
        await submitMapping(group, input, useButton);
      });
      container.appendChild(card);
    });
  }

  async function submitMapping(group, input, button) {
    const match = input.value.trim().match(/recording\/([a-f0-9-]{36})/i);
    if (!match) {
      alert('Enter a valid MusicBrainz recording URL.');
      return;
    }
    if (!group.recordingMsid) {
      alert('This item has no recording MSID.');
      return;
    }

    const originalButtonText = button.textContent;
    button.disabled = true;
    button.textContent = 'Submitting…';

    try {
      await lbFetch('/1/metadata/submit_manual_mapping/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recording_msid: group.recordingMsid,
          recording_mbid: match[1],
        }),
      });

      group.locallyMapped = true;
      state.mapped += group.count;
      state.unmapped = Math.max(0, state.unmapped - group.count);
      renderStats();
      applyFilters(false);
    } catch (error) {
      alert(`Failed to map: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = originalButtonText;
    }
  }

  function initTheme() {
    const dark = localStorage.getItem('darkMode') === 'true';
    document.body.classList.toggle('dark-mode', dark);
    $('theme-toggle').checked = dark;
    $('theme-toggle').addEventListener('change', () => {
      document.body.classList.toggle('dark-mode', $('theme-toggle').checked);
      localStorage.setItem('darkMode', $('theme-toggle').checked ? 'true' : 'false');
    });
  }

  function init() {
    $('api-token').value = localStorage.getItem('apiToken') || '';
    initTheme();

    $('toggle-token').addEventListener('click', () => {
      const input = $('api-token');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('toggle-token').textContent = show ? 'Hide' : 'Show';
    });

    $('check-exports').addEventListener('click', checkExports);
    $('request-export').addEventListener('click', requestExport);

    $('zip-file').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        showProcessing('Reading local export…', file.name, 5);
        await processZip(await file.arrayBuffer());
      } catch (error) {
        showProcessing('Could not process export', error.message, 0, true);
      }
    });

    $('search').addEventListener('input', () => applyFilters());
    $('source-filter').addEventListener('change', () => applyFilters());
    $('sort').addEventListener('change', () => applyFilters());
    $('load-more').addEventListener('click', () => {
      state.visibleLimit += PAGE_SIZE;
      renderHistory();
    });

    if ($('api-token').value) {
      checkExports();
    }
  }

  init();
})();