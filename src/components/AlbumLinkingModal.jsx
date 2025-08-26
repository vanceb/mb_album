import React, { useState, useEffect } from 'react'
import { useAppContext } from '../hooks/useAppContext'
import albumLinkingService from '../services/albumLinking'
import spotifyService from '../services/spotify'
import { hasValidSpotifyAuth } from '../utils/spotify'

function AlbumLinkingModal({ isOpen, onClose, albumData, catalogBarcode }) {
  const { currentUser, userData, refreshUserData } = useAppContext()
  const [loading, setLoading] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('')
  const [manualSearchTerm, setManualSearchTerm] = useState('')

  // Get current user data
  const currentUserData = userData[currentUser]
  
  // Check if user has valid Spotify auth
  const hasSpotifyAuth = hasValidSpotifyAuth(currentUserData)

  // Search for album matches when modal opens
  useEffect(() => {
    if (isOpen && hasSpotifyAuth && albumData && catalogBarcode) {
      searchForMatches()
    }
  }, [isOpen, hasSpotifyAuth, albumData, catalogBarcode])

  const searchForMatches = async (customSearchTerm = null) => {
    setLoading(true)
    setMessage('')
    setSearchResults([])
    
    try {
      let results
      
      if (customSearchTerm) {
        // Manual search with custom term
        results = await spotifyService.searchAlbums(customSearchTerm, currentUserData.spotifyAuth.access_token)
        // Add relevance scores for consistency (though they won't be as accurate)
        results = results.map(album => ({
          ...album,
          relevanceScore: 50 // Neutral score for manual searches
        }))
      } else {
        // Automatic search using album data
        results = await albumLinkingService.searchForAlbum(
          albumData, 
          currentUserData.spotifyAuth.access_token
        )
      }
      
      if (results.length === 0) {
        setMessage(customSearchTerm ? 
          `No results found for "${customSearchTerm}"` : 
          'No matches found on Spotify for this album.')
        setMessageType('warning')
      } else {
        setSearchResults(results)
        if (customSearchTerm) {
          setMessage(`Found ${results.length} result${results.length === 1 ? '' : 's'} for "${customSearchTerm}"`)
          setMessageType('success')
        }
      }
    } catch (error) {
      console.error('Search error:', error)
      setMessage(`Search failed: ${error.message}`)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const handleManualSearch = (e) => {
    e.preventDefault()
    if (manualSearchTerm.trim()) {
      searchForMatches(manualSearchTerm.trim())
    }
  }

  const handleLinkAlbum = async (spotifyAlbum) => {
    try {
      albumLinkingService.linkAlbum(currentUser, catalogBarcode, spotifyAlbum)
      refreshUserData()
      
      setMessage(`Successfully linked to "${spotifyAlbum.name}" by ${spotifyAlbum.artists[0]?.name}`)
      setMessageType('success')
      
      // Close modal after brief delay
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (error) {
      console.error('Linking error:', error)
      setMessage(`Failed to link album: ${error.message}`)
      setMessageType('error')
    }
  }

  const handleUnlink = () => {
    try {
      albumLinkingService.unlinkAlbum(currentUser, catalogBarcode)
      refreshUserData()
      
      setMessage('Album unlinked from Spotify')
      setMessageType('success')
      
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (error) {
      console.error('Unlinking error:', error)
      setMessage(`Failed to unlink album: ${error.message}`)
      setMessageType('error')
    }
  }

  const showMessage = (msg, type) => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => {
      setMessage('')
      setMessageType('')
    }, 3000)
  }

  if (!isOpen || !albumData) return null

  // Check if album is already linked
  const linkedAlbum = albumLinkingService.getLinkedAlbum(currentUser, catalogBarcode)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth: '900px', maxHeight: '85vh', overflowY: 'auto'}}>
        <div className="modal-header">
          <h3>Link to Spotify</h3>
          <button className="close-btn" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="modal-body" style={{padding: '1rem'}}>
          {/* Album Info */}
          <div className="album-info-header" style={{marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f8f9fa', borderRadius: '6px'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <div>
                <h4 style={{margin: '0 0 0.25rem 0', fontSize: '1.1rem', lineHeight: '1.2'}}>
                  {albumData.Artist} - {albumData['Album/Release']}
                </h4>
                <div style={{color: '#666', fontSize: '0.85rem'}}>
                  {albumData['First Release'] && `Released: ${albumData['First Release'].substring(0, 4)}`}
                  {catalogBarcode && ` • Barcode: ${catalogBarcode}`}
                </div>
              </div>
            </div>
          </div>

          {/* Messages */}
          {message && (
            <div className={`alert ${messageType === 'error' ? 'alert-error' : messageType === 'warning' ? 'alert-warning' : 'alert-success'}`}>
              {message}
            </div>
          )}

          {/* No Spotify Auth */}
          {!hasSpotifyAuth && (
            <div className="alert alert-warning">
              <strong>Spotify Not Connected</strong><br />
              Please connect your Spotify account in the Transfer Data modal to link albums.
            </div>
          )}

          {/* Already Linked */}
          {linkedAlbum && (
            <div className="linked-album-info" style={{marginBottom: '1rem'}}>
              <h4 style={{color: '#28a745', marginBottom: '0.75rem', fontSize: '1rem'}}>
                <i className="fas fa-link"></i> Currently Linked
              </h4>
              <div className="spotify-album-card" style={{
                display: 'flex', 
                gap: '0.75rem', 
                padding: '0.75rem', 
                border: '1px solid #28a745', 
                borderRadius: '6px',
                backgroundColor: '#f8fff9'
              }}>
                {linkedAlbum.images && linkedAlbum.images[0] && (
                  <img 
                    src={linkedAlbum.images[0].url} 
                    alt="Album cover"
                    style={{width: '60px', height: '60px', borderRadius: '4px', flexShrink: 0}}
                  />
                )}
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontWeight: 'bold', marginBottom: '0.25rem', fontSize: '0.95rem'}}>{linkedAlbum.name}</div>
                  <div style={{color: '#666', marginBottom: '0.25rem', fontSize: '0.9rem'}}>{linkedAlbum.artist}</div>
                  <div style={{fontSize: '0.8rem', color: '#888'}}>
                    {linkedAlbum.releaseDate && `Released: ${linkedAlbum.releaseDate.substring(0, 4)}`}
                    {linkedAlbum.totalTracks && ` • ${linkedAlbum.totalTracks} tracks`}
                  </div>
                </div>
              </div>
              <div style={{marginTop: '0.75rem', display: 'flex', gap: '0.5rem', justifyContent: 'center'}}>
                <button className="btn btn-secondary" onClick={handleUnlink} style={{fontSize: '0.9rem', padding: '0.4rem 0.8rem'}}>
                  <i className="fas fa-unlink"></i> Unlink
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={() => searchForMatches()}
                  disabled={loading}
                  style={{fontSize: '0.9rem', padding: '0.4rem 0.8rem'}}
                >
                  <i className="fas fa-search"></i> Search Again
                </button>
              </div>
            </div>
          )}

          {/* Manual Search Section - Move to top when not linked */}
          {hasSpotifyAuth && !linkedAlbum && (
            <div style={{marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '6px'}}>
              <h4 style={{margin: '0 0 0.75rem 0', fontSize: '1rem'}}>Search Spotify</h4>
              <form onSubmit={handleManualSearch} style={{display: 'flex', gap: '0.5rem', marginBottom: '0.75rem'}}>
                <input
                  type="text"
                  value={manualSearchTerm}
                  onChange={(e) => setManualSearchTerm(e.target.value)}
                  placeholder="e.g. Pink Floyd Dark Side of the Moon"
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '0.9rem'
                  }}
                  disabled={loading}
                />
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={loading || !manualSearchTerm.trim()}
                  style={{fontSize: '0.9rem'}}
                >
                  <i className="fas fa-search"></i> Search
                </button>
              </form>
              <div style={{display: 'flex', gap: '0.5rem', justifyContent: 'center'}}>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => searchForMatches()}
                  disabled={loading}
                  style={{fontSize: '0.85rem', padding: '0.35rem 0.7rem'}}
                >
                  <i className="fas fa-magic"></i> Auto Search
                </button>
                <a 
                  href={`https://open.spotify.com/search/${encodeURIComponent(albumData.Artist + ' ' + albumData['Album/Release'])}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  style={{textDecoration: 'none', fontSize: '0.85rem', padding: '0.35rem 0.7rem'}}
                >
                  <i className="fas fa-external-link-alt"></i> Open Spotify
                </a>
              </div>
            </div>
          )}

          {/* Search Results */}
          {hasSpotifyAuth && !linkedAlbum && (
            <div>
              {searchResults.length > 0 && (
                <div>
                  <h4 style={{marginBottom: '0.75rem', fontSize: '1rem'}}>Select Matching Album</h4>
                  <div style={{marginBottom: '0.75rem', color: '#666', fontSize: '0.85rem'}}>
                    Found {searchResults.length} result{searchResults.length === 1 ? '' : 's'}. Click to link:
                  </div>
                </div>
              )}
              
              {loading && (
                <div style={{textAlign: 'center', padding: '2rem'}}>
                  <i className="fas fa-spinner fa-spin" style={{fontSize: '2rem', color: '#ccc'}}></i>
                  <div style={{marginTop: '0.5rem', color: '#666'}}>Searching Spotify...</div>
                </div>
              )}
              
              {searchResults.length > 0 && (
                <div className="search-results" style={{maxHeight: '400px', overflowY: 'auto'}}>
                  {searchResults.slice(0, 10).map((spotifyAlbum) => (
                    <div 
                      key={spotifyAlbum.id}
                      className="spotify-album-result"
                      style={{
                        display: 'flex',
                        gap: '0.75rem',
                        padding: '0.75rem',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        marginBottom: '0.5rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onClick={() => handleLinkAlbum(spotifyAlbum)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f8f9fa'
                        e.currentTarget.style.borderColor = '#007bff'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'white'
                        e.currentTarget.style.borderColor = '#ddd'
                      }}
                    >
                      {spotifyAlbum.images && spotifyAlbum.images[0] && (
                        <img 
                          src={spotifyAlbum.images[0].url} 
                          alt="Album cover"
                          style={{width: '60px', height: '60px', borderRadius: '4px', flexShrink: 0}}
                        />
                      )}
                      <div style={{flex: 1, minWidth: 0}}>
                        <div style={{fontWeight: 'bold', marginBottom: '0.25rem', fontSize: '0.95rem', lineHeight: '1.2'}}>
                          {spotifyAlbum.name}
                        </div>
                        <div style={{color: '#666', marginBottom: '0.25rem', fontSize: '0.9rem'}}>
                          {spotifyAlbum.artists.map(artist => artist.name).join(', ')}
                        </div>
                        <div style={{fontSize: '0.8rem', color: '#888', marginBottom: '0.25rem'}}>
                          {spotifyAlbum.release_date && `${spotifyAlbum.release_date.substring(0, 4)}`}
                          {spotifyAlbum.total_tracks && ` • ${spotifyAlbum.total_tracks} tracks`}
                        </div>
                        {spotifyAlbum.relevanceScore !== 50 && (
                          <div style={{
                            fontSize: '0.75rem', 
                            color: spotifyAlbum.relevanceScore >= 180 ? '#28a745' : spotifyAlbum.relevanceScore >= 140 ? '#ffc107' : '#dc3545',
                            fontWeight: 'bold'
                          }}>
                            {spotifyAlbum.relevanceScore >= 180 ? '★ Recommended' : spotifyAlbum.relevanceScore >= 140 ? '~ Good Match' : '? Low Match'}
                          </div>
                        )}
                      </div>
                      <div style={{alignSelf: 'center', opacity: 0.5}}>
                        <i className="fas fa-chevron-right" style={{fontSize: '0.8rem'}}></i>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {!loading && searchResults.length === 0 && !message && (
                <div style={{textAlign: 'center', padding: '2rem', color: '#666'}}>
                  <i className="fas fa-search" style={{fontSize: '2rem', marginBottom: '0.5rem'}}></i>
                  <div>Click search to find matching albums on Spotify</div>
                </div>
              )}
              
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AlbumLinkingModal