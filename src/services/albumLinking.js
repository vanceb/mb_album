// Album linking service - connects catalog albums to Spotify albums
import spotifyService from './spotify'
import storageService from './storage'
import { formatSpotifySearchQuery } from '../utils/spotify'

class AlbumLinkingService {
  
  // Search Spotify for an album and return potential matches
  async searchForAlbum(albumData, accessToken) {
    try {
      // Extract data from catalog album
      const artist = albumData.Artist || ''
      const album = albumData['Album/Release'] || ''
      const year = albumData['First Release'] ? albumData['First Release'].substring(0, 4) : null
      
      if (!artist || !album) {
        throw new Error('Album data missing artist or title')
      }
      
      // Create search query
      const query = formatSpotifySearchQuery(artist, album, year)
      
      // Search Spotify
      const results = await spotifyService.searchAlbums(query, accessToken)
      
      // Score and sort results by relevance
      const scoredResults = results.map(spotifyAlbum => ({
        ...spotifyAlbum,
        relevanceScore: this.calculateRelevanceScore(albumData, spotifyAlbum)
      })).sort((a, b) => b.relevanceScore - a.relevanceScore)
      
      return scoredResults
    } catch (error) {
      console.error('Album search error:', error)
      throw error
    }
  }
  
  // Calculate how well a Spotify album matches our catalog album
  calculateRelevanceScore(catalogAlbum, spotifyAlbum) {
    let score = 0
    
    const catalogArtist = (catalogAlbum.Artist || '').toLowerCase()
    const catalogTitle = (catalogAlbum['Album/Release'] || '').toLowerCase()
    const catalogYear = catalogAlbum['First Release'] ? 
      parseInt(catalogAlbum['First Release'].substring(0, 4)) : null
    
    const spotifyArtist = (spotifyAlbum.artists[0]?.name || '').toLowerCase()
    const spotifyTitle = (spotifyAlbum.name || '').toLowerCase()
    const spotifyYear = spotifyAlbum.release_date ? 
      parseInt(spotifyAlbum.release_date.substring(0, 4)) : null
    
    // Artist name match (most important)
    if (catalogArtist === spotifyArtist) {
      score += 100
    } else if (this.fuzzyMatch(catalogArtist, spotifyArtist)) {
      score += 80
    } else if (spotifyArtist.includes(catalogArtist) || catalogArtist.includes(spotifyArtist)) {
      score += 60
    }
    
    // Album title match
    if (catalogTitle === spotifyTitle) {
      score += 100
    } else if (this.fuzzyMatch(catalogTitle, spotifyTitle)) {
      score += 80
    } else if (spotifyTitle.includes(catalogTitle) || catalogTitle.includes(spotifyTitle)) {
      score += 60
    }
    
    // Year match (if available)
    if (catalogYear && spotifyYear) {
      if (catalogYear === spotifyYear) {
        score += 50
      } else if (Math.abs(catalogYear - spotifyYear) <= 1) {
        score += 30 // Allow 1 year difference for reissues
      } else if (Math.abs(catalogYear - spotifyYear) <= 3) {
        score += 10
      }
    }
    
    // Bonus for having album art
    if (spotifyAlbum.images && spotifyAlbum.images.length > 0) {
      score += 10
    }
    
    return score
  }
  
  // Simple fuzzy matching (handles small differences)
  fuzzyMatch(str1, str2) {
    // Remove common differences
    const normalize = (str) => str
      .toLowerCase()
      .replace(/[&+]/g, 'and')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    const norm1 = normalize(str1)
    const norm2 = normalize(str2)
    
    return norm1 === norm2
  }
  
  // Link a catalog album to a Spotify album
  linkAlbum(currentUser, catalogBarcode, spotifyAlbum) {
    try {
      const userData = storageService.getUserDataForUser(currentUser)
      
      if (!userData.linkedAlbums) {
        userData.linkedAlbums = {}
      }
      
      // Store the Spotify album data
      userData.linkedAlbums[catalogBarcode] = {
        spotifyId: spotifyAlbum.id,
        spotifyUri: spotifyAlbum.uri,
        name: spotifyAlbum.name,
        artist: spotifyAlbum.artists[0]?.name,
        releaseDate: spotifyAlbum.release_date,
        images: spotifyAlbum.images,
        externalUrls: spotifyAlbum.external_urls,
        linkedAt: new Date().toISOString(),
        totalTracks: spotifyAlbum.total_tracks
      }
      
      console.log('Linking album:', {
        currentUser,
        catalogBarcode,
        spotifyAlbum: spotifyAlbum.name,
        linkedData: userData.linkedAlbums[catalogBarcode]
      })
      
      storageService.updateUserData(currentUser, userData)
      
      // Verify the data was stored
      const verifyData = storageService.getUserDataForUser(currentUser)
      console.log('Verification - album linked?', !!verifyData.linkedAlbums[catalogBarcode])
      
      return true
    } catch (error) {
      console.error('Album linking error:', error)
      throw error
    }
  }
  
  // Remove link between catalog and Spotify album
  unlinkAlbum(currentUser, catalogBarcode) {
    try {
      const userData = storageService.getUserDataForUser(currentUser)
      
      if (userData.linkedAlbums && userData.linkedAlbums[catalogBarcode]) {
        delete userData.linkedAlbums[catalogBarcode]
        storageService.updateUserData(currentUser, userData)
        return true
      }
      
      return false
    } catch (error) {
      console.error('Album unlinking error:', error)
      throw error
    }
  }
  
  // Check if an album is linked to Spotify
  isAlbumLinked(currentUser, catalogBarcode) {
    try {
      const userData = storageService.getUserDataForUser(currentUser)
      return !!(userData.linkedAlbums && userData.linkedAlbums[catalogBarcode])
    } catch (error) {
      console.error('Check album link error:', error)
      return false
    }
  }
  
  // Get Spotify data for a linked album
  getLinkedAlbum(currentUser, catalogBarcode) {
    try {
      const userData = storageService.getUserDataForUser(currentUser)
      const linkedAlbum = userData.linkedAlbums && userData.linkedAlbums[catalogBarcode]
      
      // Removed verbose logging to reduce console noise
      
      return linkedAlbum
    } catch (error) {
      console.error('Get linked album error:', error)
      return null
    }
  }
  
  // Get all linked albums for a user
  getAllLinkedAlbums(currentUser) {
    try {
      const userData = storageService.getUserDataForUser(currentUser)
      return userData.linkedAlbums || {}
    } catch (error) {
      console.error('Get all linked albums error:', error)
      return {}
    }
  }
  
  // Auto-link: search and link the best match automatically
  async autoLinkAlbum(currentUser, catalogBarcode, albumData, accessToken) {
    try {
      const results = await this.searchForAlbum(albumData, accessToken)
      
      if (results.length === 0) {
        return {
          success: false,
          searchResults: [],
          confidence: 'none',
          message: 'No matches found on Spotify. You can try the manual search in the modal.'
        }
      }
      
      // Auto-link if the top result has a high confidence score
      const topResult = results[0]
      if (topResult.relevanceScore >= 180) { // High confidence threshold
        this.linkAlbum(currentUser, catalogBarcode, topResult)
        return {
          success: true,
          linkedAlbum: topResult,
          confidence: 'high'
        }
      }
      
      // Return search results for manual selection
      return {
        success: false,
        searchResults: results,
        confidence: 'low',
        message: 'Multiple matches found. Please select the correct album.'
      }
    } catch (error) {
      console.error('Auto-link error:', error)
      throw error
    }
  }
}

export default new AlbumLinkingService()