import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../hooks/useAppContext'
import albumLinkingService from '../services/albumLinking'
import spotifyService from '../services/spotify'
import spotifyDeviceService from '../services/spotifyDevices'
import { hasValidSpotifyAuth, refreshSpotifyToken } from '../utils/spotify'

function SpotifyPlayerBar() {
  const { 
    currentUser, 
    userData, 
    refreshUserData, 
    spotify,
    ensureValidSpotifyAuth,
    updateSpotifyPlayback,
    updateSpotifyQueue,
    updateSpotifyDevices,
    spotifyWebPlayback
  } = useAppContext()
  const navigate = useNavigate()
  const [devices, setDevices] = useState([])
  const [showDeviceMenu, setShowDeviceMenu] = useState(false)
  const [showQueue, setShowQueue] = useState(false)
  const [loading, setLoading] = useState(false)
  const [linkedBarcode, setLinkedBarcode] = useState(null)

  // Get current user data and check Spotify auth
  const currentUserData = userData[currentUser]
  const hasSpotifyAuth = hasValidSpotifyAuth(currentUserData)
  const hasRefreshToken = !!currentUserData?.spotifyAuth?.refresh_token
  const isVisible = (hasSpotifyAuth || hasRefreshToken)

  // Use centralized auth management

  // Find catalog album that matches current Spotify playback
  const findMatchingCatalogAlbum = (spotifyAlbumUri) => {
    if (!currentUser || !spotifyAlbumUri) return null
    
    // Get all linked albums for current user
    const linkedAlbums = albumLinkingService.getAllLinkedAlbums(currentUser)
    
    // Find catalog barcode that matches this Spotify URI
    for (const [barcode, linkedData] of Object.entries(linkedAlbums)) {
      if (linkedData.spotifyUri === spotifyAlbumUri) {
        return barcode
      }
    }
    
    return null
  }

  // Update linked barcode when centralized playback state changes
  useEffect(() => {
    if (spotify.playbackState?.context?.uri) {
      const barcode = findMatchingCatalogAlbum(spotify.playbackState.context.uri)
      setLinkedBarcode(barcode)
    } else {
      setLinkedBarcode(null)
    }
  }, [spotify.playbackState, currentUser])

  // Update queue when requested
  const fetchQueue = async () => {
    if (spotify.queue) return // Use centralized queue if available
    await updateSpotifyQueue()
  }

  // Load devices when device menu is opened
  const loadDevices = async () => {
    try {
      const validUserData = await ensureValidSpotifyAuth()
      if (!validUserData) return

      const deviceList = await spotifyService.getDevices(validUserData.spotifyAuth.access_token)
      const preferredDevice = spotifyDeviceService.getPreferredDevice(currentUser)
      const formattedDevices = spotifyDeviceService.formatDevicesForDisplay(
        deviceList, 
        preferredDevice?.id
      )
      setDevices(formattedDevices)
    } catch (error) {
      console.error('Error loading devices:', error)
    }
  }

  const handlePlayPause = async () => {
    if (loading) return

    setLoading(true)
    try {
      const validUserData = await ensureValidSpotifyAuth()
      if (!validUserData) {
        console.error('No valid Spotify auth for playback control')
        return
      }

      const webPlaybackDeviceId = spotifyWebPlayback.getDeviceId()
      const currentDeviceId = spotify.playbackState?.device?.id
      const isPlayingOnWebPlayback = currentDeviceId === webPlaybackDeviceId

      if (isPlayingOnWebPlayback) {
        // Use Web Playback SDK when playing on this device
        await spotifyWebPlayback.togglePlay()
      } else {
        // Use Web API when playing on external devices (Echo, phone, etc.)
        const endpoint = spotify.playbackState?.is_playing ? 'pause' : 'play'
        const response = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${validUserData.spotifyAuth.access_token}`,
            'Content-Type': 'application/json'
          }
        })
        
        if (!response.ok && response.status !== 204) {
          throw new Error(`Failed to ${endpoint} playback: ${response.status}`)
        }
        
        console.log(`Successfully ${endpoint === 'play' ? 'resumed' : 'paused'} playback on external device`)
      }
    } catch (error) {
      console.error('Play/pause error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDeviceSelect = async (deviceId, deviceName, deviceType) => {
    if (loading) return

    setLoading(true)
    try {
      const validUserData = await ensureValidSpotifyAuth()
      if (!validUserData) return

      await spotifyDeviceService.transferPlayback(
        deviceId,
        validUserData.spotifyAuth.access_token,
        spotify.playbackState?.is_playing || false
      )
      
      // Update preferred device
      spotifyDeviceService.setPreferredDevice(currentUser, deviceId, deviceName, deviceType)
      
      setShowDeviceMenu(false)
      
      // Refresh devices to update active status
      setTimeout(loadDevices, 500)
    } catch (error) {
      console.error('Device transfer error:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (ms) => {
    if (!ms) return '0:00'
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const handleProgressClick = async (e) => {
    if (!spotify.playbackState?.item?.duration_ms || loading) return

    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const progressPercent = clickX / rect.width
    const seekPosition = Math.floor(progressPercent * spotify.playbackState.item.duration_ms)

    setLoading(true)
    try {
      const validUserData = await ensureValidSpotifyAuth()
      if (!validUserData) {
        console.error('No valid Spotify auth for seek')
        return
      }

      const webPlaybackDeviceId = spotifyWebPlayback.getDeviceId()
      const currentDeviceId = spotify.playbackState?.device?.id
      const isPlayingOnWebPlayback = currentDeviceId === webPlaybackDeviceId

      if (isPlayingOnWebPlayback) {
        // Use Web Playback SDK when playing on this device
        await spotifyWebPlayback.seek(seekPosition)
      } else {
        // Use Web API when playing on external devices
        const response = await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${seekPosition}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${validUserData.spotifyAuth.access_token}`
          }
        })
        
        if (!response.ok && response.status !== 204) {
          throw new Error(`Failed to seek to position: ${response.status}`)
        }
        
        console.log(`Successfully seeked to ${Math.floor(seekPosition / 1000)}s on external device`)
      }
    } catch (error) {
      console.error('Seek error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleNext = async () => {
    if (loading) return
    setLoading(true)
    try {
      const validUserData = await ensureValidSpotifyAuth()
      if (!validUserData) {
        console.error('No valid Spotify auth for next track')
        return
      }

      const webPlaybackDeviceId = spotifyWebPlayback.getDeviceId()
      const currentDeviceId = spotify.playbackState?.device?.id
      const isPlayingOnWebPlayback = currentDeviceId === webPlaybackDeviceId

      if (isPlayingOnWebPlayback) {
        // Use Web Playback SDK when playing on this device
        await spotifyWebPlayback.nextTrack()
      } else {
        // Use Web API when playing on external devices
        const response = await fetch('https://api.spotify.com/v1/me/player/next', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${validUserData.spotifyAuth.access_token}`
          }
        })
        
        if (!response.ok && response.status !== 204) {
          throw new Error(`Failed to skip to next track: ${response.status}`)
        }
        
        console.log('Successfully skipped to next track on external device')
      }
    } catch (error) {
      console.error('Next track error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePrevious = async () => {
    if (loading) return
    setLoading(true)
    try {
      const validUserData = await ensureValidSpotifyAuth()
      if (!validUserData) {
        console.error('No valid Spotify auth for previous track')
        return
      }

      const webPlaybackDeviceId = spotifyWebPlayback.getDeviceId()
      const currentDeviceId = spotify.playbackState?.device?.id
      const isPlayingOnWebPlayback = currentDeviceId === webPlaybackDeviceId

      if (isPlayingOnWebPlayback) {
        // Use Web Playback SDK when playing on this device
        await spotifyWebPlayback.previousTrack()
      } else {
        // Use Web API when playing on external devices
        const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${validUserData.spotifyAuth.access_token}`
          }
        })
        
        if (!response.ok && response.status !== 204) {
          throw new Error(`Failed to skip to previous track: ${response.status}`)
        }
        
        console.log('Successfully skipped to previous track on external device')
      }
    } catch (error) {
      console.error('Previous track error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleTrackInfoClick = () => {
    if (linkedBarcode) {
      navigate(`/album/${linkedBarcode}`)
    }
  }

  const handleQueueToggle = async () => {
    const newShowQueue = !showQueue
    setShowQueue(newShowQueue)
    
    // Fetch queue data immediately when opening
    if (newShowQueue) {
      await fetchQueue()
    }
  }

  if (!isVisible) return null

  const track = spotify.playbackState?.item
  const progress = spotify.playbackState?.progress_ms || 0
  const duration = track?.duration_ms || 0
  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0

  return (
    <>
      {/* Spacer to prevent content from being hidden behind fixed bar and queue */}
      <div style={{ height: showQueue ? '320px' : '80px', transition: 'height 0.3s ease' }} />
      
      {/* Queue Panel */}
      {showQueue && (
        <div style={{
          position: 'fixed',
          bottom: '80px',
          left: 0,
          right: 0,
          height: '240px',
          backgroundColor: '#181818',
          color: 'white',
          borderTop: '1px solid #282828',
          zIndex: 999,
          display: 'flex',
          flexDirection: 'column'
        }}>
          
          {/* Queue Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #282828',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <i className="fas fa-list" style={{ color: '#1db954' }}></i>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>Up Next</h3>
            <div style={{ fontSize: '12px', color: '#b3b3b3' }}>
              {(() => {
                const upcomingTracks = spotify.queue?.queue?.filter(track => track.id !== spotify.playbackState?.item?.id) || []
                return upcomingTracks.length ? 
                  `Showing ${Math.min(upcomingTracks.length, 10)} of ${upcomingTracks.length} upcoming tracks` : 
                  'No upcoming songs'
              })()}
            </div>
          </div>

          {/* Currently Playing */}
          {spotify.playbackState?.item && (
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #282828',
              backgroundColor: 'rgba(29, 185, 84, 0.15)'
            }}>
              <div style={{ fontSize: '12px', color: '#1db954', fontWeight: 'bold', marginBottom: '8px' }}>
                NOW PLAYING
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                {spotify.playbackState.item.album?.images?.[0] && (
                  <img
                    src={spotify.playbackState.item.album.images[0].url}
                    alt="Album cover"
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '4px'
                    }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: 'bold',
                    color: '#1db954',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {spotify.playbackState.item.name}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: '#b3b3b3',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {spotify.playbackState.item.artists?.map(artist => artist.name).join(', ')}
                  </div>
                </div>
                <i className="fas fa-volume-up" style={{ color: '#1db954', fontSize: '12px' }}></i>
              </div>
            </div>
          )}

          {/* Queue Content */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px'
          }}>
            {spotify.queue?.queue?.length > 0 ? (
              spotify.queue.queue
                .filter(track => track.id !== spotify.playbackState?.item?.id) // Remove currently playing track
                .slice(0, 10)
                .map((track, index) => {
                  // These are all upcoming tracks, none should be highlighted as currently playing
                  const isCurrentTrack = false
                
                return (
                  <div
                    key={`${track.id}-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                      backgroundColor: isCurrentTrack ? 'rgba(29, 185, 84, 0.1)' : 'transparent',
                      borderLeft: isCurrentTrack ? '3px solid #1db954' : '3px solid transparent'
                    }}
                    onMouseEnter={e => {
                      if (!isCurrentTrack) e.currentTarget.style.backgroundColor = '#282828'
                    }}
                    onMouseLeave={e => {
                      if (!isCurrentTrack) e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                  
                  {/* Track Number */}
                  <div style={{
                    width: '20px',
                    fontSize: '12px',
                    color: isCurrentTrack ? '#1db954' : '#b3b3b3',
                    textAlign: 'center',
                    fontWeight: isCurrentTrack ? 'bold' : 'normal'
                  }}>
                    {isCurrentTrack ? (
                      <i className="fas fa-volume-up" style={{ fontSize: '10px' }}></i>
                    ) : (
                      index + 1
                    )}
                  </div>

                  {/* Album Cover */}
                  {track.album?.images?.[0] && (
                    <img
                      src={track.album.images[0].url}
                      alt="Album cover"
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '2px',
                        flexShrink: 0
                      }}
                    />
                  )}

                  {/* Track Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: isCurrentTrack ? 'bold' : 'normal',
                      color: isCurrentTrack ? '#1db954' : 'white',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginBottom: '2px'
                    }}>
                      {track.name}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: '#b3b3b3',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {track.artists?.map(artist => artist.name).join(', ')}
                    </div>
                  </div>

                  {/* Duration */}
                  <div style={{
                    fontSize: '11px',
                    color: '#b3b3b3',
                    minWidth: '40px',
                    textAlign: 'right'
                  }}>
                    {formatTime(track.duration_ms)}
                  </div>
                </div>
                  )
                })
              ) : (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#b3b3b3',
                fontSize: '13px'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <i className="fas fa-music" style={{ fontSize: '24px', marginBottom: '8px' }}></i>
                  <div>No songs in queue</div>
                  <div style={{ fontSize: '11px', marginTop: '4px' }}>
                    Songs you add will appear here
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Player Bar */}
      <div className="spotify-player-bar" style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#181818',
        color: 'white',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        zIndex: 1000,
        borderTop: '1px solid #282828'
      }}>
        
        {/* Track Info */}
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px', 
            minWidth: '240px',
            cursor: linkedBarcode ? 'pointer' : 'default',
            padding: '4px',
            borderRadius: '4px',
            transition: 'background-color 0.2s'
          }}
          onClick={handleTrackInfoClick}
          onMouseEnter={e => {
            if (linkedBarcode) {
              e.currentTarget.style.backgroundColor = '#282828'
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
          title={linkedBarcode ? 'Click to view album in catalog' : 'Album not in your catalog'}
        >
          {track?.album?.images?.[0] && (
            <img 
              src={track.album.images[0].url}
              alt="Album cover"
              style={{ 
                width: '56px', 
                height: '56px', 
                borderRadius: '4px',
                border: linkedBarcode ? '2px solid #1db954' : '2px solid transparent',
                transition: 'border-color 0.2s'
              }}
            />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ 
              fontWeight: 'bold', 
              fontSize: '14px', 
              whiteSpace: 'nowrap', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis',
              marginBottom: '2px',
              color: linkedBarcode ? 'white' : '#b3b3b3'
            }}>
              {track?.name || 'No track playing'}
              {linkedBarcode && (
                <i className="fas fa-external-link-alt" style={{ 
                  marginLeft: '8px', 
                  fontSize: '10px', 
                  opacity: 0.7 
                }}></i>
              )}
            </div>
            <div style={{ 
              fontSize: '12px', 
              color: '#b3b3b3',
              whiteSpace: 'nowrap', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis'
            }}>
              {track?.artists?.map(artist => artist.name).join(', ') || 'Unknown artist'}
              {linkedBarcode && (
                <span style={{ color: '#1db954', marginLeft: '8px', fontSize: '10px' }}>
                  • In your catalog
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Player Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, maxWidth: '600px' }}>
          
          {/* Control Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
            <button
              onClick={handlePrevious}
              disabled={loading}
              style={{
                background: 'none',
                border: 'none',
                color: '#b3b3b3',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '8px'
              }}
              onMouseEnter={e => e.target.style.color = 'white'}
              onMouseLeave={e => e.target.style.color = '#b3b3b3'}
            >
              <i className="fas fa-step-backward"></i>
            </button>
            
            <button
              onClick={handlePlayPause}
              disabled={loading}
              style={{
                background: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '14px',
                color: '#181818'
              }}
            >
              {loading ? (
                <i className="fas fa-spinner fa-spin"></i>
              ) : spotify.playbackState?.is_playing ? (
                <i className="fas fa-pause"></i>
              ) : (
                <i className="fas fa-play"></i>
              )}
            </button>
            
            <button
              onClick={handleNext}
              disabled={loading}
              style={{
                background: 'none',
                border: 'none',
                color: '#b3b3b3',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '8px'
              }}
              onMouseEnter={e => e.target.style.color = 'white'}
              onMouseLeave={e => e.target.style.color = '#b3b3b3'}
            >
              <i className="fas fa-step-forward"></i>
            </button>
          </div>

          {/* Progress Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
            <span style={{ fontSize: '11px', color: '#b3b3b3', minWidth: '40px', textAlign: 'right' }}>
              {formatTime(progress)}
            </span>
            <div 
              style={{ 
                flex: 1, 
                height: '4px', 
                backgroundColor: '#4f4f4f', 
                borderRadius: '2px',
                cursor: 'pointer',
                position: 'relative'
              }}
              onClick={handleProgressClick}
            >
              <div 
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  backgroundColor: '#1db954',
                  borderRadius: '2px',
                  transition: loading ? 'none' : 'width 0.1s ease'
                }}
              />
            </div>
            <span style={{ fontSize: '11px', color: '#b3b3b3', minWidth: '40px' }}>
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Queue and Device Selection */}
        <div style={{ position: 'relative', minWidth: '200px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
          
          {/* Queue Button */}
          <button
            onClick={handleQueueToggle}
            style={{
              background: 'none',
              border: 'none',
              color: showQueue ? '#1db954' : '#b3b3b3',
              cursor: 'pointer',
              padding: '8px',
              fontSize: '14px',
              borderRadius: '4px'
            }}
            onMouseEnter={e => e.target.style.color = showQueue ? '#1db954' : 'white'}
            onMouseLeave={e => e.target.style.color = showQueue ? '#1db954' : '#b3b3b3'}
            title={showQueue ? 'Hide queue' : 'Show upcoming tracks'}
          >
            <i className="fas fa-list"></i>
          </button>

          {/* Device Selection */}
          <button
            onClick={() => {
              setShowDeviceMenu(!showDeviceMenu)
              if (!showDeviceMenu) loadDevices()
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#b3b3b3',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px',
              fontSize: '12px'
            }}
            onMouseEnter={e => e.target.style.color = 'white'}
            onMouseLeave={e => e.target.style.color = '#b3b3b3'}
          >
            <i className="fas fa-volume-up"></i>
            <span>{spotify.playbackState?.device?.name || 'Select Device'}</span>
            <i className={`fas fa-chevron-${showDeviceMenu ? 'up' : 'down'}`} style={{ fontSize: '10px' }}></i>
          </button>

          {/* Device Menu */}
          {showDeviceMenu && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              right: 0,
              backgroundColor: '#282828',
              border: '1px solid #404040',
              borderRadius: '8px',
              padding: '8px',
              marginBottom: '8px',
              minWidth: '200px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
            }}>
              <div style={{ fontSize: '12px', color: '#b3b3b3', marginBottom: '8px', padding: '0 8px' }}>
                Select a device
              </div>
              {devices.map(device => (
                <button
                  key={device.id}
                  onClick={() => handleDeviceSelect(device.id, device.name, device.type)}
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    color: device.isActive ? '#1db954' : 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}
                  onMouseEnter={e => e.target.style.backgroundColor = '#404040'}
                  onMouseLeave={e => e.target.style.backgroundColor = 'transparent'}
                >
                  <i className={device.icon} style={{ width: '16px', fontSize: '12px' }}></i>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div>{device.displayName}</div>
                    {device.isPreferred && (
                      <div style={{ fontSize: '10px', color: '#b3b3b3' }}>Preferred</div>
                    )}
                  </div>
                  {device.isActive && (
                    <i className="fas fa-volume-up" style={{ fontSize: '10px', color: '#1db954' }}></i>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default SpotifyPlayerBar