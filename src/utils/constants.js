// API endpoints
export const API_BASE = '/api'

export const API_ENDPOINTS = {
  catalog: `${API_BASE}/catalog`,
  album: (barcode) => `${API_BASE}/album/${barcode}`,
  starredAlbums: `${API_BASE}/starred-albums`,
  starredAlbumsBackup: (syncId) => `${API_BASE}/starred-albums/${syncId}`,
  starredTracks: `${API_BASE}/starred-tracks`, 
  starredTracksBackup: (syncId) => `${API_BASE}/starred-tracks/${syncId}`,
  catalogRefresh: `${API_BASE}/catalog/refresh`
}

// Local storage keys
export const STORAGE_KEYS = {
  users: 'mb_album_users',
  currentUser: 'mb_album_current_user',
  userData: 'mb_album_user_data',
  catalogCache: 'mb_album_catalog_cache',
  viewMode: 'mb_album_view_mode',
  selectedArtist: 'mb_album_selected_artist',
  starredFilter: 'mb_album_starred_filter'
}

// View modes
export const VIEW_MODES = {
  list: 'list',
  grid: 'grid', 
  artist: 'artist'
}

// Default user data structure
export const DEFAULT_USER_DATA = {
  isAdmin: false,
  starredAlbums: [],
  starredTracks: {},
  syncId: null,
  // Spotify integration fields
  spotifyAuth: null,
  linkedAlbums: {}
}

// Generate UUID for sync IDs
export const generateSyncId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}