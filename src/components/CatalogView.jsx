import React, { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppContext } from '../hooks/useAppContext'
import SpotifyPlayButton from './SpotifyPlayButton'
import '../styles/catalog.css'

function CatalogView() {
  const navigate = useNavigate()
  const { 
    catalog, 
    catalogLoading, 
    catalogError, 
    currentUser,
    userData,
    starredAlbums,
    searchTerm,
    viewMode,
    starredFilter,
    selectedArtist,
    setViewMode,
    setSelectedArtist,
    toggleAlbumStar,
    refreshCatalog
  } = useAppContext()

  // All state is now managed in AppContext

  // Filter and process catalog data
  const processedCatalog = useMemo(() => {
    let filtered = [...catalog]

    // Apply search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      filtered = filtered.filter(album => 
        album.Artist.toLowerCase().includes(search) ||
        album['Album/Release'].toLowerCase().includes(search)
      )
    }

    // Apply star filter
    if (starredFilter) {
      filtered = filtered.filter(album => starredAlbums.includes(album.Barcode))
    }

    // Apply artist filter
    if (selectedArtist && viewMode === 'artist') {
      filtered = filtered.filter(album => album.Artist === selectedArtist)
    }

    // Sort by artist, then by first release date
    filtered.sort((a, b) => {
      const artistCompare = a.Artist.localeCompare(b.Artist)
      if (artistCompare !== 0) return artistCompare
      
      const dateA = a['First Release'] || '9999'
      const dateB = b['First Release'] || '9999'
      return dateA.localeCompare(dateB)
    })

    return filtered
  }, [catalog, searchTerm, starredFilter, selectedArtist, viewMode, starredAlbums])

  // Get artists with album counts for artist view
  const artistsData = useMemo(() => {
    const artists = {}
    catalog.forEach(album => {
      const artist = album.Artist
      if (!artists[artist]) {
        artists[artist] = { name: artist, albums: [] }
      }
      artists[artist].albums.push(album)
    })

    // Sort artists and their albums
    Object.values(artists).forEach(artist => {
      artist.albums.sort((a, b) => {
        const dateA = a['First Release'] || '9999'
        const dateB = b['First Release'] || '9999'
        return dateA.localeCompare(dateB)
      })
    })

    return Object.values(artists).sort((a, b) => a.name.localeCompare(b.name))
  }, [catalog])

  // Cover art helper
  const getCoverUrl = (barcode) => `/static/coverart/${barcode}.jpg`

  if (!currentUser) {
    return (
      <div className="alert alert-warning">
        <h2>Welcome to Album Catalog</h2>
        <p>Please select or create a user to get started.</p>
      </div>
    )
  }

  if (catalogLoading) {
    return (
      <div className="alert alert-info">
        <i className="fas fa-spinner fa-spin"></i> Loading catalog...
      </div>
    )
  }

  if (catalogError) {
    return (
      <div className="alert alert-error">
        <h3>Error loading catalog</h3>
        <p>{catalogError}</p>
        <button onClick={refreshCatalog} className="btn btn-primary">
          <i className="fas fa-refresh"></i> Retry
        </button>
      </div>
    )
  }


  const renderStarIcon = (barcode) => (
    <i 
      className={`${starredAlbums.includes(barcode) ? 'fas text-warning' : 'far text-muted'} fa-star`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggleAlbumStar(barcode)
      }}
      style={{ cursor: 'pointer' }}
    />
  )

  const renderListView = () => {
    const navigateToAlbum = (barcode) => {
      navigate(`/album/${barcode}`)
    }

    return (
      <div className="table-responsive">
        <table className="table table-hover">
          <thead>
            <tr>
              <th style={{ width: '50px' }}></th>
              <th style={{ width: '80px' }}>Cover</th>
              <th>Artist</th>
              <th>Album</th>
              <th>Year</th>
            </tr>
          </thead>
          <tbody>
            {processedCatalog.map(album => (
              <tr 
                key={album.Barcode} 
                className="clickable-row"
                onClick={() => navigateToAlbum(album.Barcode)}
                style={{ cursor: 'pointer' }}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {renderStarIcon(album.Barcode)}
                    <SpotifyPlayButton album={album} size="small" />
                  </div>
                </td>
                <td>
                  <div className="list-view-cover">
                    <img 
                      src={getCoverUrl(album.Barcode)}
                      alt={`${album.Artist} - ${album['Album/Release']}`}
                      onError={(e) => {
                        e.target.style.display = 'none'
                        e.target.nextSibling.style.display = 'flex'
                      }}
                    />
                    <div className="no-cover-placeholder" style={{ display: 'none' }}>
                      <i className="fas fa-music"></i>
                    </div>
                  </div>
                </td>
                <td className="album-text artist">
                  {album.Artist}
                </td>
                <td className="album-text album">
                  {album['Album/Release']}
                </td>
                <td className="text-muted">
                  {album['First Release'] ? album['First Release'].substring(0, 4) : 'Unknown'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderGridView = () => {
    const navigateToAlbum = (barcode) => {
      navigate(`/album/${barcode}`)
    }

    return (
      <div className="album-grid">
        {processedCatalog.map(album => (
          <div 
            key={album.Barcode} 
            className="album-card"
            onClick={() => navigateToAlbum(album.Barcode)}
            style={{ cursor: 'pointer' }}
          >
            <div className="album-cover">
              <img 
                src={getCoverUrl(album.Barcode)}
                alt={`${album.Artist} - ${album['Album/Release']}`}
                onError={(e) => {
                  e.target.style.display = 'none'
                  e.target.nextSibling.style.display = 'flex'
                }}
              />
              <div className="no-cover-placeholder" style={{ display: 'none' }}>
                No Cover Art
              </div>
              <div className="album-overlay-controls" onClick={(e) => e.stopPropagation()}>
                <div className="album-star-overlay">
                  {renderStarIcon(album.Barcode)}
                </div>
                <div className="album-spotify-overlay">
                  <SpotifyPlayButton album={album} size="medium" />
                </div>
              </div>
            </div>
            <div className="album-info">
              <div className="album-title">
                {album['Album/Release']}
              </div>
              <div className="album-artist-year">
                <span className="album-artist">{album.Artist}</span>
                <span className="album-year">
                  {album['First Release'] ? album['First Release'].substring(0, 4) : 'Unknown'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const renderArtistView = () => (
    <div className="artists-container">
      <div className="artists-sidebar">
        <h3>Artists ({artistsData.length})</h3>
        <ul className="artist-list">
          {artistsData.map(artist => (
            <li 
              key={artist.name}
              className={`artist-item ${selectedArtist === artist.name ? 'active' : ''}`}
              onClick={() => setSelectedArtist(selectedArtist === artist.name ? null : artist.name)}
            >
              <span>{artist.name}</span>
              <span className="album-count">{artist.albums.length}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="albums-content">
        {selectedArtist ? (
          <div>
            <div className="albums-header">
              <h2>{selectedArtist}</h2>
              <div className="albums-info">
                {processedCatalog.length} album{processedCatalog.length !== 1 ? 's' : ''} 
                {starredFilter && ' (starred only)'}
              </div>
            </div>
            <div className="albums-grid">
              {processedCatalog.map(album => (
                <div 
                  key={album.Barcode} 
                  className="album-card"
                  onClick={() => navigate(`/album/${album.Barcode}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="album-cover">
                    <img 
                      src={getCoverUrl(album.Barcode)}
                      alt={`${album.Artist} - ${album['Album/Release']}`}
                      onError={(e) => {
                        e.target.style.display = 'none'
                        e.target.nextSibling.style.display = 'flex'
                      }}
                    />
                    <div className="no-cover-placeholder" style={{ display: 'none' }}>
                      No Cover Art
                    </div>
                    <div className="album-overlay-controls" onClick={(e) => e.stopPropagation()}>
                      <div className="album-star-overlay">
                        {renderStarIcon(album.Barcode)}
                      </div>
                      <div className="album-spotify-overlay">
                        <SpotifyPlayButton album={album} size="medium" />
                      </div>
                    </div>
                  </div>
                  <div className="album-info">
                    <div className="album-title">
                      {album['Album/Release']}
                    </div>
                    <div className="album-year">
                      {album['First Release'] ? album['First Release'].substring(0, 4) : 'Unknown'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <i className="fas fa-users"></i>
            <h3>Select an Artist</h3>
            <p>Choose an artist from the sidebar to view their albums.</p>
          </div>
        )}
      </div>
    </div>
  )

  const getFilteredCount = () => {
    let count = processedCatalog.length
    let total = catalog.length
    
    if (starredFilter) {
      return `${count} starred album${count !== 1 ? 's' : ''} of ${total} total`
    } else if (searchTerm) {
      return `${count} album${count !== 1 ? 's' : ''} found of ${total} total`
    } else if (selectedArtist && viewMode === 'artist') {
      return `${count} album${count !== 1 ? 's' : ''} by ${selectedArtist}`
    } else {
      return `${total} album${total !== 1 ? 's' : ''} in catalog`
    }
  }

  return (
    <>
      {processedCatalog.length === 0 ? (
        <div className="empty-state">
          <i className="fas fa-compact-disc"></i>
          <h3>No albums found</h3>
          <p>
            {starredFilter ? "You haven't starred any albums yet." : 
             searchTerm ? "Try adjusting your search terms." :
             "No albums match the current filters."}
          </p>
        </div>
      ) : (
        <>
          {viewMode === 'list' && renderListView()}
          {viewMode === 'grid' && renderGridView()}
          {viewMode === 'artist' && renderArtistView()}
        </>
      )}
    </>
  )
}

export default CatalogView