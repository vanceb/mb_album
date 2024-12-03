import argparse
import musicbrainzngs

import spotipy
from spotipy.oauth2 import SpotifyOAuth
import webbrowser
import http.server
import socketserver
import urllib.parse

from spotify_secret import get_spotify_credentials

class AuthHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Parse the query parameters
        query = urllib.parse.urlparse(self.path).query
        params = dict(urllib.parse.parse_qsl(query))
        
        # Check for authorization code
        if 'code' in params:
            # Store the authorization code 
            self.server.auth_code = params['code']
            
            # Send a response to the browser
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b'Authorization successful! You can close this window.')
        
        elif 'error' in params:
            # Handle potential authorization errors
            self.server.auth_code = params['error']
            self.send_response(400)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b'Authorization failed. Please try again.')

def get_spotify_token(client_id, client_secret, redirect_uri):   
    """
    Perform Spotify OAuth 2.0 Authorization Code Flow
    
    :param client_id: Spotify Developer application client ID
    :param client_secret: Spotify Developer application client secret
    :param redirect_uri: Registered redirect URI for the application
    :return: Authenticated Spotify client
    """
    # Create a local server to handle the redirect
    with socketserver.TCPServer(('localhost', 8888), AuthHandler) as httpd:
        # Set up OAuth manager
        sp_oauth = SpotifyOAuth(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            scope=(
                'user-library-modify '
                'playlist-modify-public '
                'user-read-private '
                'user-read-email'
            )
        )
        
        # Generate authorization URL
        auth_url = sp_oauth.get_authorize_url()
        
        # Open the authorization URL in default web browser
        webbrowser.open(auth_url)
        
        # Start server and wait for authorization response
        httpd.auth_code = None
        print("Waiting for Spotify authorization...")
        while httpd.auth_code is None:
            httpd.handle_request()
        
        # Exchange authorization code for access token
        if httpd.auth_code and 'error' not in httpd.auth_code:
            token_info = sp_oauth.get_access_token(httpd.auth_code)
            return spotipy.Spotify(auth=token_info['access_token'])
        else:
            raise ValueError("Authorization failed")

def lookup_album_by_barcode(barcode):
    print(f"Looking up album by barcode: {barcode}")
    musicbrainzngs.set_useragent("Album_Lookup", "1.0", "vance@axxe.co.uk")
    
    try:
        result = musicbrainzngs.search_releases(barcode=barcode)
        if result['release-list']:
            release = result['release-list'][0]
            title = release['title']
            artist = release['artist-credit'][0]['artist']['name']
            print(f"Found album: {title} by {artist}")
            return title, artist
        else:
            print("No album found for this barcode.")
            return None, None
    except musicbrainzngs.WebServiceError as e:
        print(f"Error looking up album: {e}")
        return None, f"Error: {e}"

def search_album_on_spotify(sp, album_name, artist_name):
    print(f"Searching for album on Spotify: {album_name} by {artist_name}")
    query = f"album:{album_name} artist:{artist_name}"
    result = sp.search(q=query, type='album', limit=1)

    if result['albums']['items']:
        album = result['albums']['items'][0]
        print(f"Found album on Spotify: {album['name']} by {album['artists'][0]['name']}")
        return album['id'], album['name'], album['artists'][0]['name']
    else:
        print("Album not found on Spotify.")
        return None, None, None

def add_album_to_spotify(sp, album_id):
    print(f"Adding album to Spotify 'My Music': {album_id}")


    try:
        sp.current_user_saved_albums_add([album_id])
        print("Album added to 'My Music' on Spotify.")
        return "Album added to 'My Music' on Spotify."
    except spotipy.SpotifyException as e:
        print(f"Error adding album to Spotify: {e}")
        return f"Error: {e}"

def lookup_and_add_album(sp, barcode):
    print(f"Starting lookup and add process for barcode: {barcode}")
    album_name, artist_name = lookup_album_by_barcode(barcode)
    if not album_name or not artist_name:
        return "No album found for this barcode."

    album_id, album_name, artist_name = search_album_on_spotify(sp, album_name, artist_name)
    if album_id:
        return add_album_to_spotify(sp, album_id)
    else:
        return "Album not found on Spotify."

def main():
    print("Starting the program.")
    parser = argparse.ArgumentParser(description="Look up an album by its barcode and add it to Spotify 'My Music'.")
    parser.add_argument('barcode', type=str, help='The barcode of the CD to look up')
    args = parser.parse_args()


    # Wait for the authentication code to be set
    credentials = get_spotify_credentials()
    client_id = credentials['client_id']
    client_secret = credentials['client_secret']
    print("Waiting for Spotify authentication...")
    sp = get_spotify_token(client_id, client_secret, "http://localhost:8888/callback")
    print("Spotify authentication completed.")
    result = lookup_and_add_album(sp, args.barcode)
    print(result)


if __name__ == "__main__":
    main()