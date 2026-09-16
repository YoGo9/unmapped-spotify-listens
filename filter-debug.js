(() => {
  const originalFetch = window.fetch.bind(window);
  let displayMode = localStorage.getItem('debugListenDisplayMode') || 'unmapped';
  const validModes = new Set(['unmapped', 'mapped', 'all']);
  if (!validModes.has(displayMode)) displayMode = 'unmapped';

  function isListensRequest(url) {
    return /\/1\/user\/[^/]+\/listens(?:\?|$)/.test(url);
  }

  function isSpotifyListen(listen) {
    return listen?.track_metadata?.additional_info?.music_service === 'spotify.com';
  }

  function isMapped(listen) {
    return Boolean(listen?.track_metadata?.mbid_mapping);
  }

  function getRecordingMbid(listen) {
    const mapping = listen?.track_metadata?.mbid_mapping || {};
    return mapping.recording_mbid ||
      mapping.recording?.recording_mbid ||
      mapping.recording?.id ||
      mapping.mbid ||
      '';
  }

  function getFilteredListens() {
    const all = window.__debugAllSpotifyListens || [];
    if (displayMode === 'mapped') return all.filter(isMapped);
    if (displayMode === 'all') return all;
    return all.filter(listen => !isMapped(listen));
  }

  function counts() {
    const all = window.__debugAllSpotifyListens || [];
    const mapped = all.filter(isMapped).length;
    return {
      all: all.length,
      mapped,
      unmapped: all.length - mapped,
    };
  }

  function addMappedBadges(listens) {
    const items = document.querySelectorAll('.listens-list .listen-item');
    items.forEach((item, index) => {
      const listen = listens[index];
      if (!listen || !isMapped(listen) || item.querySelector('.existing-mapping-badge')) return;

      const mbid = getRecordingMbid(listen);
      const badge = document.createElement('div');
      badge.className = 'existing-mapping-badge';

      if (mbid) {
        badge.innerHTML = `Already mapped · <a href="https://musicbrainz.org/recording/${encodeURIComponent(mbid)}" target="_blank" rel="noopener">${mbid}</a>`;
      } else {
        badge.textContent = 'Already mapped';
      }

      const firstBlock = item.querySelector('div');
      if (firstBlock) firstBlock.appendChild(badge);
    });
  }

  function renderFilter() {
    if (!window.__debugAllSpotifyListens) return;

    document.getElementById('listen-display-filter')?.remove();

    const list = document.querySelector('.listens-list');
    if (!list) return;

    const c = counts();
    const bar = document.createElement('div');
    bar.id = 'listen-display-filter';
    bar.className = 'listen-display-filter';
    bar.innerHTML = `
      <label for="listen-display-mode">Show:</label>
      <select id="listen-display-mode">
        <option value="unmapped">Unmapped (${c.unmapped})</option>
        <option value="mapped">Mapped (${c.mapped})</option>
        <option value="all">All (${c.all})</option>
      </select>
    `;

    const select = bar.querySelector('select');
    select.value = displayMode;
    select.addEventListener('change', () => {
      displayMode = select.value;
      localStorage.setItem('debugListenDisplayMode', displayMode);
      window.displayListens(getFilteredListens());
    });

    list.insertBefore(bar, list.firstChild);
  }

  window.fetch = async function debugCaptureFetch(input, init) {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : String(input);

    const response = await originalFetch(input, init);

    if (response.ok && isListensRequest(url)) {
      try {
        const data = await response.clone().json();
        const listens = data?.payload?.listens;
        if (Array.isArray(listens)) {
          window.__debugAllSpotifyListens = listens.filter(isSpotifyListen);
        }
      } catch (error) {
        console.warn('Could not capture Spotify listens for debug filter:', error);
      }
    }

    return response;
  };

  function attachWhenReady() {
    if (typeof window.displayListens !== 'function') {
      setTimeout(attachWhenReady, 50);
      return;
    }

    if (window.__debugListenFilterAttached) return;
    window.__debugListenFilterAttached = true;

    const style = document.createElement('style');
    style.textContent = `
      .listen-display-filter {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 14px;
        padding: 9px 10px;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background: var(--container-bg);
        font-size: 14px;
      }
      .listen-display-filter select {
        flex: 1;
        padding: 6px 8px;
        border: 1px solid var(--border-color);
        border-radius: 5px;
        background: var(--input-bg);
        color: var(--text-color);
      }
      .existing-mapping-badge {
        margin-top: 5px;
        font-size: 12px;
        color: var(--primary-color);
        word-break: break-all;
      }
      .existing-mapping-badge a {
        color: var(--link-color);
      }
    `;
    document.head.appendChild(style);

    const previousDisplay = window.displayListens;
    window.displayListens = function filteredDisplayListens(listens, filteredArtist = null) {
      let listToRender = listens || [];

      if (!filteredArtist && window.__debugAllSpotifyListens) {
        listToRender = getFilteredListens();
      }

      const result = previousDisplay.call(this, listToRender, filteredArtist);
      renderFilter();
      addMappedBadges(listToRender);
      return result;
    };
  }

  attachWhenReady();
})();
