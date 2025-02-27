const listensContainer = document.getElementById('listens-container');

// Variables to hold user input values
let listenBrainzToken = '';
let numRecentListens = 100; // Default value to fetch 100 recent listens
let username = '';

// Check if API token is stored in localStorage and prefill it
window.onload = function () {
  const savedToken = localStorage.getItem('apiToken');
  if (savedToken) {
    document.getElementById('api-token').value = savedToken;
  }
};

// Function to fetch listens from ListenBrainz
async function fetchListens() {
  username = document.getElementById('username').value;
  listenBrainzToken = document.getElementById('api-token').value;
  numRecentListens = document.getElementById('num-listens').value || 100;

  if (!username || !listenBrainzToken) {
    alert('Please enter both Username and API Token.');
    return;
  }

  // Save the API token to localStorage for future use
  localStorage.setItem('apiToken', listenBrainzToken);

  try {
    const response = await fetch(
      `https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}/listens?count=${numRecentListens}`,
      {
        headers: {
          Authorization: `Token ${listenBrainzToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch listens. Status: ${response.status}`);
    }

    const data = await response.json();
    
    // Get all listens and unmapped Spotify listens
    const allListens = data.payload.listens;
    const totalListens = allListens.length;
    
    // Get all unmapped listens (regardless of source)
    const allUnmappedListens = allListens.filter(listen => !listen.track_metadata.mbid_mapping);
    
    // Filter for unmapped listens that are from Spotify
    const unmappedSpotifyListens = allListens.filter(
      (listen) => 
        !listen.track_metadata.mbid_mapping && 
        listen.track_metadata.additional_info.music_service === "spotify.com"
    );
    
    // Store all unmapped listens in a global variable to use for filtering
    window.allUnmappedSpotifyListens = unmappedSpotifyListens;
    
    // Generate statistics
    generateStatistics(totalListens, allUnmappedListens, unmappedSpotifyListens);
    
    // Display the listens
    displayListens(unmappedSpotifyListens);
    
    // Add click event listeners to artist names for filtering
    setupArtistFiltering();
  } catch (error) {
    console.error('Error fetching listens:', error);
    alert('Failed to fetch listens.');
  }
}

// Function to generate statistics
function generateStatistics(totalListens, allUnmappedListens, unmappedSpotifyListens) {
  // Create stats container
  const statsContainer = document.createElement('div');
  statsContainer.classList.add('stats-container');
  
  // Calculate percentages
  const allUnmappedPercentage = (allUnmappedListens.length / totalListens * 100).toFixed(1);
  const spotifyUnmappedPercentage = (unmappedSpotifyListens.length / totalListens * 100).toFixed(1);
  
  // Get top unmapped artists
  const artistCounts = {};
  unmappedSpotifyListens.forEach(listen => {
    const artistName = listen.track_metadata.artist_name;
    artistCounts[artistName] = (artistCounts[artistName] || 0) + 1;
  });
  
  // Sort artists by count
  const sortedArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5); // Just take top 5
  
  // Create HTML for stats
  statsContainer.innerHTML = `
    <h2>Statistics Dashboard</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-title">Total Listens</div>
        <div class="stat-value">${totalListens}</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">All Unmapped</div>
        <div class="stat-value">${allUnmappedListens.length} <span class="stat-percentage">(${allUnmappedPercentage}%)</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Unmapped Spotify</div>
        <div class="stat-value">${unmappedSpotifyListens.length} <span class="stat-percentage">(${spotifyUnmappedPercentage}%)</span></div>
      </div>
    </div>
    <div class="stat-card" style="margin-top: 15px;">
      <div class="stat-title">Top Unmapped Artists <span class="filter-notice" id="filter-notice"></span></div>
      <div class="top-artists">
        ${sortedArtists.map(([artist, count]) => 
          `<div class="artist-stat" data-artist="${escapeJsString(artist)}">
            <span class="artist-name artist-filter-link">${escapeHtml(artist)}</span>
            <span class="artist-count">${count} tracks</span>
          </div>`
        ).join('')}
      </div>
      ${sortedArtists.length > 0 ? '<div class="clear-filter" id="clear-filter" style="display: none;">Clear Filter</div>' : ''}
    </div>
  `;
  
  // Insert the stats at the top of the listens container
  listensContainer.innerHTML = '';
  listensContainer.appendChild(statsContainer);
}

