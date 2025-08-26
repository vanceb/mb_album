import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAppContext } from '../hooks/useAppContext'
import SpotifyPlayButton from './SpotifyPlayButton'
import api from '../services/api'
import '../styles/album-detail.css'

function AlbumDetail() {
  const { barcode } = useParams()
  const { 
    currentUser, 
    starredAlbums,
    starredTracks,
    toggleAlbumStar,
    toggleTrackStar
  } = useAppContext()
  
  const [album, setAlbum] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [metadataExpanded, setMetadataExpanded] = useState(false)

  useEffect(() => {
    const loadAlbum = async () => {
      try {
        setLoading(true)
        const data = await api.getAlbum(barcode)
        setAlbum(data)
      } catch (error) {
        console.error('Error loading album:', error)
        setError(error.message)
      } finally {
        setLoading(false)
      }
    }

    if (barcode) {
      loadAlbum()
    }
  }, [barcode])


  // Get cover art URL with fallback
  const getCoverUrl = (barcode) => `/static/coverart/${barcode}.jpg`

  // Check if track is starred
  const isTrackStarred = (trackNumber) => {
    const albumTracks = starredTracks[barcode] || []
    return albumTracks.includes(String(trackNumber))
  }

  // Handle track star toggle
  const handleTrackStar = (trackNumber) => {
    toggleTrackStar(barcode, trackNumber)
  }

  // Handle album star toggle
  const handleAlbumStar = (e) => {
    e.preventDefault()
    e.stopPropagation()
    toggleAlbumStar(barcode)
  }

  if (!currentUser) {
    return (
      <div className="container">
        <div className="alert alert-warning">
          <h2>Access Required</h2>
          <p>Please select or create a user to view album details.</p>
          <Link to="/app">&larr; Back to Catalog</Link>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <i className="fas fa-spinner fa-spin"></i>
          <p>Loading album details...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          <h3>Error loading album</h3>
          <p>{error}</p>
          <Link to="/app">&larr; Back to Catalog</Link>
        </div>
      </div>
    )
  }

  if (!album || !album.album) {
    return (
      <div className="container">
        <div className="error">
          <h3>Album not found</h3>
          <p>The album with barcode {barcode} was not found.</p>
          <Link to="/app">&larr; Back to Catalog</Link>
        </div>
      </div>
    )
  }

  const albumData = album.album
  const tracks = album.tracks || []
  const isAlbumStarred = starredAlbums.includes(barcode)

  const getAlbumYear = () => {
    return albumData['First Release'] ? albumData['First Release'].substring(0, 4) : 'Unknown'
  }

  return (
    <div className="album-page">

      {/* Main Content Area */}
      <div className="album-main-content">
        {/* Left Side - Album Cover */}
        <div className="album-cover-section">
          <div className="album-cover-container">
            <img 
              src={getCoverUrl(barcode)}
              alt={`${albumData.Artist} - ${albumData['Album/Release']}`}
              onError={(e) => {
                e.target.style.display = 'none'
                e.target.nextSibling.style.display = 'flex'
              }}
            />
            <div className="album-cover-placeholder" style={{ display: 'none' }}>
              No Cover Art
            </div>
            
            {/* Control buttons overlay */}
            <div className="album-detail-controls">
              <button
                onClick={handleAlbumStar}
                className={`album-star-overlay ${isAlbumStarred ? 'starred' : ''}`}
                title={isAlbumStarred ? 'Unstar album' : 'Star album'}
              >
                <i className={`${isAlbumStarred ? 'fas' : 'far'} fa-star`}></i>
              </button>
              <SpotifyPlayButton album={albumData} size="large" />
            </div>
          </div>

          {/* Collapsible Album Metadata */}
          <div className="album-metadata-section">
            <button 
              className="metadata-toggle"
              onClick={() => setMetadataExpanded(!metadataExpanded)}
            >
              Album Metadata
              <i className={`fas fa-chevron-${metadataExpanded ? 'up' : 'down'}`}></i>
            </button>
            
            {metadataExpanded && (
              <div className="metadata-content">
                <div className="metadata-grid">
                  <strong>Artist:</strong>
                  <span>{albumData.Artist}</span>
                  
                  <strong>Album:</strong>
                  <span>{albumData['Album/Release']}</span>
                  
                  <strong>First Release:</strong>
                  <span>{albumData['First Release'] || 'Unknown'}</span>
                  
                  {albumData['Release Date'] && albumData['Release Date'] !== albumData['First Release'] && (
                    <>
                      <strong>This Edition:</strong>
                      <span>{albumData['Release Date']}</span>
                    </>
                  )}
                  
                  <strong>Country:</strong>
                  <span>{albumData.Country || 'Unknown'}</span>
                  
                  <strong>Barcode:</strong>
                  <span className="monospace">{albumData.Barcode}</span>
                  
                  {albumData['MusicBrainz ID'] && (
                    <>
                      <strong>MusicBrainz:</strong>
                      <a 
                        href={`https://musicbrainz.org/release/${albumData['MusicBrainz ID']}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View on MusicBrainz <i className="fas fa-external-link-alt"></i>
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side - Track Listing */}
        <div className="track-listing-section">
          {tracks.length > 0 ? (
            <div className="track-list">
              {tracks.map((track, index) => {
                const trackNumber = index + 1
                const starred = isTrackStarred(trackNumber)
                
                return (
                  <div 
                    key={index}
                    className={`track-item ${starred ? 'starred' : ''}`}
                  >
                    <button
                      onClick={() => handleTrackStar(trackNumber)}
                      className={`track-star-button ${starred ? 'starred' : ''}`}
                      title={starred ? `Unstar track ${trackNumber}` : `Star track ${trackNumber}`}
                    >
                      <i className={`${starred ? 'fas' : 'far'} fa-star`}></i>
                    </button>
                    
                    <span className="track-number">
                      {trackNumber}.
                    </span>
                    
                    <span className="track-name">{track}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="no-tracks-state">
              <i className="fas fa-music"></i>
              <h3>No track listing available</h3>
              <p>Track information could not be loaded for this album.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AlbumDetail