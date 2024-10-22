const listensContainer = document.getElementById('listens-container');

// Variables to hold user input values
let listenBrainzToken = '';
let numRecentListens = 100;  // Default value to fetch 100 recent listens
let username = '';

// Check if API token is stored in localStorage and prefill it
window.onload = function() {
  const savedToken = localStorage.getItem('apiToken');
  if (savedToken) {
    document.getElementById('api-token').value = savedToken;
  }
}

// Function to fetch listens from ListenBrainz
async function fetchListens() {
  // Get values from input fields
  username = document.getElementById('username').value;
  listenBrainzToken = document.getElementById('api-token').value;
  numRecentListens = document.getElementById('num-listens').value || 100;  // Default to 100 listens if not specified

  // Save the API token to localStorage for future use
  if (listenBrainzToken) {
    localStorage.setItem('apiToken', listenBrainzToken);
  }

  const debugContainer = document.createElement('div');  // For displaying debug info
  listensContainer.appendChild(debugContainer);          // Append debug container to listens container

  if (!username || !listenBrainzToken) {
    alert('Please enter all required fields: Username and API Token.');
    return;
  }

  // Clear any previous debug info
  debugContainer.innerHTML = '';

  try {
    const response = await fetch(`https://api.listenbrainz.org/1/user/${username}/listens?count=${numRecentListens}`, {
      headers: {
        'Authorization': `Token ${listenBrainzToken}`
      }
    });

    // Log response status and headers for further debugging
    console.log('Status Code:', response.status);
    console.log('Headers:', response.headers);

    // Display response status on the page
    debugContainer.innerHTML = `<p>Status Code: ${response.status}</p>`;

    // Check if response status is not OK (200)
    if (!response.ok) {
      throw new Error(`API request failed with status code: ${response.status}`);
    }

    // Parse the response as JSON
    const data = await response.json();

    // Display the full API response on the page for debugging
    debugContainer.innerHTML += `<pre>Full API Response: ${JSON.stringify(data, null, 2)}</pre>`;

    // Log the full API response to console for debugging
    console.log('Full API Response:', data);

    // Filter listens to only include unmapped listens (those without mbid_mapping)
    if (data && data.payload && data.payload.listens) {
      const unmappedListens = data.payload.listens.filter(listen => !listen.track_metadata.mbid_mapping);
      displayListens(unmappedListens); // Only display unmapped listens
    } else {
      throw new Error('No listens found or incorrect response structure.');
    }

  } catch (error) {
    // Display the error message on the page
    debugContainer.innerHTML += `<p>Error: ${error.message}</p>`;
    console.error('Error:', error);
  }
}

// Function to display listens in the UI and show Spotify album links, Harmony submission link, and MusicBrainz search button
function displayListens(listens) {
  listensContainer.innerHTML = '';  // Clear previous listens

  if (listens.length === 0) {
    listensContainer.innerHTML = '<p>No unmapped listens found for this user.</p>';
    return;
  }

  listens.forEach((listen, index) => {
    const trackMetadata = listen.track_metadata;
    const artistNames = trackMetadata.additional_info.artist_names || [];
    const spotifyArtistLinks = trackMetadata.additional_info.spotify_artist_ids || [];
    const trackName = trackMetadata.track_name;
    const additionalInfo = trackMetadata.additional_info || {};
    
    // Extract Spotify album link from the additional_info section
    const spotifyAlbumLink = additionalInfo.spotify_album_id;

    // Extract track duration and convert it to minutes:seconds format
    const durationMs = trackMetadata.additional_info.duration_ms;
    const trackDuration = durationMs ? `${Math.floor(durationMs / 60000)}:${('0' + Math.floor((durationMs % 60000) / 1000)).slice(-2)}` : 'Unknown duration';

    // Generate the correct Harmony submission link
    const harmonySubmissionLink = `https://harmony.pulsewidth.org.uk/release?url=${encodeURIComponent(spotifyAlbumLink)}&spotify&deezer&itunes&tidal&musicbrainz&region=US`;

    // Generate the MusicBrainz search link for artist and track
    const musicBrainzSearchLink = `https://musicbrainz.org/search?query=artist%3A%22${encodeURIComponent(artistNames[0])}%22+AND+recording%3A%22${encodeURIComponent(trackName)}%22&type=recording&limit=25&method=advanced`;

    const listenItem = document.createElement('div');
    listenItem.classList.add('listen-item');
    listenItem.style.display = 'flex';
    listenItem.style.alignItems = 'center';  // Aligns items vertically in the center
    listenItem.style.marginBottom = '10px';  // Add some spacing between items

    // Create clickable artist links for each artist
    let artistLinks = '';
    artistNames.forEach((artist, i) => {
      const artistLink = spotifyArtistLinks[i] ? `<a href="${spotifyArtistLinks[i]}" target="_blank">${artist}</a>` : artist;
      artistLinks += artistLink + (i < artistNames.length - 1 ? ', ' : '');
    });

    // Display listen item with the Spotify album link, Harmony submission link, and MusicBrainz search button
    listenItem.innerHTML = `
      <div style="margin-right: 15px; flex-grow: 1;">
        <strong>${trackName}</strong> by ${artistLinks} (${trackDuration})
      </div>
      ${spotifyAlbumLink ? `
        <a href="${spotifyAlbumLink}" target="_blank" title="Open in Spotify">
          <img src="spotlogo.png" alt="Spotify" style="width: 30px; height: 30px; margin-right: 10px;">
        </a>
        <a href="${harmonySubmissionLink}" target="_blank" title="Submit to Harmony">
          <img src="harmonylogo.svg" alt="Harmony" style="width: 30px; height: 30px; margin-right: 10px;">
        </a>
        <a href="${musicBrainzSearchLink}" target="_blank" title="Search in MusicBrainz">
          <img src="musicbrainz.png" alt="MusicBrainz" style="width: 30px; height: 30px;">
        </a>
      ` : '<span>No Spotify link available</span>'}
    `;

    listensContainer.appendChild(listenItem);
  });
}
