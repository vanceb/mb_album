// Global Spotify SDK callback setup
// The callback is set up in HTML before the SDK loads

let sdkReadyPromise = null

// Create a promise that resolves when the SDK is ready
export const waitForSpotifySDK = () => {
  if (sdkReadyPromise) {
    return sdkReadyPromise
  }

  sdkReadyPromise = new Promise((resolve) => {
    // Check if SDK is already available
    if (typeof window.Spotify !== 'undefined') {
      console.log('Spotify SDK already available')
      resolve()
      return
    }

    // Listen for the custom event dispatched by the HTML callback
    window.addEventListener('spotifySDKReady', () => {
      console.log('Received SDK ready event')
      resolve()
    }, { once: true })

    console.log('Waiting for Spotify SDK to load...')
  })

  return sdkReadyPromise
}