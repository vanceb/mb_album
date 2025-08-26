// Spotify API service layer
import { SPOTIFY_URLS } from '../utils/spotify'

class SpotifyService {
  
  // Search for albums on Spotify
  async searchAlbums(query, accessToken) {
    try {
      const response = await fetch(`${SPOTIFY_URLS.API_BASE}/search?q=${encodeURIComponent(query)}&type=album&limit=20`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      
      if (!response.ok) {
        throw new Error(`Spotify search failed: ${response.status}`)
      }
      
      const data = await response.json()
      return data.albums.items
    } catch (error) {
      console.error('Spotify album search error:', error)
      throw error
    }
  }
  
  // Get user's available devices
  async getDevices(accessToken) {
    try {
      const response = await fetch(`${SPOTIFY_URLS.API_BASE}/me/player/devices`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      
      if (!response.ok) {
        throw new Error(`Failed to get devices: ${response.status}`)
      }
      
      const data = await response.json()
      return data.devices
    } catch (error) {
      console.error('Spotify devices error:', error)
      throw error
    }
  }
  
  // Start playback of an album
  async playAlbum(albumUri, deviceId, accessToken) {
    try {
      const body = {
        context_uri: albumUri
      }
      
      const url = deviceId 
        ? `${SPOTIFY_URLS.API_BASE}/me/player/play?device_id=${deviceId}`
        : `${SPOTIFY_URLS.API_BASE}/me/player/play`
      
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      
      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to start playback: ${response.status}`)
      }
      
      return true
    } catch (error) {
      console.error('Spotify playback error:', error)
      throw error
    }
  }
  
  // Start playback of a specific track
  async playTrack(trackUri, deviceId, accessToken) {
    try {
      const body = {
        uris: [trackUri]
      }
      
      const url = deviceId 
        ? `${SPOTIFY_URLS.API_BASE}/me/player/play?device_id=${deviceId}`
        : `${SPOTIFY_URLS.API_BASE}/me/player/play`
      
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      
      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to start track playback: ${response.status}`)
      }
      
      return true
    } catch (error) {
      console.error('Spotify track playback error:', error)
      throw error
    }
  }
  
  // Pause playback
  async pausePlayback(accessToken) {
    try {
      const response = await fetch(`${SPOTIFY_URLS.API_BASE}/me/player/pause`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      
      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to pause playback: ${response.status}`)
      }
      
      return true
    } catch (error) {
      console.error('Spotify pause error:', error)
      throw error
    }
  }
  
  // Get current playback state
  async getCurrentPlayback(accessToken) {
    try {
      const response = await fetch(`${SPOTIFY_URLS.API_BASE}/me/player`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      
      if (response.status === 204) {
        return null // No active playback
      }
      
      if (!response.ok) {
        throw new Error(`Failed to get playback state: ${response.status}`)
      }
      
      return await response.json()
    } catch (error) {
      console.error('Spotify playback state error:', error)
      throw error
    }
  }
}

export default new SpotifyService()