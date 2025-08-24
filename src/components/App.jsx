import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AppProvider } from '../hooks/useAppContext'
import Navbar from './Navbar'
import CatalogControls from './CatalogControls'
import CatalogView from './CatalogView'
import AlbumDetail from './AlbumDetail'
import StarredTracks from './StarredTracks'

function DynamicHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  
  const getPageTitle = () => {
    if (location.pathname === '/') {
      return 'Catalog View'
    } else if (location.pathname.startsWith('/album/')) {
      return 'Album Details'
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