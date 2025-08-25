import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AppProvider } from '../hooks/useAppContext'
import Navbar from './Navbar'
import CatalogControls from './CatalogControls'
import CatalogView from './CatalogView'
import AlbumDetail from './AlbumDetail'
import StarredTracks from './StarredTracks'
import api from '../services/api'

function DynamicHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const [albumTitle, setAlbumTitle] = useState(null)
  
  // Extract barcode from album path
  const getBarcode = () => {
    const match = location.pathname.match(/^\/album\/(.+)/)
    return match ? match[1] : null
  }
  
  // Load album data for title when on album page
  useEffect(() => {
    const loadAlbumTitle = async () => {
      const barcode = getBarcode()
      if (barcode) {
        try {
          const albumResponse = await api.getAlbum(barcode)
          if (albumResponse && albumResponse.album) {
            const albumData = albumResponse.album
            // Format: Artist - Album (Year)
            const year = albumData['First Release'] ? albumData['First Release'].substring(0, 4) : ''
            const title = `${albumData.Artist} - ${albumData['Album/Release']}${year ? ` (${year})` : ''}`
            setAlbumTitle(title)
          }
        } catch (error) {
          console.error('Error loading album title:', error)
          setAlbumTitle('Album Details')
        }
      } else {
        setAlbumTitle(null)
      }
    }
    
    loadAlbumTitle()
  }, [location.pathname])
  
  const getPageTitle = () => {
    if (location.pathname === '/') {
      return 'Albums'
    } else if (location.pathname.startsWith('/album/')) {
      return albumTitle || 'Loading...'
    } else if (location.pathname === '/starred-tracks') {
      return 'Starred Tracks'
    }
    return 'Album Catalog'
  }
  
  const showBackButton = () => {
    return location.pathname !== '/'
  }
  
  return (
    <div className="header">
      <div className="header-top">
        <div className="header-title-section">
          {showBackButton() && (
            <button 
              onClick={() => navigate('/')}
              className="header-back-button"
              title="Back to Catalog"
            >
              <i className="fas fa-arrow-left"></i>
            </button>
          )}
          <h1>{getPageTitle()}</h1>
        </div>
        <Navbar />
      </div>
      <CatalogControls />
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <Router basename="/app">
        <DynamicHeader />
        
        <div className="container">
          <Routes>
            <Route path="/" element={<CatalogView />} />
            <Route path="/album/:barcode" element={<AlbumDetail />} />
            <Route path="/starred-tracks" element={<StarredTracks />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Router>
    </AppProvider>
  )
}

export default App