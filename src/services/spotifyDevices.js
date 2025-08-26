// Spotify device management service
import spotifyService from './spotify'
import storageService from './storage'

class SpotifyDeviceService {
  
  // Get user's preferred device from storage
  getPreferredDevice(currentUser) {
    try {
      const userData = storageService.getUserDataForUser(currentUser)
      return userData?.spotifyPreferredDevice || null
    } catch (error) {
      console.error('Error getting preferred device:', error)
      return null
    }
  }
  
  // Save user's preferred device
  setPreferredDevice(currentUser, deviceId, deviceName, deviceType) {
    try {
      const userData = storageService.getUserDataForUser(currentUser)
      if (!userData) return false
      
      const updatedData = {
        ...userData,
        spotifyPreferredDevice: {
          id: deviceId,
          name: deviceName,
          type: deviceType,
          lastUsed: new Date().toISOString()
        }
      }
      
      storageService.updateUserData(currentUser, updatedData)
      return true
    } catch (error) {
      console.error('Error setting preferred device:', error)
      return false
    }
  }
  
  // Get the best device to use for playback
  async getBestPlaybackDevice(currentUser, accessToken) {
    try {
      // Get available devices
      const devices = await spotifyService.getDevices(accessToken)
      
      if (!devices || devices.length === 0) {
        throw new Error('No Spotify devices available. Please open Spotify on a device first.')
      }
      
      console.log('Available devices:', devices.map(d => ({ name: d.name, type: d.type, active: d.is_active })))
      
      const preferredDevice = this.getPreferredDevice(currentUser)
      
      // Strategy 1: Use preferred device if available and active
      if (preferredDevice) {
        const preferredFound = devices.find(d => d.id === preferredDevice.id)
        if (preferredFound) {
          console.log('Using preferred device:', preferredFound.name)
          return preferredFound
        } else {
          console.log('Preferred device not available:', preferredDevice.name)
        }
      }
      
      // Strategy 2: Use currently active device
      const activeDevice = devices.find(d => d.is_active)
      if (activeDevice) {
        console.log('Using active device:', activeDevice.name)
        // Update preferred device to the active one
        this.setPreferredDevice(currentUser, activeDevice.id, activeDevice.name, activeDevice.type)
        return activeDevice
      }
      
      // Strategy 3: Prefer computer over phone/tablet
      const computerDevice = devices.find(d => d.type === 'Computer')
      if (computerDevice) {
        console.log('Using computer device:', computerDevice.name)
        this.setPreferredDevice(currentUser, computerDevice.id, computerDevice.name, computerDevice.type)
        return computerDevice
      }
      
      // Strategy 4: Use first available device
      const firstDevice = devices[0]
      console.log('Using first available device:', firstDevice.name)
      this.setPreferredDevice(currentUser, firstDevice.id, firstDevice.name, firstDevice.type)
      return firstDevice
      
    } catch (error) {
      console.error('Error getting best playback device:', error)
      throw error
    }
  }
  
  // Transfer playback to a specific device
  async transferPlayback(deviceId, accessToken, startPlayback = false) {
    try {
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: startPlayback
        })
      })
      
      if (response.status === 204) {
        return true
      } else if (!response.ok) {
        throw new Error(`Failed to transfer playback: ${response.status}`)
      }
      
      return true
    } catch (error) {
      console.error('Transfer playback error:', error)
      throw error
    }
  }
  
  // Get formatted device list for UI display
  formatDevicesForDisplay(devices, preferredDeviceId = null) {
    return devices.map(device => ({
      id: device.id,
      name: device.name,
      type: device.type,
      isActive: device.is_active,
      isPreferred: device.id === preferredDeviceId,
      icon: this.getDeviceIcon(device.type),
      displayName: device.name
    }))
  }
  
  // Get appropriate icon for device type
  getDeviceIcon(deviceType) {
    switch (deviceType.toLowerCase()) {
      case 'computer':
        return 'fas fa-desktop'
      case 'smartphone':
        return 'fas fa-mobile-alt'
      case 'tablet':
        return 'fas fa-tablet-alt'
      case 'speaker':
        return 'fas fa-volume-up'
      case 'tv':
        return 'fas fa-tv'
      case 'game_console':
        return 'fas fa-gamepad'
      default:
        return 'fas fa-music'
    }
  }
}

export default new SpotifyDeviceService()