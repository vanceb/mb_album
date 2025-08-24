import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppContext } from '../hooks/useAppContext'
import api from '../services/api'
import '../styles/starred-tracks.css'

function StarredTracks() {
  const navigate = useNavigate()
  const { 
    catalog, 
    currentUser, 
    starredTracks, 
    toggleTrackStar 
  } = useAppContext()
  const [tracksWithNames, setTracksWithNames] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchTrackNames = async () => {
      setLoading(true)
      const tracks = []
      
      for (const barcode of Object.keys(starredTracks)) {
        const album = catalog.find(a => a.Barcode === barcode)
        if (album && starredTracks[barcode] && starredTracks[barcode].length > 0) {
          try {
            const albumData = await api.getAlbum(barcode)
            const trackList = albumData.tracks || []
            
            starredTracks[barcode].forEach(trackNumber => {
              const trackIndex = parseInt(trackNumber) - 1
              const trackName = trackList[trackIndex] || `Track ${trackNumber}`
              
              tracks.push({
                barcode,
                trackNumber: parseInt(trackNumber),
                trackName,
                albumTitle: album['Album/Release'],
                artist: album.Artist
              })
            })
          } catch (error) {
            console.error(`Failed to fetch album data for ${barcode}:`, error)
            // Fallback to track numbers if API fails
            starredTracks[barcode].forEach(trackNumber => {
              tracks.push({
                barcode,
                trackNumber: parseInt(trackNumber),
                trackName: `Track ${trackNumber}`,
                albumTitle: album['Album/Release'],
                artist: album.Artist
              })
            })
          }
        }
      }
      
      const sortedTracks = tracks.sort((a, b) => {
        if (a.artist !== b.artist) return a.artist.localeCompare(b.artist)
        if (a.albumTitle !== b.albumTitle) return a.albumTitle.localeCompare(b.albumTitle)
        return a.trackNumber - b.trackNumber
      })
      
      setTracksWithNames(sortedTracks)
      setLoading(false)
    }

    fetchTrackNames()
  }, [catalog, starredTracks])

  if (!currentUser) {
    return (
      <div className="container">
        <div className="alert alert-warning">
          <h2>Access Required</h2>
          <p>Please select or create a user to view starred tracks.</p>
          <Link to="/">&larr; Back to Catalog</Link>
        </div>
      </div>
    )
  }

  const starredTracksList = tracksWithNames

  const handleTrackStar = (barcode, trackNumber) => {
    toggleTrackStar(barcode, trackNumber)
  }

  // Get cover art URL with fallback
  const getCoverUrl = (barcode) => `/static/coverart/${barcode}.jpg`

  return (
    <div className="starred-tracks-page">
      <div className="container">
        {loading ? (
          <div className="no-starred-tracks">
            <div className="no-content-message">
              <i className="fas fa-spinner fa-spin fa-3x"></i>
              <h3>Loading track names...</h3>
            </div>
          </div>
        ) : starredTracksList.length === 0 ? (
          <div className="no-starred-tracks">
            <div className="no-content-message">
              <i className="far fa-star fa-3x"></i>
              <h3>No Starred Tracks</h3>
              <p>You haven't starred any tracks yet.</p>
              <Link to="/" className="btn btn-primary">
                <i className="fas fa-music"></i>
                Browse Albums
              </Link>
            </div>
          </div>
        ) : (
          <div className="starred-tracks-list">
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th width="40px"></th>
                    <th width="60px"></th>
                    <th width="45%">Track</th>
                    <th width="25%">Artist</th>
                    <th width="25%">Album</th>
                  </tr>
                </thead>
                <tbody>
                  {starredTracksList.map(track => (
                    <tr key={`${track.barcode}-${track.trackNumber}`}>
                      <td>
                        <button
                          onClick={() => handleTrackStar(track.barcode, track.trackNumber)}
                          className="track-star-button starred"
                          title="Unstar track"
                        >
                          <i className="fas fa-star"></i>
                        </button>
                      </td>
                      <td>
                        <div 
                          className="album-thumbnail-container"
                          onClick={() => navigate(`/album/${track.barcode}`)}
                          title="View album details"
                        >
                          <img 
                            src={getCoverUrl(track.barcode)}
                            alt={`${track.artist} - ${track.albumTitle}`}
                            className="album-thumbnail"
                            onError={(e) => {
                              e.target.style.display = 'none'
                              e.target.nextSibling.style.display = 'flex'
                            }}
                          />
                          <div className="album-thumbnail-placeholder" style={{ display: 'none' }}>
                            <i className="fas fa-music"></i>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="track-info">
                          <div className="track-name">{track.trackName}</div>
                          <div className="track-number">#{track.trackNumber}</div>
                        </div>
                      </td>
                      <td className="artist-cell">{track.artist}</td>
                      <td className="album-cell">{track.albumTitle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default StarredTracks