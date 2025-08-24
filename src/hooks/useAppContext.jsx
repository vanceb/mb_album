import React, { createContext, useContext, useReducer, useEffect } from 'react'
import { VIEW_MODES } from '../utils/constants'
import storage from '../services/storage'
import api from '../services/api'

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
  
  // UI state
  loading: false,
  error: null
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
      
    default:
      return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState)

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
      
      dispatch({ type: 'SET_VIEW_MODE', payload: viewMode })
      dispatch({ type: 'SET_STARRED_FILTER', payload: starredFilter })
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

  const loadCatalog = async () => {
    dispatch({ type: 'SET_CATALOG_LOADING', payload: true })
    try {
      const catalog = await api.getCatalog()
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
    const currentUserData = state.userData[state.currentUser]
    if (!currentUserData || !currentUserData.isAdmin) {
      throw new Error('Only admin users can refresh catalog')
    }
    
    dispatch({ type: 'SET_CATALOG_LOADING', payload: true })
    try {
      await api.refreshCatalog()
      await loadCatalog()
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
    loadCatalog,
    refreshCatalog,
    isAlbumStarred,
    toggleAlbumStar,
    isTrackStarred,
    toggleTrackStar,
    exportUserData,
    importUserData,
    deleteUser
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