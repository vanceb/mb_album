import React, { useState } from 'react'
import { useAppContext } from '../hooks/useAppContext'
import UserSelector from './UserSelector'

function Navbar() {
  const { currentUser, userData } = useAppContext()
  const [adminDropdownOpen, setAdminDropdownOpen] = useState(false)
  
  const currentUserData = currentUser ? userData[currentUser] : null
  const isAdmin = currentUserData ? currentUserData.isAdmin : false

  const toggleAdminDropdown = () => {
    setAdminDropdownOpen(!adminDropdownOpen)
  }

  const closeAdminDropdown = () => {
    setAdminDropdownOpen(false)
  }

  return (
    <nav className="navbar">
      <UserSelector />
      
      {isAdmin && (
        <div className={`dropdown ${adminDropdownOpen ? 'active' : ''}`}>
          <div className="dropdown-toggle" onClick={toggleAdminDropdown}>
            <i className="fas fa-cog"></i> Admin
            <i className="fas fa-chevron-down"></i>
          </div>
          <div className="dropdown-menu">
            <a href="/admin" onClick={closeAdminDropdown}>
              <i className="fas fa-qrcode"></i> Scan Barcodes
            </a>
            <a href="/admin/queue" onClick={closeAdminDropdown}>
              <i className="fas fa-cogs"></i> Queue Status
            </a>
            <a href="/admin/missing-coverart" onClick={closeAdminDropdown}>
              <i className="fas fa-image"></i> Missing Cover Art
            </a>
          </div>
        </div>
      )}
    </nav>
  )
}

export default Navbar