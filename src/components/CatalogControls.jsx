import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppContext } from '../hooks/useAppContext'

function CatalogControls() {
  const location = useLocation()
  const navigate = useNavigate()
  const { 
    catalog, 
    catalogLoading, 
    currentUser,
    userData,
    starredAlbums,
    searchTerm,
    viewMode,
    starredFilter,
    selectedArtist,
    setSearchTerm,
    setViewMode,
    toggleStarredFilter,
    setSelectedArtist,
    refreshCatalog
  } = useAppContext()
  
  // Only show on catalog page
  if (location.pathname !== '/') {
    return null
  }
  
  // Don't show if no user or catalog is loading
  if (!currentUser || catalogLoading) {
    return null
  }

  // Handle star filter toggle
  const handleStarToggle = () => {
    toggleStarredFilter()
    setSelectedArtist(null) // Clear artist selection when filtering by stars
  }

  // Get filtered count for display
  const getFilteredCount = () => {
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

    let count = filtered.length
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
    <div className="catalog-header-controls">
      <div className="catalog-controls-area">
        {/* Search */}
        <input
          type="text"
          placeholder="Search albums..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />

        {/* View mode buttons */}
        <div className="view-controls">
          <button
            onClick={() => setViewMode('list')}
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            title="List View"
          >
            <i className="fas fa-list"></i>
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            title="Album Art View"
          >
            <i className="fas fa-th"></i>
          </button>
          <button
            onClick={() => setViewMode('artist')}
            className={`view-btn ${viewMode === 'artist' ? 'active' : ''}`}
            title="Artist View"
          >
            <i className="fas fa-users"></i>
          </button>
          <button
            onClick={() => navigate('/starred-tracks')}
            className="view-btn"
            title="Starred Tracks"
          >
            <i className="fas fa-music"></i>
          </button>
        </div>

        {/* Star filter */}
        <i 
          className={`${starredFilter ? 'fas' : 'far'} fa-star star-filter-icon`}
          onClick={handleStarToggle}
          title={starredFilter ? 'Show all albums' : 'Show starred albums only'}
        ></i>

        {/* Admin refresh button */}
        {userData[currentUser]?.isAdmin && (
          <button 
            onClick={refreshCatalog}
            disabled={catalogLoading}
            title="Refresh catalog from server"
            className="refresh-btn"
          >
            <i className="fas fa-refresh"></i>
          </button>
        )}
      </div>
    </div>
  )
}

export default CatalogControls