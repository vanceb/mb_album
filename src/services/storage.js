import { STORAGE_KEYS, DEFAULT_USER_DATA, generateSyncId } from '../utils/constants'

class StorageService {
  isLocalStorageAvailable() {
    try {
      const test = '__test__'
      localStorage.setItem(test, test)
      localStorage.removeItem(test)
      return true
    } catch {
      return false
    }
  }

  getItem(key, defaultValue = null) {
    if (!this.isLocalStorageAvailable()) return defaultValue
    
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue
    } catch {
      return defaultValue
    }
  }

  setItem(key, value) {
    if (!this.isLocalStorageAvailable()) return false
    
    try {
      localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch {
      return false
    }
  }

  removeItem(key) {
    if (!this.isLocalStorageAvailable()) return false
    
    try {
      localStorage.removeItem(key)
      return true
    } catch {
      return false
    }
  }

  // User management
  getUsers() {
    return this.getItem(STORAGE_KEYS.users, [])
  }

  setUsers(users) {
    return this.setItem(STORAGE_KEYS.users, users)
  }

  getCurrentUser() {
    return this.getItem(STORAGE_KEYS.currentUser)
  }

  setCurrentUser(username) {
    return this.setItem(STORAGE_KEYS.currentUser, username)
  }

  getUserData() {
    return this.getItem(STORAGE_KEYS.userData, {})
  }

  setUserData(userData) {
    return this.setItem(STORAGE_KEYS.userData, userData)
  }

  createUser(username, isAdmin = false) {
    const users = this.getUsers()
    const userData = this.getUserData()
    
    if (users.includes(username)) {
      throw new Error('User already exists')
    }

    // Add to users list
    users.push(username)
    this.setUsers(users)

    // Create user data with sync ID
    userData[username] = {
      ...DEFAULT_USER_DATA,
      isAdmin,
      syncId: generateSyncId()
    }
    this.setUserData(userData)

    return userData[username]
  }

  getUserDataForUser(username) {
    const userData = this.getUserData()
    return userData[username] || null
  }

  updateUserData(username, newData) {
    const userData = this.getUserData()
    if (!userData[username]) {
      throw new Error('User not found')
    }

    userData[username] = { ...userData[username], ...newData }
    this.setUserData(userData)
    return userData[username]
  }

  deleteUser(username) {
    const users = this.getUsers()
    const userData = this.getUserData()
    const currentUser = this.getCurrentUser()
    
    if (!users.includes(username)) {
      throw new Error('User not found')
    }
    
    if (username === currentUser) {
      throw new Error('Cannot delete current user')
    }
    
    // Remove from users list
    const updatedUsers = users.filter(u => u !== username)
    this.setUsers(updatedUsers)
    
    // Remove user data
    delete userData[username]
    this.setUserData(userData)
    
    return true
  }

  // Starring functionality
  isAlbumStarred(username, barcode) {
    const userData = this.getUserDataForUser(username)
    if (!userData) return false
    return userData.starredAlbums.includes(barcode)
  }

  starAlbum(username, barcode) {
    const userData = this.getUserDataForUser(username)
    if (!userData) throw new Error('User not found')
    
    if (!userData.starredAlbums.includes(barcode)) {
      userData.starredAlbums.push(barcode)
      this.updateUserData(username, userData)
    }
  }

  unstarAlbum(username, barcode) {
    const userData = this.getUserDataForUser(username)
    if (!userData) throw new Error('User not found')
    
    userData.starredAlbums = userData.starredAlbums.filter(b => b !== barcode)
    this.updateUserData(username, userData)
  }

  isTrackStarred(username, barcode, trackNumber) {
    const userData = this.getUserDataForUser(username)
    if (!userData) return false
    
    const albumTracks = userData.starredTracks[barcode]
    return albumTracks ? albumTracks.includes(trackNumber.toString()) : false
  }

  starTrack(username, barcode, trackNumber) {
    const userData = this.getUserDataForUser(username)
    if (!userData) throw new Error('User not found')
    
    if (!userData.starredTracks[barcode]) {
      userData.starredTracks[barcode] = []
    }
    
    const trackStr = trackNumber.toString()
    if (!userData.starredTracks[barcode].includes(trackStr)) {
      userData.starredTracks[barcode].push(trackStr)
      this.updateUserData(username, userData)
    }
  }

  unstarTrack(username, barcode, trackNumber) {
    const userData = this.getUserDataForUser(username)
    if (!userData) throw new Error('User not found')
    
    if (userData.starredTracks[barcode]) {
      userData.starredTracks[barcode] = userData.starredTracks[barcode]
        .filter(t => t !== trackNumber.toString())
      
      // Remove empty album entry
      if (userData.starredTracks[barcode].length === 0) {
        delete userData.starredTracks[barcode]
      }
      
      this.updateUserData(username, userData)
    }
  }

  // Export/Import functionality
  exportUserData(username) {
    const userData = this.getUserDataForUser(username)
    if (!userData) throw new Error('User not found')
    
    return {
      username,
      exportDate: new Date().toISOString(),
      ...userData
    }
  }

  importUserData(exportData) {
    const { username, ...userData } = exportData
    
    if (!username) {
      throw new Error('Invalid export data: missing username')
    }

    // Validate data structure
    if (!userData.syncId || !Array.isArray(userData.starredAlbums)) {
      throw new Error('Invalid export data: invalid structure')
    }

    // Create or update user
    const users = this.getUsers()
    if (!users.includes(username)) {
      users.push(username)
      this.setUsers(users)
    }

    const allUserData = this.getUserData()
    allUserData[username] = {
      isAdmin: userData.isAdmin || false,
      starredAlbums: userData.starredAlbums || [],
      starredTracks: userData.starredTracks || {},
      syncId: userData.syncId
    }
    this.setUserData(allUserData)

    return allUserData[username]
  }

  // View state
  getViewMode() {
    return this.getItem(STORAGE_KEYS.viewMode, 'list')
  }

  setViewMode(mode) {
    return this.setItem(STORAGE_KEYS.viewMode, mode)
  }

  getSelectedArtist() {
    return this.getItem(STORAGE_KEYS.selectedArtist)
  }

  setSelectedArtist(artist) {
    return this.setItem(STORAGE_KEYS.selectedArtist, artist)
  }

  getStarredFilter() {
    return this.getItem(STORAGE_KEYS.starredFilter, false)
  }

  setStarredFilter(isFiltered) {
    return this.setItem(STORAGE_KEYS.starredFilter, isFiltered)
  }
}

export default new StorageService()