// Function to display listens in the UI
function displayListens(listens, filteredArtist = null) {
  // Remove any existing listens-list if it exists
  const existingListensList = document.querySelector('.listens-list');
  if (existingListensList) {
    existingListensList.remove();
  }
  
  // Create a container for the listens
  const listensListDiv = document.createElement('div');
  listensListDiv.classList.add('listens-list');

  if (listens.length === 0) {
    listensListDiv.innerHTML = '<p class="no-results">No unmapped Spotify listens found.</p>';
    listensContainer.appendChild(listensListDiv);
    return;
  }

  // Add a heading for the listens
  const listensHeading = document.createElement('h2');
  if (filteredArtist) {
    listensHeading.textContent = `Unmapped Spotify Listens for ${filteredArtist} (${listens.length})`;
  } else {
    listensHeading.textContent = `Unmapped Spotify Listens (${listens.length})`;
  }
  listensListDiv.appendChild(listensHeading);
  
  listens.forEach((listen, index) => {
    const trackMetadata = listen.track_metadata;
    const artistNames = trackMetadata.additional_info.artist_names || [];
    const spotifyAlbumLink = trackMetadata.additional_info.spotify_album_id;
    const spotifyArtistLinks = trackMetadata.additional_info.spotify_artist_ids || [];
    const trackName = trackMetadata.track_name;
    const recordingMsid = trackMetadata.additional_info.recording_msid;

    const listenItem = document.createElement('div');
    listenItem.classList.add('listen-item');
    listenItem.innerHTML = `
      <div style="flex-grow: 1;">
        <strong>${escapeHtml(trackName)}</strong> by ${artistNames
      .map((artist, i) =>
        spotifyArtistLinks[i] ? 
        `<a href="${escapeHtml(spotifyArtistLinks[i])}" target="_blank">${escapeHtml(artist)}</a>` : 
        escapeHtml(artist)
      )
      .join(', ')}
      </div>
      ${spotifyAlbumLink ? `
        <a href="${escapeHtml(spotifyAlbumLink)}" target="_blank" title="Open in Spotify">
          <img src="spotlogo.png" alt="Spotify" style="width: 30px; height: 30px; margin-right: 10px;">
        </a>
        <a href="https://harmony.pulsewidth.org.uk/release?url=${encodeURIComponent(spotifyAlbumLink)}&category=all" target="_blank" title="Submit to Harmony">
          <img src="harmonylogo.svg" alt="Harmony" style="width: 30px; height: 30px; margin-right: 10px;">
        </a>
        <a href="https://musicbrainz.org/search?query=artist%3A%22${encodeURIComponent(artistNames[0])}%22+AND+recording%3A%22${encodeURIComponent(trackName)}%22&type=recording&limit=25&method=advanced" target="_blank" title="Search in MusicBrainz">
          <img src="musicbrainz.png" alt="MusicBrainz" style="width: 30px; height: 30px;">
        </a>
      ` : '<span>No Spotify link available</span>'}
      <input type="text" id="recording-url-${index}" placeholder="Enter MusicBrainz Recording URL">
      <button onclick="submitManualMapping('${escapeJsString(recordingMsid)}', 'recording-url-${index}', '${escapeJsString(trackName)}')">Submit MBID</button>
    `;
    listensListDiv.appendChild(listenItem);
  });

  listensContainer.appendChild(listensListDiv);
}

// Function to escape HTML to prevent XSS
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Function to escape strings used in JavaScript function calls
function escapeJsString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

// Function to encode and sanitize input
function encodeAndSanitize(input) {
  return encodeURIComponent(input.trim()); // Encodes special characters and trims whitespace
}

// Function to submit a manual MBID mapping
async function submitManualMapping(recordingMsid, inputId, trackName) {
  const recordingUrl = document.getElementById(inputId).value;
  const mbidMatch = recordingUrl.match(/recording\/([a-f0-9-]{36})/);

  if (!mbidMatch) {
    alert(`Invalid MusicBrainz Recording URL for "${trackName}".`);
    return;
  }

  const recordingMbid = mbidMatch[1];
  try {
    const response = await fetch(
      'https://api.listenbrainz.org/1/metadata/submit_manual_mapping/',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${listenBrainzToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recording_msid: recordingMsid,
          recording_mbid: recordingMbid,
        }),
      }
    );

    if (response.ok) {
      alert(`Successfully mapped MBID for "${trackName}".`);
    } else {
      const errorData = await response.json();
      alert(`Error mapping MBID: ${errorData.error}`);
    }
  } catch (error) {
    console.error(`Error mapping MBID for "${trackName}":`, error);
    alert('Failed to map MBID.');
  }
}

