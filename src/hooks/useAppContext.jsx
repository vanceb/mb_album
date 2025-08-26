import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react'
import { VIEW_MODES } from '../utils/constants'
import storage from '../services/storage'
import api from '../services/api'
import spotifyService from '../services/spotify'
import spotifyDeviceService from '../services/spotifyDevices'
import albumLinkingService from '../services/albumLinking'
import spotifyWebPlayback from '../services/spotifyWebPlayback'
import { hasValidSpotifyAuth, refreshSpotifyToken } from '../utils/spotify'

const AppContext = createContext()

const initialState = {
  // User state
  currentUser: null,
  users: [],
  userData: {},
  
  // Catalog state
  catalog: [],
  catalogLoading: false,
  catalogError: null,
  
  // View state
  viewMode: VIEW_MODES.list,
  selectedArtist: null,
  starredFilter: false,
  searchTerm: '',
  sortBy: 'artist-asc', // Default sort by artist A-Z
  
  // UI state
  loading: false,
  error: null,
  
  // Album linking modal state
  albumLinkingModal: {
    isOpen: false,
    albumData: null,
    catalogBarcode: null
  },
  
  // Spotify state
  spotify: {
    playbackState: null,
    devices: [],
    queue: null,
    isPolling: false,
    lastPollTime: null
  }
}

function appReducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload }
      
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false }
      
    case 'SET_CURRENT_USER':
      return { ...state, currentUser: action.payload }
      
    case 'SET_USERS':
      return { ...state, users: action.payload }
      
    case 'SET_USER_DATA':
      return { ...state, userData: action.payload }
      
    case 'UPDATE_USER_DATA':
      return {
        ...state,
        userData: {
          ...state.userData,
          [action.username]: {
            ...state.userData[action.username],
            ...action.data
          }
        }
      }
      
    case 'SET_CATALOG':
      return { 
        ...state, 
        catalog: action.payload, 
        catalogLoading: false, 
        catalogError: null 
      }
      
    case 'SET_CATALOG_LOADING':
      return { ...state, catalogLoading: action.payload }
      
    case 'SET_CATALOG_ERROR':
      return { 
        ...state, 
        catalogError: action.payload, 
        catalogLoading: false 
      }
      
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload }
      
    case 'SET_SELECTED_ARTIST':
      return { ...state, selectedArtist: action.payload }
      
    case 'SET_STARRED_FILTER':
      return { ...state, starredFilter: action.payload }
      
    case 'SET_SEARCH_TERM':
      return { ...state, searchTerm: action.payload }
      
    case 'SET_SORT_BY':
      return { ...state, sortBy: action.payload }
      
    case 'OPEN_ALBUM_LINKING_MODAL':
      return {
        ...state,
        albumLinkingModal: {
          isOpen: true,
          albumData: action.albumData,
          catalogBarcode: action.catalogBarcode
        }
      }
      
    case 'CLOSE_ALBUM_LINKING_MODAL':
      return {
        ...state,
        albumLinkingModal: {
          isOpen: false,
          albumData: null,
          catalogBarcode: null
        }
      }
      
    case 'SET_SPOTIFY_PLAYBACK':
      return {
        ...state,
        spotify: {
          ...state.spotify,
          playbackState: action.payload,
          lastPollTime: new Date().toISOString()
        }
      }
      
    case 'SET_SPOTIFY_DEVICES':
      return {
        ...state,
        spotify: {
          ...state.spotify,
          devices: action.payload
        }
      }
      
    case 'SET_SPOTIFY_QUEUE':
      return {
        ...state,
        spotify: {
          ...state.spotify,
          queue: action.payload
        }
      }
      
    case 'SET_SPOTIFY_POLLING':
      return {
        ...state,
        spotify: {
          ...state.spotify,
          isPolling: action.payload
        }
      }
      
    default:
      return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const spotifyIntervalRef = React.useRef(null)
  const playbackPollingRef = useRef(null)

  // Initialize app state from localStorage
  useEffect(() => {
    try {
      // Load users and user data
      const users = storage.getUsers()
      const userData = storage.getUserData()
      const currentUser = storage.getCurrentUser()
      
      dispatch({ type: 'SET_USERS', payload: users })
      dispatch({ type: 'SET_USER_DATA', payload: userData })
      
      if (currentUser && users.includes(currentUser)) {
        dispatch({ type: 'SET_CURRENT_USER', payload: currentUser })
      }
      
      // Load view preferences
      const viewMode = storage.getViewMode()
      const selectedArtist = storage.getSelectedArtist()
      const starredFilter = storage.getStarredFilter()
      const sortBy = storage.getItem('mb_album_sort_by', 'artist-asc')
      
      dispatch({ type: 'SET_VIEW_MODE', payload: viewMode })
      dispatch({ type: 'SET_STARRED_FILTER', payload: starredFilter })
      dispatch({ type: 'SET_SORT_BY', payload: sortBy })
      if (selectedArtist) {
        dispatch({ type: 'SET_SELECTED_ARTIST', payload: selectedArtist })
      }
      
      // Load catalog
      loadCatalog()
    } catch (error) {
      console.error('Error initializing app:', error)
      dispatch({ type: 'SET_ERROR', payload: 'Failed to initialize app' })
    }
  }, [])

  // Fetch current playback state from Spotify Web API
  const fetchCurrentPlayback = async (accessToken) => {
    try {
      const [playbackResponse, queueResponse] = await Promise.all([
        fetch('https://api.spotify.com/v1/me/player', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }),
        fetch('https://api.spotify.com/v1/me/player/queue', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
      ])

      if (playbackResponse.ok) {
        const playbackData = await playbackResponse.json()
        console.log('Current playback from Web API:', playbackData)
        dispatch({ type: 'SET_SPOTIFY_PLAYBACK', payload: playbackData })
      } else if (playbackResponse.status === 204) {
        // No active playback
        console.log('No active Spotify playback')
        dispatch({ type: 'SET_SPOTIFY_PLAYBACK', payload: null })
      }

      if (queueResponse.ok) {
        const queueData = await queueResponse.json()
        console.log('Current queue from Web API:', queueData)
        dispatch({ type: 'SET_SPOTIFY_QUEUE', payload: queueData })
      }
    } catch (error) {
      console.error('Error fetching playback state:', error)
    }
  }

  // Start polling for playback updates (for when playing on other devices)
  const startPlaybackPolling = (accessToken) => {
    // Clear any existing polling
    if (playbackPollingRef.current) {
      clearInterval(playbackPollingRef.current)
    }
    
    // Poll every 2 seconds for external device playback
    playbackPollingRef.current = setInterval(async () => {
      try {
        const validUserData = await ensureValidSpotifyAuth()
        if (validUserData) {
          await fetchCurrentPlayback(validUserData.spotifyAuth.access_token)
        }
      } catch (error) {
        console.error('Polling error:', error)
      }
    }, 2000)
  }

  // Initialize Spotify Web Playback SDK when user has Spotify auth
  useEffect(() => {
    const currentUserData = state.userData[state.currentUser]
    const hasSpotifyTokens = currentUserData?.spotifyAuth?.access_token || currentUserData?.spotifyAuth?.refresh_token
    
    console.log('Spotify SDK useEffect triggered:', {
      currentUser: state.currentUser,
      hasAccessToken: !!currentUserData?.spotifyAuth?.access_token,
      hasRefreshToken: !!currentUserData?.spotifyAuth?.refresh_token,
      tokenPreview: currentUserData?.spotifyAuth?.access_token?.substring(0, 20) + '...'
    })
    
    if (hasSpotifyTokens) {
      console.log('Attempting to initialize Spotify Web Playback SDK for user:', state.currentUser)
      
      const initWithValidToken = async () => {
        // First ensure we have a valid token (refresh if needed)
        const validUserData = await ensureValidSpotifyAuth()
        if (!validUserData) {
          console.error('Could not get valid Spotify auth for SDK')
          return
        }
        
        console.log('Got valid token for SDK, initializing player...')
        
        const handlePlayerStateChange = (state) => {
          console.log('Web Playback SDK state change:', state)
          if (state) {
            // Convert Web Playback state to our format
            const playbackState = {
              is_playing: !state.paused,
              progress_ms: state.position,
              item: state.track_window.current_track,
              context: state.context,
              device: { 
                id: spotifyWebPlayback.getDeviceId(),
                name: 'Album Catalog Web Player',
                type: 'Computer'
              }
            }
            
            dispatch({ type: 'SET_SPOTIFY_PLAYBACK', payload: playbackState })
          }
        }

        const handleReady = async (deviceId) => {
          console.log('Web Playback SDK ready, device ID:', deviceId)
          
          // Get current playback state from Web API to initialize the UI
          try {
            const validUserData = await ensureValidSpotifyAuth()
            if (validUserData) {
              await fetchCurrentPlayback(validUserData.spotifyAuth.access_token)
              
              // Start polling for playback state updates from other devices
              startPlaybackPolling(validUserData.spotifyAuth.access_token)
            }
          } catch (error) {
            console.error('Error fetching initial playback state:', error)
          }
        }

        const handleNotReady = (deviceId) => {
          console.log('Web Playback SDK not ready, device ID:', deviceId)
        }

        try {
          await spotifyWebPlayback.initializePlayer(
            validUserData.spotifyAuth.access_token,
            handlePlayerStateChange,
            handleReady,
            handleNotReady
          )
        } catch (error) {
          console.error('Failed to initialize Spotify Web Playback SDK:', error)
        }
      }
      
      initWithValidToken()
    } else {
      console.log('No valid Spotify credentials, disconnecting Web Playback SDK')
      spotifyWebPlayback.disconnect()
      
      // Stop playback polling
      if (playbackPollingRef.current) {
        clearInterval(playbackPollingRef.current)
        playbackPollingRef.current = null
      }
    }
    
    // Cleanup function
    return () => {
      // Don't disconnect on every re-render, only when component unmounts
    }
  }, [state.currentUser])

  const loadCatalog = async () => {
    dispatch({ type: 'SET_CATALOG_LOADING', payload: true })
    try {
      console.log('Loading catalog from API...')
      const catalog = await api.getCatalog()
      console.log('Catalog loaded:', catalog ? catalog.length : 'null', 'items')
      dispatch({ type: 'SET_CATALOG', payload: catalog })
    } catch (error) {
      console.error('Error loading catalog:', error)
      dispatch({ type: 'SET_CATALOG_ERROR', payload: error.message })
    }
  }

  const setCurrentUser = (username) => {
    dispatch({ type: 'SET_CURRENT_USER', payload: username })
    storage.setCurrentUser(username)
  }

  const createUser = (username, isFirstUser = false) => {
    try {
      const userData = storage.createUser(username, isFirstUser)
      
      // Update state
      const users = storage.getUsers()
      const allUserData = storage.getUserData()
      
      dispatch({ type: 'SET_USERS', payload: users })
      dispatch({ type: 'SET_USER_DATA', payload: allUserData })
      
      return userData
    } catch (error) {
      throw error
    }
  }

  const setViewMode = (mode) => {
    dispatch({ type: 'SET_VIEW_MODE', payload: mode })
    storage.setViewMode(mode)
  }

  const setSelectedArtist = (artist) => {
    dispatch({ type: 'SET_SELECTED_ARTIST', payload: artist })
    storage.setSelectedArtist(artist)
  }

  const toggleStarredFilter = () => {
    const newFilterState = !state.starredFilter
    dispatch({ type: 'SET_STARRED_FILTER', payload: newFilterState })
    storage.setStarredFilter(newFilterState)
  }

  const setSearchTerm = (term) => {
    dispatch({ type: 'SET_SEARCH_TERM', payload: term })
  }

  const setSortBy = (sortBy) => {
    dispatch({ type: 'SET_SORT_BY', payload: sortBy })
    storage.setItem('mb_album_sort_by', sortBy)
  }

  const isAlbumStarred = (barcode) => {
    if (!state.currentUser) return false
    return storage.isAlbumStarred(state.currentUser, barcode)
  }

  const toggleAlbumStar = async (barcode) => {
    if (!state.currentUser) return false
    
    try {
      const isStarred = isAlbumStarred(barcode)
      
      if (isStarred) {
        storage.unstarAlbum(state.currentUser, barcode)
      } else {
        storage.starAlbum(state.currentUser, barcode)
      }
      
      // Update state
      const userData = storage.getUserData()
      dispatch({ type: 'SET_USER_DATA', payload: userData })
      
      // Sync to server in background
      const userInfo = userData[state.currentUser]
      if (userInfo && userInfo.syncId) {
        console.log('Syncing to server:', { 
          syncId: userInfo.syncId, 
          starredAlbums: userInfo.starredAlbums,
          action: isStarred ? 'unstar' : 'star',
          barcode 
        })
        api.syncStarredAlbums(userInfo.syncId, userInfo.starredAlbums)
          .then(response => console.log('Sync response:', response))
          .catch(error => console.error('Sync error:', error))
      }
      
      return !isStarred
    } catch (error) {
      console.error('Error toggling album star:', error)
      return false
    }
  }

  const isTrackStarred = (barcode, trackNumber) => {
    if (!state.currentUser) return false
    return storage.isTrackStarred(state.currentUser, barcode, trackNumber)
  }

  const toggleTrackStar = async (barcode, trackNumber) => {
    if (!state.currentUser) return false
    
    try {
      const isStarred = isTrackStarred(barcode, trackNumber)
      
      if (isStarred) {
        storage.unstarTrack(state.currentUser, barcode, trackNumber)
      } else {
        storage.starTrack(state.currentUser, barcode, trackNumber)
      }
      
      // Update state
      const userData = storage.getUserData()
      dispatch({ type: 'SET_USER_DATA', payload: userData })
      
      // Sync to server in background
      const userInfo = userData[state.currentUser]
      if (userInfo && userInfo.syncId) {
        console.log('Syncing tracks to server:', { 
          syncId: userInfo.syncId, 
          starredTracks: userInfo.starredTracks,
          action: isStarred ? 'unstar track' : 'star track',
          barcode,
          trackNumber
        })
        api.syncStarredTracks(userInfo.syncId, userInfo.starredTracks)
          .then(response => console.log('Track sync response:', response))
          .catch(error => console.error('Track sync error:', error))
      }
      
      return !isStarred
    } catch (error) {
      console.error('Error toggling track star:', error)
      return false
    }
  }

  const refreshCatalog = async () => {
    console.log('refreshCatalog called')
    const currentUserData = state.userData[state.currentUser]
    console.log('Current user:', state.currentUser, 'Is admin:', currentUserData?.isAdmin)
    
    if (!currentUserData || !currentUserData.isAdmin) {
      throw new Error('Only admin users can refresh catalog')
    }
    
    dispatch({ type: 'SET_CATALOG_LOADING', payload: true })
    try {
      console.log('Starting catalog refresh...')
      
      // Refresh catalog data from server
      const refreshResponse = await api.refreshCatalog()
      console.log('Catalog refresh response:', refreshResponse)
      
      // Small delay to ensure server has time to rebuild catalog
      console.log('Waiting for server to rebuild catalog...')
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      console.log('Loading refreshed catalog...')
      try {
        await loadCatalog()
        console.log('Catalog refresh completed successfully')
      } catch (catalogError) {
        console.error('ERROR: Failed to load catalog after refresh:', catalogError)
        throw catalogError
      }
      
      // Also sync starred status from server if user has sync ID
      if (currentUserData.syncId) {
        console.log('Syncing starred status from server during catalog refresh...')
        try {
          const albumsResponse = await api.getStarredAlbumsBackup(currentUserData.syncId)
          const tracksResponse = await api.getStarredTracksBackup(currentUserData.syncId)
          
          if (albumsResponse?.data && tracksResponse?.data) {
            // Update user data with server state (server is source of truth)
            const updatedUserData = {
              ...currentUserData,
              starredAlbums: albumsResponse.data.starredAlbums || [],
              starredTracks: tracksResponse.data.starredTracks || {}
            }
            
            // Update storage and state
            storage.updateUserData(state.currentUser, updatedUserData)
            const allUserData = storage.getUserData()
            dispatch({ type: 'SET_USER_DATA', payload: allUserData })
            
            console.log('Starred status synchronized from server')
          }
        } catch (syncError) {
          console.warn('Could not sync starred status during refresh:', syncError.message)
          // Don't fail catalog refresh if sync fails - starred sync is secondary
        }
      }
    } catch (error) {
      console.error('Error refreshing catalog:', error)
      dispatch({ type: 'SET_CATALOG_ERROR', payload: error.message })
      throw error
    }
  }

  const exportUserData = () => {
    if (!state.currentUser) throw new Error('No user selected')
    return storage.exportUserData(state.currentUser)
  }

  const importUserData = (exportData) => {
    const userData = storage.importUserData(exportData)
    
    // Update state
    const users = storage.getUsers()
    const allUserData = storage.getUserData()
    
    dispatch({ type: 'SET_USERS', payload: users })
    dispatch({ type: 'SET_USER_DATA', payload: allUserData })
    
    return userData
  }

  const refreshUserData = () => {
    // Utility function to refresh user data from localStorage
    try {
      const users = storage.getUsers()
      const allUserData = storage.getUserData()
      
      dispatch({ type: 'SET_USERS', payload: users })
      dispatch({ type: 'SET_USER_DATA', payload: allUserData })
    } catch (error) {
      console.error('Error refreshing user data:', error)
    }
  }

  const deleteUser = (username) => {
    const currentUserData = state.userData[state.currentUser]
    if (!currentUserData || !currentUserData.isAdmin) {
      throw new Error('Only admin users can delete other users')
    }
    
    try {
      storage.deleteUser(username)
      
      // Update state
      const users = storage.getUsers()
      const allUserData = storage.getUserData()
      
      dispatch({ type: 'SET_USERS', payload: users })
      dispatch({ type: 'SET_USER_DATA', payload: allUserData })
      
      return true
    } catch (error) {
      throw error
    }
  }

  const openAlbumLinkingModal = (albumData, catalogBarcode) => {
    dispatch({ 
      type: 'OPEN_ALBUM_LINKING_MODAL', 
      albumData, 
      catalogBarcode 
    })
  }

  const closeAlbumLinkingModal = () => {
    dispatch({ type: 'CLOSE_ALBUM_LINKING_MODAL' })
  }

  // Centralized Spotify state management
  const ensureValidSpotifyAuth = async () => {
    const currentUserData = state.userData[state.currentUser]
    
    if (hasValidSpotifyAuth(currentUserData)) {
      return currentUserData
    }
    
    // Try to refresh token
    const auth = currentUserData?.spotifyAuth
    if (!auth || !auth.refresh_token) {
      return null
    }
    
    try {
      console.log('AppContext: Refreshing Spotify token...')
      const refreshedTokens = await refreshSpotifyToken(auth.refresh_token)
      
      const updatedAuth = {
        ...auth,
        access_token: refreshedTokens.access_token,
        expires_at: refreshedTokens.expires_at,
        ...(refreshedTokens.refresh_token && { refresh_token: refreshedTokens.refresh_token })
      }
      
      const updatedUserData = {
        ...currentUserData,
        spotifyAuth: updatedAuth
      }
      
      // Update localStorage and state
      const allUserData = JSON.parse(localStorage.getItem('userData') || '{}')
      allUserData[state.currentUser] = updatedUserData
      localStorage.setItem('userData', JSON.stringify(allUserData))
      refreshUserData()
      
      console.log('AppContext: Token refreshed successfully')
      return updatedUserData
    } catch (error) {
      console.error('AppContext: Failed to refresh token:', error)
      return null
    }
  }

  const updateSpotifyPlayback = async () => {
    // With Web Playback SDK, we get real-time updates via events
    // This function is now mainly for manual refresh if needed
    try {
      const currentState = await spotifyWebPlayback.getCurrentState()
      if (currentState) {
        const playbackState = {
          is_playing: !currentState.paused,
          progress_ms: currentState.position,
          item: currentState.track_window.current_track,
          context: currentState.context,
          device: { 
            id: spotifyWebPlayback.getDeviceId(),
            name: 'Album Catalog Web Player',
            type: 'Computer'
          }
        }
        
        dispatch({ type: 'SET_SPOTIFY_PLAYBACK', payload: playbackState })
        return playbackState
      }
    } catch (error) {
      console.error('Failed to update Spotify playback:', error)
    }
    return null
  }

  const updateSpotifyQueue = async () => {
    const validUserData = await ensureValidSpotifyAuth()
    if (!validUserData) return

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: {
          'Authorization': `Bearer ${validUserData.spotifyAuth.access_token}`
        }
      })
      
      if (response.ok) {
        const queue = await response.json()
        dispatch({ type: 'SET_SPOTIFY_QUEUE', payload: queue })
        return queue
      }
    } catch (error) {
      if (!error.message.includes('403')) {
        console.error('Failed to update Spotify queue:', error)
      }
    }
    return null
  }

  const updateSpotifyDevices = async () => {
    const validUserData = await ensureValidSpotifyAuth()
    if (!validUserData) return

    try {
      const devices = await spotifyService.getDevices(validUserData.spotifyAuth.access_token)
      dispatch({ type: 'SET_SPOTIFY_DEVICES', payload: devices })
      return devices
    } catch (error) {
      console.error('Failed to update Spotify devices:', error)
      return []
    }
  }

  // Removed old polling functions - now using useEffect-based polling

  // Compute starred data for current user
  const starredAlbums = state.currentUser && state.userData[state.currentUser] 
    ? state.userData[state.currentUser].starredAlbums || []
    : []
    
  const starredTracks = state.currentUser && state.userData[state.currentUser]
    ? state.userData[state.currentUser].starredTracks || {}
    : {}

  const value = {
    ...state,
    // Computed values
    starredAlbums,
    starredTracks,
    // Actions
    setCurrentUser,
    createUser,
    setViewMode,
    setSelectedArtist,
    toggleStarredFilter,
    setSearchTerm,
    setSortBy,
    loadCatalog,
    refreshCatalog,
    isAlbumStarred,
    toggleAlbumStar,
    isTrackStarred,
    toggleTrackStar,
    exportUserData,
    importUserData,
    refreshUserData,
    deleteUser,
    openAlbumLinkingModal,
    closeAlbumLinkingModal,
    // Spotify functions
    ensureValidSpotifyAuth,
    updateSpotifyPlayback,
    updateSpotifyQueue,
    updateSpotifyDevices,
    // Web Playback SDK functions
    spotifyWebPlayback
  }

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider')
  }
  return context
}