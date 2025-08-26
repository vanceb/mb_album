import { API_ENDPOINTS } from '../utils/constants'

class ApiService {
  async request(url, options = {}) {
    const config = {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    }

    try {
      const response = await fetch(url, config)
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`)
      }
      
      return data
    } catch (error) {
      console.error('API request failed:', error)
      throw error
    }
  }

  async getCatalog() {
    console.log('API: Requesting catalog from', API_ENDPOINTS.catalog)
    const data = await this.request(API_ENDPOINTS.catalog)
    console.log('API: Catalog response structure:', Object.keys(data))
    console.log('API: Catalog count:', data.count, 'items')
    console.log('API: Catalog data length:', data.catalog ? data.catalog.length : 'null')
    return data.catalog
  }

  async getAlbum(barcode) {
    return await this.request(API_ENDPOINTS.album(barcode))
  }

  async syncStarredAlbums(syncId, starredAlbums) {
    return await this.request(API_ENDPOINTS.starredAlbums, {
      method: 'POST',
      body: JSON.stringify({ syncId, starredAlbums })
    })
  }

  async getStarredAlbumsBackup(syncId) {
    return await this.request(API_ENDPOINTS.starredAlbumsBackup(syncId))
  }

  async syncStarredTracks(syncId, starredTracks) {
    return await this.request(API_ENDPOINTS.starredTracks, {
      method: 'POST',
      body: JSON.stringify({ syncId, starredTracks })
    })
  }

  async getStarredTracksBackup(syncId) {
    return await this.request(API_ENDPOINTS.starredTracksBackup(syncId))
  }

  async refreshCatalog() {
    return await this.request(API_ENDPOINTS.catalogRefresh, {
      method: 'POST'
    })
  }

  // Legacy starring endpoints (for backwards compatibility)
  async starAlbum(barcode) {
    return await this.request(`/star-album/${barcode}`, {
      method: 'POST'
    })
  }

  async unstarAlbum(barcode) {
    return await this.request(`/unstar-album/${barcode}`, {
      method: 'POST'
    })
  }

  async starTrack(barcode, trackNumber) {
    return await this.request(`/star/${barcode}/${trackNumber}`, {
      method: 'POST'
    })
  }

  async unstarTrack(barcode, trackNumber) {
    return await this.request(`/unstar/${barcode}/${trackNumber}`, {
      method: 'POST'
    })
  }
}

export default new ApiService()