// Function to submit listens
async function submitListen(trackMetadata) {
  try {
    const payload = {
      listen_type: 'single',
      payload: [
        {
          listened_at: Math.floor(Date.now() / 1000),
          track_metadata: trackMetadata,
        },
      ],
    };

    const response = await fetch(
      'https://api.listenbrainz.org/1/submit-listens',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${listenBrainzToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (response.ok) {
      alert('Listen submitted successfully.');
    } else {
      const errorData = await response.json();
      alert(`Error submitting listen: ${errorData.error}`);
    }
  } catch (error) {
    console.error('Error submitting listen:', error);
    alert('Failed to submit listen.');
  }
}

// Function to extract MBID from a MusicBrainz URL and submit it
async function submitRecordingMBID() {
  const rawRecordingUrl = document.getElementById('recording-url').value;
  const sanitizedUrl = encodeAndSanitize(rawRecordingUrl); // Sanitize and encode the input URL
  const mbidMatch = sanitizedUrl.match(/recording%2F([a-f0-9-]{36})/); // Match after encoding

  if (!mbidMatch) {
    alert('Invalid MusicBrainz Recording URL. Please double-check it.');
    return;
  }

  const recordingMBID = mbidMatch[1];
  const userToken = document.getElementById('api-token').value;

  if (!userToken) {
    alert('Please provide a valid API Token.');
    return;
  }

  try {
    const response = await fetch('https://api.listenbrainz.org/1/feedback/recording-feedback', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recording_mbid: recordingMBID,
        score: 1, // Example: marking the track as 'loved'
      }),
    });

    if (response.ok) {
      alert('Recording MBID submitted successfully.');
    } else {
      const errorData = await response.json();
      alert(`Error: ${errorData.error}`);
    }
  } catch (error) {
    console.error('Error submitting MBID:', error);
    alert('An unexpected error occurred. Please try again.');
  }
}

// Setup artist filtering functionality
function setupArtistFiltering() {
  console.log("Setting up artist filtering");
  const artistLinks = document.querySelectorAll('.artist-filter-link');
  const clearFilterBtn = document.getElementById('clear-filter');
  
  console.log(`Found ${artistLinks.length} artist links`);
  
  if (!artistLinks.length) return;
  
  // Add click events to artist names
  artistLinks.forEach(link => {
    link.addEventListener('click', function() {
      console.log("Artist link clicked");
      const artistDiv = this.closest('.artist-stat');
      const artist = artistDiv.getAttribute('data-artist');
      console.log(`Filtering for artist: ${artist}`);
      
      // Filter the listens
      const filteredListens = window.allUnmappedSpotifyListens.filter(listen => {
        return listen.track_metadata.artist_name.includes(artist);
      });
      
      console.log(`Found ${filteredListens.length} matches`);
      
      // Update UI to show filtering is active
      const filterNotice = document.getElementById('filter-notice');
      if (filterNotice) {
        filterNotice.textContent = ` (filtered)`;
      }
      
      if (clearFilterBtn) {
        clearFilterBtn.style.display = 'block';
      }
      
      // Highlight the selected artist
      document.querySelectorAll('.artist-stat').forEach(stat => {
        stat.classList.remove('active-filter');
      });
      artistDiv.classList.add('active-filter');
      
      // Display the filtered listens
      displayListens(filteredListens, artist);
    });
  });
  
  // Clear filter functionality
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener('click', function() {
      console.log("Clear filter clicked");
      // Reset UI
      const filterNotice = document.getElementById('filter-notice');
      if (filterNotice) {
        filterNotice.textContent = '';
      }
      this.style.display = 'none';
      
      // Remove highlight
      document.querySelectorAll('.artist-stat').forEach(stat => {
        stat.classList.remove('active-filter');
      });
      
      // Display all listens
      displayListens(window.allUnmappedSpotifyListens);
    });
  }
}