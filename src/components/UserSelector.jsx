import React, { useState, useEffect } from 'react'
import { useAppContext } from '../hooks/useAppContext'
import TransferModal from './TransferModal'

function UserSelector() {
  const { 
    currentUser, 
    users, 
    userData,
    setCurrentUser, 
    createUser,
    deleteUser
  } = useAppContext()
  
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [showTransferModal, setShowTransferModal] = useState(false)

  // Check for Spotify auth callback and auto-open modal
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('spotify_auth') || urlParams.get('spotify_error')) {
      setShowTransferModal(true)
    }
  }, [])

  const toggleDropdown = () => {
    setDropdownOpen(!dropdownOpen)
  }

  const selectUser = (username) => {
    setCurrentUser(username)
    setDropdownOpen(false)
  }

  const handleAddUser = () => {
    setShowAddUser(true)
  }

  const handleCreateUser = (e) => {
    e.preventDefault()
    if (!newUsername.trim()) return
    
    try {
      const isFirstUser = users.length === 0
      createUser(newUsername.trim(), isFirstUser)
      setCurrentUser(newUsername.trim())
      setNewUsername('')
      setShowAddUser(false)
      setDropdownOpen(false)
    } catch (error) {
      alert(`Error creating user: ${error.message}`)
    }
  }

  const handleCancel = () => {
    setNewUsername('')
    setShowAddUser(false)
  }

  const handleTransfer = () => {
    setShowTransferModal(true)
    setDropdownOpen(false)
  }

  const handleDeleteUser = (username, e) => {
    e.stopPropagation() // Prevent selecting the user when clicking delete
    
    if (confirm(`Are you sure you want to delete user "${username}"?`)) {
      try {
        deleteUser(username)
      } catch (error) {
        alert(`Error deleting user: ${error.message}`)
      }
    }
  }

  const isCurrentUserAdmin = currentUser && userData[currentUser]?.isAdmin

  return (
    <div className={`user-selector ${dropdownOpen ? 'active' : ''}`}>
      <div className="user-dropdown" onClick={toggleDropdown}>
        {currentUser || 'Select User'} <i className="fas fa-chevron-down"></i>
      </div>
      
      {dropdownOpen && (
        <div className="user-menu">
          {users.map(username => (
            <div 
              key={username}
              className="user-menu-item"
              onClick={() => selectUser(username)}
              style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}
            >
              <span>{username}</span>
              <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                {isCurrentUserAdmin && username !== currentUser && (
                  <i 
                    className="fas fa-trash" 
                    style={{
                      color: '#dc3545',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      padding: '0.2rem'
                    }}
                    onClick={(e) => handleDeleteUser(username, e)}
                    title={`Delete user ${username}`}
                  ></i>
                )}
                {currentUser === username && <i className="fas fa-check"></i>}
              </div>
            </div>
          ))}
          
          {!showAddUser ? (
            <>
              <div className="user-menu-item add-user" onClick={handleAddUser}>
                <i className="fas fa-plus"></i> Add New User
              </div>
              {currentUser && (
                <div className="user-menu-item" onClick={handleTransfer}>
                  <i className="fas fa-exchange-alt"></i> Transfer Data
                </div>
              )}
            </>
          ) : (
            <form onSubmit={handleCreateUser} style={{padding: '0.75rem 1rem'}}>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username"
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  marginBottom: '0.5rem'
                }}
                autoFocus
              />
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button type="submit" className="btn btn-primary" style={{fontSize: '0.8rem', padding: '0.25rem 0.5rem'}}>
                  Create
                </button>
                <button type="button" className="btn btn-secondary" style={{fontSize: '0.8rem', padding: '0.25rem 0.5rem'}} onClick={handleCancel}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      
      <TransferModal 
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
      />
    </div>
  )
}

export default UserSelector