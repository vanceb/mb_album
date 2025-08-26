// Spotify Web Playback SDK service
import { waitForSpotifySDK } from './spotifySDKGlobal.js'

class SpotifyWebPlaybackService {
  constructor() {
    this.player = null
    this.deviceId = null
    this.isInitialized = false
    this.callbacks = {
      onPlayerStateChanged: null,
      onReady: null,
      onNotReady: null
    }
  }

  // Initialize the Web Playback SDK
  async initializePlayer(accessToken, onPlayerStateChanged, onReady, onNotReady) {
    if (this.isInitialized) {
      console.log('Player already initialized')
      return this.player
    }

    if (!accessToken) {
      console.error('No access token provided for Web Playback SDK')
      throw new Error('Access token required')
    }

    console.log('Starting Web Playback SDK initialization...')

    // Wait for the SDK to be ready using our global promise
    try {
      await waitForSpotifySDK()
      console.log('SDK is ready, proceeding with player initialization')
    } catch (error) {
      console.error('SDK not ready:', error)
      throw new Error('Spotify SDK not available')
    }

    return new Promise((resolve, reject) => {
      console.log('Starting player initialization...')
      
      if (typeof window.Spotify === 'undefined') {
        console.error('Spotify SDK not loaded!')
        reject(new Error('Spotify SDK not available'))
        return
      }
      
      this.player = new window.Spotify.Player({
        name: 'Album Catalog Web Player',
        getOAuthToken: cb => { 
          console.log('SDK requesting OAuth token...')
          cb(accessToken) 
        },
        volume: 0.5
      })

      console.log('Web Playback Player created')

      // Store callbacks
      this.callbacks.onPlayerStateChanged = onPlayerStateChanged
      this.callbacks.onReady = onReady
      this.callbacks.onNotReady = onNotReady

      // Error handling
      this.player.addListener('initialization_error', ({ message }) => {
        console.error('Spotify Player initialization error:', message)
        reject(new Error(message))
      })

      this.player.addListener('authentication_error', ({ message }) => {
        console.error('Spotify Player authentication error:', message)
        reject(new Error(message))
      })

      this.player.addListener('account_error', ({ message }) => {
        console.error('Spotify Player account error:', message)
        reject(new Error(message))
      })

      this.player.addListener('playback_error', ({ message }) => {
        console.error('Spotify Player playback error:', message)
      })

      // Ready
      this.player.addListener('ready', ({ device_id }) => {
        console.log('Spotify Player ready with Device ID:', device_id)
        this.deviceId = device_id
        if (onReady) onReady(device_id)
      })

      // Not Ready
      this.player.addListener('not_ready', ({ device_id }) => {
        console.log('Spotify Player not ready, Device ID:', device_id)
        if (onNotReady) onNotReady(device_id)
      })

      // Player state changes (most important!)
      this.player.addListener('player_state_changed', (state) => {
        console.log('Spotify Player state changed:', state)
        if (onPlayerStateChanged) onPlayerStateChanged(state)
      })

      // Connect to the player
      this.player.connect().then(success => {
        if (success) {
          console.log('Successfully connected to Spotify Player')
          this.isInitialized = true
          resolve(this.player)
        } else {
          console.error('Failed to connect to Spotify Player')
          reject(new Error('Failed to connect to Spotify Player'))
        }
      })

      // Add timeout in case connection fails
      setTimeout(() => {
        if (!this.isInitialized) {
          console.error('Spotify Player connection timeout')
          reject(new Error('Player connection timeout'))
        }
      }, 10000) // 10 second timeout
    })
  }

  // Update the access token
  updateAccessToken(newAccessToken) {
    if (this.player) {
      // The player will automatically request new token via getOAuthToken callback
      console.log('Access token updated for Web Playback SDK')
    }
  }

  // Get current player state
  async getCurrentState() {
    if (!this.player) return null
    try {
      return await this.player.getCurrentState()
    } catch (error) {
      console.error('Error getting current state:', error)
      return null
    }
  }

  // Play/pause
  async togglePlay() {
    if (!this.player) return false
    try {
      return await this.player.togglePlay()
    } catch (error) {
      console.error('Error toggling play:', error)
      return false
    }
  }

  // Next track
  async nextTrack() {
    if (!this.player) return false
    try {
      return await this.player.nextTrack()
    } catch (error) {
      console.error('Error skipping to next track:', error)
      return false
    }
  }

  // Previous track
  async previousTrack() {
    if (!this.player) return false
    try {
      return await this.player.previousTrack()
    } catch (error) {
      console.error('Error skipping to previous track:', error)
      return false
    }
  }

  // Seek to position
  async seek(positionMs) {
    if (!this.player) return false
    try {
      return await this.player.seek(positionMs)
    } catch (error) {
      console.error('Error seeking:', error)
      return false
    }
  }

  // Set volume
  async setVolume(volume) {
    if (!this.player) return false
    try {
      return await this.player.setVolume(volume)
    } catch (error) {
      console.error('Error setting volume:', error)
      return false
    }
  }

  // Get device ID
  getDeviceId() {
    return this.deviceId
  }

  // Disconnect player
  disconnect() {
    if (this.player) {
      console.log('Disconnecting Spotify Player')
      this.player.disconnect()
      this.player = null
      this.deviceId = null
      this.isInitialized = false
    }
  }

  // Resume playback on this device (useful when starting playback from other sources)
  async transferPlaybackToThisDevice(accessToken, play = false) {
    if (!this.deviceId) return false
    
    try {
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          device_ids: [this.deviceId],
          play: play
        })
      })
      
      return response.ok || response.status === 204
    } catch (error) {
      console.error('Error transferring playback:', error)
      return false
    }
  }
}

export default new SpotifyWebPlaybackService()