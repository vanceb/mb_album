import React, { useState, useEffect } from 'react'
import { useAppContext } from '../hooks/useAppContext'
import albumLinkingService from '../services/albumLinking'
import spotifyService from '../services/spotify'
import spotifyDeviceService from '../services/spotifyDevices'
import { hasValidSpotifyAuth, refreshSpotifyToken } from '../utils/spotify'

function SpotifyPlayButton({ album, size = 'medium', style = {} }) {
  const { 
    currentUser, 
    userData, 
    refreshUserData, 
    openAlbumLinkingModal,
    spotify,
    ensureValidSpotifyAuth,
    updateSpotifyPlayback
  } = useAppContext()
  
  const [loading, setLoading] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentPlayback, setCurrentPlayback] = useState(null)

  // Get current user data and check Spotify auth
  const currentUserData = userData[currentUser]
  const hasSpotifyAuth = hasValidSpotifyAuth(currentUserData)
  
  // Check if album is linked (reactive to userData changes)
  const linkedAlbum = React.useMemo(() => {
    if (!currentUser || !userData[currentUser]) return null
    return albumLinkingService.getLinkedAlbum(currentUser, album.Barcode)
  }, [currentUser, userData, album.Barcode])
  
  const isLinked = !!linkedAlbum

  // Use centralized Spotify state instead of individual polling
  useEffect(() => {
    if (isLinked && linkedAlbum && spotify.playbackState) {
      // Check if this specific album is playing based on centralized state
      const isThisAlbumPlaying = spotify.playbackState.is_playing && 
                                spotify.playbackState.context?.uri === linkedAlbum.spotifyUri
      setIsPlaying(isThisAlbumPlaying)
    } else {
      setIsPlaying(false)
    }
  }, [isLinked, linkedAlbum, spotify.playbackState])

  // Debug logging removed to reduce console noise

  // Button sizes
  const sizes = {
    small: { button: '32px', icon: '14px' },
    medium: { button: '40px', icon: '16px' },
    large: { button: '48px', icon: '20px' }
  }
  
  const buttonSize = sizes[size] || sizes.medium

  // Use centralized auth management from AppContext

  const handleClick = async (e) => {
    e.stopPropagation() // Prevent triggering parent click handlers
    
    console.log('SpotifyPlayButton clicked:', {
      currentUser,
      hasSpotifyAuth,
      isLinked,
      isPlaying,
      linkedAlbum: linkedAlbum ? linkedAlbum.name : null
    })
    
    if (!currentUser) {
      alert('Please select a user first')
      return
    }

    setLoading(true)
    
    // Ensure we have valid auth before proceeding
    const activeUserData = await ensureValidSpotifyAuth()
    if (!activeUserData) {
      alert('Please connect your Spotify account in the Transfer Data modal first')
      setLoading(false)
      return
    }
    
    try {
      if (isLinked) {
        // Album is linked - toggle play/pause
        if (isPlaying) {
          await pausePlayback(activeUserData)
        } else {
          await playLinkedAlbum(activeUserData)
        }
      } else {
        // Album not linked - search and link
        await searchAndLinkAlbum(activeUserData)
      }
    } catch (error) {
      console.error('Spotify action error:', error)
      alert(`Error: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const pausePlayback = async (userDataToUse = currentUserData) => {
    try {
      console.log('pausePlayback called with token:', userDataToUse?.spotifyAuth?.access_token?.substring(0, 20) + '...')
      await spotifyService.pausePlayback(userDataToUse.spotifyAuth.access_token)
      setIsPlaying(false)
      showTemporaryTooltip('Paused')
      
      // Update centralized playback state
      setTimeout(updateSpotifyPlayback, 500)
    } catch (error) {
      console.error('Pause error:', error)
      throw new Error(`Failed to pause: ${error.message}`)
    }
  }

  const playLinkedAlbum = async (userDataToUse = currentUserData) => {
    try {
      console.log('playLinkedAlbum called with:', {
        linkedAlbum: linkedAlbum ? linkedAlbum.spotifyUri : null,
        currentUser,
        hasToken: !!userDataToUse?.spotifyAuth?.access_token,
        tokenPreview: userDataToUse?.spotifyAuth?.access_token?.substring(0, 20) + '...'
      })
      
      // Get the best device to use
      const bestDevice = await spotifyDeviceService.getBestPlaybackDevice(
        currentUser, 
        userDataToUse.spotifyAuth.access_token
      )
      
      console.log('Playing on device:', bestDevice.name, bestDevice.type)
      
      // Play the album
      await spotifyService.playAlbum(
        linkedAlbum.spotifyUri,
        bestDevice.id,
        userDataToUse.spotifyAuth.access_token
      )
      
      // Show success feedback and update state
      setIsPlaying(true)
      showTemporaryTooltip(`Playing on ${bestDevice.name}`)
      
      // Update centralized playback state
      setTimeout(updateSpotifyPlayback, 500)
      
    } catch (error) {
      console.error('Playback error:', error)
      throw new Error(`Playback failed: ${error.message}`)
    }
  }

  const searchAndLinkAlbum = async (userDataToUse = currentUserData) => {
    try {
      console.log('searchAndLinkAlbum called with token:', userDataToUse?.spotifyAuth?.access_token?.substring(0, 20) + '...')
      // Attempt auto-link first
      const result = await albumLinkingService.autoLinkAlbum(
        currentUser,
        album.Barcode,
        album,
        userDataToUse.spotifyAuth.access_token
      )
      
      if (result.success && result.confidence === 'high') {
        // Auto-linked successfully, update UI and play
        refreshUserData()
        showTemporaryTooltip('Linked to Spotify!')
        
        // Force re-render by updating loading state
        setLoading(true)
        setTimeout(() => setLoading(false), 100)
        
        // Wait a moment for UI to update, then play
        setTimeout(async () => {
          try {
            const newLinkedAlbum = albumLinkingService.getLinkedAlbum(currentUser, album.Barcode)
            if (newLinkedAlbum) {
              const bestDevice = await spotifyDeviceService.getBestPlaybackDevice(
                currentUser, 
                userDataToUse.spotifyAuth.access_token
              )
              
              await spotifyService.playAlbum(
                newLinkedAlbum.spotifyUri,
                bestDevice.id,
                userDataToUse.spotifyAuth.access_token
              )
              setIsPlaying(true)
              showTemporaryTooltip(`Playing on ${bestDevice.name}`)
            } else {
              showTemporaryTooltip('Linked! Click again to play.')
            }
          } catch (playError) {
            console.error('Auto-play after linking failed:', playError)
            showTemporaryTooltip('Linked! Click again to play.')
          }
        }, 500)
        
      } else {
        // Show manual selection modal for low confidence, multiple matches, or no matches
        console.log('Opening manual selection modal:', result)
        const message = result.confidence === 'none' ? 
          'No matches found - try manual search' : 
          'Multiple matches found - select manually'
        
        showTemporaryTooltip(message)
        
        // Small delay to show message before opening modal
        setTimeout(() => {
          openAlbumLinkingModal(album, album.Barcode)
        }, 1000)
      }
    } catch (error) {
      console.error('Search and link error:', error)
      throw error
    }
  }

  const handleRightClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (isLinked) {
      // Show context menu for linked albums
      if (confirm(`Unlink "${album['Album/Release']}" from Spotify?`)) {
        albumLinkingService.unlinkAlbum(currentUser, album.Barcode)
        refreshUserData()
        showTemporaryTooltip('Unlinked from Spotify')
      }
    }
  }

  const showTemporaryTooltip = (message) => {
    setShowTooltip(message)
    setTimeout(() => setShowTooltip(false), 2000)
  }

  const getButtonColor = () => {
    if (loading) return '#666'
    if (isLinked) return '#1db954' // Spotify green
    return '#dc3545' // Red for unlinked
  }

  const getTooltipText = () => {
    if (showTooltip && typeof showTooltip === 'string') return showTooltip
    if (loading) return 'Loading...'
    if (!hasSpotifyAuth) return 'Connect Spotify first'
    if (isLinked) {
      if (isPlaying) return `Pause "${linkedAlbum.name}"`
      return `Play "${linkedAlbum.name}" on Spotify`
    }
    return 'Link to Spotify and play'
  }

  return (
    <div
      className="spotify-play-button-container"
      style={{
        position: 'relative',
        display: 'inline-block',
        ...style
      }}
      onMouseEnter={() => !showTooltip && setShowTooltip(true)}
      onMouseLeave={() => typeof showTooltip === 'boolean' && setShowTooltip(false)}
    >
      <button
        className="spotify-play-button"
        onClick={handleClick}
        onContextMenu={handleRightClick}
        disabled={loading || (!hasSpotifyAuth && !currentUserData?.spotifyAuth?.refresh_token)}
        style={{
          width: buttonSize.button,
          height: buttonSize.button,
          borderRadius: '50%',
          border: 'none',
          backgroundColor: `${getButtonColor()}80`, // 50% alpha
          color: 'white',
          cursor: loading ? 'default' : (loading || (!hasSpotifyAuth && !currentUserData?.spotifyAuth?.refresh_token)) ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          fontSize: buttonSize.icon,
          opacity: hasSpotifyAuth ? 1 : 0.5,
          position: 'relative',
          zIndex: 1000
        }}
      >
        {loading ? (
          <i className="fas fa-spinner fa-spin"></i>
        ) : isLinked ? (
          isPlaying ? <i className="fas fa-pause"></i> : <i className="fas fa-play"></i>
        ) : (
          <i className="fas fa-link"></i>
        )}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div
          className="spotify-button-tooltip"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            padding: '6px 10px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            borderRadius: '4px',
            fontSize: '12px',
            whiteSpace: 'nowrap',
            zIndex: 1000,
            pointerEvents: 'none'
          }}
        >
          {getTooltipText()}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '4px solid rgba(0, 0, 0, 0.8)'
            }}
          />
        </div>
      )}
    </div>
  )
}

export default SpotifyPlayButton