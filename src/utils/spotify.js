// Spotify Web API configuration and utilities

export const SPOTIFY_CONFIG = {
  CLIENT_ID: 'bf2410b819cb452eb0ff08b17005e414',
  REDIRECT_URI: 'http://127.0.0.1:5000/spotify/callback',
  SCOPES: [
    'user-read-playback-state',
    'user-modify-playback-state', 
    'user-read-currently-playing',
    'streaming'
  ].join(' ')
}

export const SPOTIFY_URLS = {
  AUTHORIZE: 'https://accounts.spotify.com/authorize',
  TOKEN: 'https://accounts.spotify.com/api/token',
  API_BASE: 'https://api.spotify.com/v1'
}

// Generate Spotify OAuth URL
export const getSpotifyAuthUrl = () => {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_CONFIG.REDIRECT_URI,
    scope: SPOTIFY_CONFIG.SCOPES,
    state: generateRandomString(16)
  })
  
  return `${SPOTIFY_URLS.AUTHORIZE}?${params}`
}

// Generate random string for state parameter
const generateRandomString = (length) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let text = ''
  
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  
  return text
}

// Check if user has Spotify connected (regardless of token expiry)
export const hasSpotifyConnected = (userData) => {
  const auth = userData?.spotifyAuth
  return auth && (auth.access_token || auth.refresh_token)
}

// Check if user has valid (non-expired) Spotify auth
export const hasValidSpotifyAuth = (userData) => {
  const auth = userData?.spotifyAuth
  if (!auth || !auth.access_token) return false
  
  // Check if token is expired (with 5 minute buffer)
  const expiresAt = new Date(auth.expires_at)
  const now = new Date()
  const bufferMs = 5 * 60 * 1000 // 5 minutes
  
  return expiresAt.getTime() - now.getTime() > bufferMs
}

// Refresh Spotify access token
export const refreshSpotifyToken = async (refreshToken) => {
  try {
    const response = await fetch('/spotify/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refresh_token: refreshToken
      })
    })
    
    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`)
    }
    
    return await response.json()
  } catch (error) {
    console.error('Spotify token refresh error:', error)
    throw error
  }
}

// Format album search query for Spotify
export const formatSpotifySearchQuery = (artist, album, year) => {
  let query = `artist:"${artist}" album:"${album}"`
  if (year) {
    query += ` year:${year}`
  }
  return query
}