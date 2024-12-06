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
      `https://api.listenbrainz.org/1/user/${username}/listens?count=${numRecentListens}`,
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
    const unmappedListens = data.payload.listens.filter(
      (listen) => !listen.track_metadata.mbid_mapping
    );
    displayListens(unmappedListens);
  } catch (error) {
    console.error('Error fetching listens:', error);
    alert('Failed to fetch listens.');
  }
}

// Function to display listens in the UI
function displayListens(listens) {
  listensContainer.innerHTML = ''; // Clear previous listens

  if (listens.length === 0) {
    listensContainer.innerHTML = '<p>No unmapped listens found.</p>';
    return;
  }

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
        <strong>${trackName}</strong> by ${artistNames
      .map((artist, i) =>
        spotifyArtistLinks[i] ? `<a href="${spotifyArtistLinks[i]}" target="_blank">${artist}</a>` : artist
      )
      .join(', ')}
      </div>
      ${spotifyAlbumLink ? `
        <a href="${spotifyAlbumLink}" target="_blank" title="Open in Spotify">
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
      <button onclick="submitManualMapping('${recordingMsid}', 'recording-url-${index}', '${trackName}')">Submit MBID</button>
    `;
    listensContainer.appendChild(listenItem);
  });
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

// Function to encode and sanitize input
function encodeAndSanitize(input) {
  return encodeURIComponent(input.trim()); // Encodes special characters and trims whitespace
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