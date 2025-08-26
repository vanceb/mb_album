import React, { useState, useEffect } from 'react'
import { useAppContext } from '../hooks/useAppContext'
import storageService from '../services/storage'
import apiService from '../services/api'
import { getSpotifyAuthUrl, hasValidSpotifyAuth, hasSpotifyConnected } from '../utils/spotify'

function TransferModal({ isOpen, onClose }) {
  const { currentUser, userData, importUserData, exportUserData, refreshUserData } = useAppContext()
  const [activeTab, setActiveTab] = useState('sync')
  const [syncId, setSyncId] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('') // 'success' or 'error'

  // Handle Spotify authentication on mount
  useEffect(() => {
    // Check for Spotify auth data in URL
    const urlParams = new URLSearchParams(window.location.search)
    const spotifyAuthData = urlParams.get('spotify_auth')
    
    if (spotifyAuthData && currentUser) {
      try {
        const authData = JSON.parse(spotifyAuthData)
        
        // Update current user with Spotify auth data
        const updatedData = {
          ...currentUserData,
          spotifyAuth: authData
        }
        
        storageService.updateUserData(currentUser, updatedData)
        refreshUserData()
        
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname)
        
        // Force a small delay to ensure userData context has updated before showing success
        setTimeout(() => {
          showMessage('Spotify account connected successfully!')
          setActiveTab('spotify')
        }, 100)
        
      } catch (error) {
        console.error('Error processing Spotify auth:', error)
        showMessage('Error connecting Spotify account', 'error')
      }
    }
    
    // Check for Spotify error
    const spotifyError = urlParams.get('spotify_error')
    if (spotifyError) {
      showMessage(`Spotify connection failed: ${spotifyError}`, 'error')
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [currentUser, isOpen])

  if (!isOpen || !currentUser) return null

  // Get current user data (will update when userData context changes)
  const currentUserData = userData[currentUser]
  
  // Check if user is linked to a sync ID
  const isLinkedToSync = currentUserData?.linkedSyncId
  

  const showMessage = (msg, type = 'success') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => {
      setMessage('')
      setMessageType('')
    }, 3000)
  }

  const handleExport = () => {
    try {
      const exportData = exportUserData()
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      
      const a = document.createElement('a')
      a.href = url
      a.download = `${currentUser}_starred_data_${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      showMessage('Export successful! File downloaded.')
    } catch (error) {
      showMessage(`Export failed: ${error.message}`, 'error')
    }
  }

  const handleImport = (event) => {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result)
        
        const importedAlbums = importData.starredAlbums || []
        const importedTracks = importData.starredTracks || {}
        
        
        // Merge with current user's data instead of creating new user
        const currentAlbums = currentUserData.starredAlbums || []
        const currentTracks = currentUserData.starredTracks || {}
        
        // Combine albums (avoid duplicates)
        const mergedAlbums = [...new Set([...currentAlbums, ...importedAlbums])]
        
        // Merge tracks
        const mergedTracks = { ...currentTracks }
        Object.keys(importedTracks).forEach(barcode => {
          if (mergedTracks[barcode]) {
            // Merge track lists, avoid duplicates
            mergedTracks[barcode] = [...new Set([...mergedTracks[barcode], ...importedTracks[barcode]])]
          } else {
            mergedTracks[barcode] = importedTracks[barcode]
          }
        })
        
        // Update current user's data directly
        const updatedData = {
          isAdmin: currentUserData.isAdmin,
          starredAlbums: mergedAlbums,
          starredTracks: mergedTracks,
          syncId: currentUserData.syncId
        }
        
        // Use storage service to update current user
        storageService.updateUserData(currentUser, updatedData)
        
        // Refresh the context to reflect localStorage changes immediately
        refreshUserData()
        
        const newAlbumsCount = mergedAlbums.length - currentAlbums.length
        showMessage(`Import successful! Added ${newAlbumsCount} new starred albums to your collection.`)
        
        // Close modal after showing success message
        setTimeout(() => {
          onClose()
        }, 1500)
        
        // Clear the file input
        event.target.value = ''
      } catch (error) {
        showMessage(`Import failed: ${error.message}`, 'error')
        event.target.value = ''
      }
    }
    reader.readAsText(file)
  }

  const handleUnlink = () => {
    if (confirm('Are you sure you want to unlink from the sync ID? This will not delete your starred data.')) {
      const updatedData = {
        ...currentUserData,
        linkedSyncId: null
      }
      
      storageService.updateUserData(currentUser, updatedData)
      
      // Refresh the context to reflect localStorage changes immediately
      refreshUserData()
      
      showMessage('Successfully unlinked from sync ID.')
      
      // Close modal after showing success message
      setTimeout(() => {
        onClose()
      }, 1500)
    }
  }

  const handleRefreshSync = async () => {
    if (!isLinkedToSync) return
    await handleSyncIdImport(isLinkedToSync)
  }

  const handleSyncIdImport = async (overrideSyncId = null) => {
    const targetSyncId = overrideSyncId || syncId.trim()
    
    if (!targetSyncId) {
      showMessage('Please enter a sync ID', 'error')
      return
    }

    setLoading(true)
    try {
      // Try to get data from server using sync ID
      const albumsResponse = await apiService.getStarredAlbumsBackup(targetSyncId)
      const tracksResponse = await apiService.getStarredTracksBackup(targetSyncId)
      
      if (albumsResponse?.data && tracksResponse?.data && albumsResponse.data.starredAlbums !== undefined) {
        const importedAlbums = albumsResponse.data.starredAlbums || []
        const importedTracks = tracksResponse.data.starredTracks || {}
        
        let finalAlbums, finalTracks
        
        if (overrideSyncId) {
          // For refresh operations - replace with server data (server is source of truth)
          finalAlbums = importedAlbums
          finalTracks = importedTracks
        } else {
          // For initial linking - merge with current user's data
          const currentAlbums = currentUserData?.starredAlbums || []
          const currentTracks = currentUserData?.starredTracks || {}
          
          // Combine albums (avoid duplicates)
          finalAlbums = [...new Set([...currentAlbums, ...importedAlbums])]
          
          // Merge tracks
          finalTracks = { ...currentTracks }
          Object.keys(importedTracks).forEach(barcode => {
            if (finalTracks[barcode]) {
              // Merge track lists, avoid duplicates
              finalTracks[barcode] = [...new Set([...finalTracks[barcode], ...importedTracks[barcode]])]
            } else {
              finalTracks[barcode] = importedTracks[barcode]
            }
          })
        }
        
        // Update current user's data directly using storage service
        const updatedData = {
          isAdmin: currentUserData?.isAdmin || false,
          starredAlbums: finalAlbums,
          starredTracks: finalTracks,
          syncId: targetSyncId, // Always use the sync ID we're linking to
          linkedSyncId: targetSyncId // Track that we're linked to this sync ID
        }
        
        // Use storage service to update current user
        storageService.updateUserData(currentUser, updatedData)
        
        // Refresh the context to reflect localStorage changes immediately
        refreshUserData()
        
        if (overrideSyncId) {
          // For refresh - show server state vs local state comparison
          const currentAlbums = currentUserData?.starredAlbums || []
          showMessage(`Refresh successful! Synchronized ${finalAlbums.length} starred albums from server.`)
        } else {
          // For initial linking - show what was added
          const currentAlbums = currentUserData?.starredAlbums || []
          const newAlbumsCount = finalAlbums.length - currentAlbums.length
          showMessage(`Link successful! Added ${newAlbumsCount} new starred albums and linked to sync ID.`)
          setSyncId('') // Only clear input if not a refresh
        }
        
        // Close modal after showing success message - no page reload needed
        setTimeout(() => {
          onClose()
        }, 1500)
      } else {
        showMessage('No data found for this sync ID', 'error')
      }
    } catch (error) {
      console.error('Sync error:', error)
      showMessage(`Sync failed: ${error.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      showMessage('Sync ID copied to clipboard!')
    }).catch(() => {
      showMessage('Failed to copy to clipboard', 'error')
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Transfer Starred Data</h3>
          <button className="close-btn" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="modal-tabs">
          <button 
            className={`tab ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            Sync Code
          </button>
          <button 
            className={`tab ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => setActiveTab('export')}
          >
            Export
          </button>
          <button 
            className={`tab ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            Import
          </button>
          <button 
            className={`tab ${activeTab === 'spotify' ? 'active' : ''}`}
            onClick={() => setActiveTab('spotify')}
          >
            Spotify
          </button>
        </div>

        <div className="modal-body">
          {message && (
            <div className={`alert ${messageType === 'error' ? 'alert-error' : 'alert-success'}`}>
              {message}
            </div>
          )}

          {activeTab === 'export' && (
            <div className="tab-content">
              <h4>Export Your Data</h4>
              <p>Download your starred albums and tracks as a JSON file.</p>
              <div className="stats">
                <div><strong>{currentUserData.starredAlbums.length}</strong> starred albums</div>
                <div><strong>{Object.keys(currentUserData.starredTracks).length}</strong> albums with starred tracks</div>
              </div>
              <button className="btn btn-primary" onClick={handleExport}>
                <i className="fas fa-download"></i> Download Export File
              </button>
            </div>
          )}

          {activeTab === 'import' && !isLinkedToSync && (
            <div className="tab-content">
              <h4>Import Data</h4>
              <p>Upload a previously exported JSON file to restore starred data.</p>
              <div className="file-input-wrapper">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="file-input"
                />
                <label className="btn btn-secondary">
                  <i className="fas fa-upload"></i> Choose File
                </label>
              </div>
              <div className="import-note">
                <strong>Note:</strong> This will merge the imported data with your current starred collection.
              </div>
            </div>
          )}
          
          {activeTab === 'import' && isLinkedToSync && (
            <div className="tab-content">
              <h4>Import Disabled</h4>
              <p>Import functionality is disabled while linked to a sync ID.</p>
              <div className="sync-note">
                <strong>Currently linked to:</strong> {isLinkedToSync}
              </div>
              <button className="btn btn-secondary" onClick={handleUnlink}>
                <i className="fas fa-unlink"></i> Unlink
              </button>
            </div>
          )}

          {activeTab === 'sync' && (
            <div className="tab-content">
              <h4>Sync Code</h4>
              
              <div className="sync-section">
                <h5>Your Sync ID</h5>
                <p>Share this code with others to let them import your starred data:</p>
                <div className="sync-code-display">
                  <code>{currentUserData?.syncId || 'No sync ID available'}</code>
                  <button 
                    className="copy-btn" 
                    onClick={() => copyToClipboard(currentUserData?.syncId || '')}
                    title="Copy to clipboard"
                    disabled={!currentUserData?.syncId}
                  >
                    <i className="fas fa-copy"></i>
                  </button>
                </div>
                {!currentUserData?.syncId && (
                  <div className="sync-note">
                    <strong>Note:</strong> No sync ID found. Try starring an album first to generate one.
                  </div>
                )}
              </div>

              {!isLinkedToSync && (
                <div className="sync-section">
                  <h5>Link to Sync ID</h5>
                  <p>Enter a sync ID to link this browser to that user's data on the server:</p>
                  <div className="sync-input-group">
                    <input
                      type="text"
                      value={syncId}
                      onChange={(e) => setSyncId(e.target.value)}
                      placeholder="Enter sync ID..."
                      className="sync-input"
                      disabled={loading}
                    />
                    <button 
                      className="btn btn-primary"
                      onClick={() => handleSyncIdImport()}
                      disabled={loading || !syncId.trim()}
                    >
                      {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-link"></i>}
                      {loading ? 'Linking...' : 'Link'}
                    </button>
                  </div>
                  <div className="sync-note">
                    <strong>Note:</strong> This will merge the sync ID's starred data with your current collection and link your browser to that server profile for future syncing.
                  </div>
                </div>
              )}

              {isLinkedToSync && (
                <div className="sync-section">
                  <h5>Linked Sync Control</h5>
                  <p>This browser is linked to sync ID: <strong>{isLinkedToSync}</strong></p>
                  
                  <div style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem'}}>
                    <button 
                      className="btn btn-primary"
                      onClick={handleRefreshSync}
                      disabled={loading}
                    >
                      {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-sync-alt"></i>}
                      {loading ? 'Refreshing...' : 'Refresh from Server'}
                    </button>
                    
                    <button 
                      className="btn btn-secondary"
                      onClick={handleUnlink}
                    >
                      <i className="fas fa-unlink"></i> Unlink
                    </button>
                  </div>
                  
                  <div className="sync-note">
                    <strong>Note:</strong> Your starred changes are automatically synced to the server. Use refresh to pull the latest changes from other browsers.
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'spotify' && (
            <div className="tab-content">
              <h4>Spotify Integration</h4>
              
              {!hasSpotifyConnected(currentUserData) ? (
                <div>
                  <p>Connect your Spotify account to enable album playback and linking features.</p>
                  <div className="sync-note">
                    <strong>Requirements:</strong> You need Spotify Premium for playback control.
                  </div>
                  <button 
                    className="btn btn-primary"
                    onClick={() => window.location.href = getSpotifyAuthUrl()}
                  >
                    <i className="fas fa-spotify"></i> Connect Spotify Account
                  </button>
                </div>
              ) : (
                <div>
                  <div className={hasValidSpotifyAuth(currentUserData) ? "alert-success" : "alert alert-warning"}>
                    <strong>✓ Spotify Connected</strong><br />
                    Account: {currentUserData.spotifyAuth?.display_name || currentUserData.spotifyAuth?.user_id || 'Unknown'}
                    {!hasValidSpotifyAuth(currentUserData) && (
                      <><br /><small>⚠️ Token expired - will refresh automatically when needed</small></>
                    )}
                  </div>
                  
                  {!hasValidSpotifyAuth(currentUserData) && (
                    <div className="sync-note" style={{marginBottom: '1rem'}}>
                      <strong>Note:</strong> To use the new Web Playback features, you'll need to reconnect your Spotify account to get updated permissions.
                    </div>
                  )}
                  
                  <p>Your Spotify account is connected. You can now:</p>
                  <ul style={{margin: '1rem 0', paddingLeft: '1.5rem'}}>
                    <li>Link catalog albums to Spotify albums</li>
                    <li>Play albums and tracks on your devices</li>
                    <li>Control playback from the album views</li>
                    {hasValidSpotifyAuth(currentUserData) && <li>Use real-time Web Playback controls</li>}
                  </ul>
                  
                  <div style={{display: 'flex', gap: '0.5rem', marginTop: '1rem'}}>
                    {!hasValidSpotifyAuth(currentUserData) && (
                      <button 
                        className="btn btn-primary"
                        onClick={() => window.location.href = getSpotifyAuthUrl()}
                      >
                        <i className="fas fa-sync-alt"></i> Reconnect for New Features
                      </button>
                    )}
                    <button 
                      className="btn btn-secondary"
                      onClick={() => {
                        if (confirm('Are you sure you want to disconnect your Spotify account? This will also unlink all Spotify albums.')) {
                          // Disconnect Spotify
                          const updatedData = {
                            ...currentUserData,
                            spotifyAuth: null,
                            linkedAlbums: {}
                          }
                          storageService.updateUserData(currentUser, updatedData)
                          refreshUserData()
                          
                          // Add delay to ensure UI updates
                          setTimeout(() => {
                            showMessage('Spotify account disconnected successfully')
                          }, 100)
                        }
                      }}
                    >
                      <i className="fas fa-unlink"></i> Disconnect
                    </button>
                  </div>
                  
                  <div className="sync-note" style={{marginTop: '1rem'}}>
                    <strong>Linked Albums:</strong> {Object.keys(currentUserData.linkedAlbums || {}).length}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TransferModal