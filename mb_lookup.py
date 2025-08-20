import argparse
import musicbrainzngs
import json
import os
import csv

import spotipy
from spotipy.oauth2 import SpotifyOAuth
import webbrowser
import http.server
import socketserver
import urllib.parse

from spotify_secret import get_spotify_credentials
from version import VERSION

TOKEN_FILE = 'spotify_token.json'

# User agent configuration
REPO_NAME = "musicbrainz-barcode-lookup"
CONTACT = "vance@axxe.co.uk"

def save_token_info(token_info):
    """
    Save the token information to a file.
    
    :param token_info: The token information to save
    """
    with open(TOKEN_FILE, 'w') as file:
        json.dump(token_info, file)

def load_token_info():
    """
    Load the token information from a file.
    
    :return: The token information if it exists, otherwise None
    """
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'r') as file:
            return json.load(file)
    return None

class AuthHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        """
        Handle GET requests to capture the Spotify authorization code.
        """
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
    Perform Spotify OAuth 2.0 Authorization Code Flow to get an access token.
    
    :param client_id: Spotify Developer application client ID
    :param client_secret: Spotify Developer application client secret
    :param redirect_uri: Registered redirect URI for the application
    :return: Authenticated Spotify client
    :raises ValueError: If authorization fails
    """
    token_info = load_token_info()
    
    if token_info:
        sp_oauth = SpotifyOAuth(client_id=client_id, client_secret=client_secret, redirect_uri=redirect_uri)
        if sp_oauth.is_token_expired(token_info):
            token_info = sp_oauth.refresh_access_token(token_info['refresh_token'])
            save_token_info(token_info)
        return spotipy.Spotify(auth=token_info['access_token'])
    
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
            save_token_info(token_info)
            return spotipy.Spotify(auth=token_info['access_token'])
        else:
            raise ValueError("Authorization failed")

def lookup_album_by_barcode(barcode):
    """
    Look up an album by its barcode using the MusicBrainz API.
    
    :param barcode: The barcode of the album to look up
    :return: Tuple containing album title and artist name, or (None, None) if not found
    """
    print(f"Looking up album by barcode: {barcode}")
    musicbrainzngs.set_useragent(REPO_NAME, VERSION, CONTACT)
    
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
    """
    Search for an album on Spotify by album name and artist name.
    
    :param sp: Authenticated Spotify client
    :param album_name: Name of the album to search for
    :param artist_name: Name of the artist of the album
    :return: Tuple containing album ID, album name, and artist name, or (None, None, None) if not found
    """
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
    """
    Add an album to the user's Spotify 'My Music' library.
    
    :param sp: Authenticated Spotify client
    :param album_id: Spotify ID of the album to add
    :return: Success message or error message
    """
    print(f"Adding album to Spotify 'My Music': {album_id}")

    try:
        sp.current_user_saved_albums_add([album_id])
        return "Album added to 'My Music' on Spotify."
    except spotipy.SpotifyException as e:
        print(f"Error adding album to Spotify: {e}")
        return f"Error: {e}"

def lookup_and_add_album(sp, barcode):
    """
    Look up an album by its barcode and add it to the user's Spotify 'My Music' library.
    
    :param sp: Authenticated Spotify client
    :param barcode: The barcode of the album to look up
    :return: Result message indicating success or failure
    """
    print(f"Starting lookup and add process for barcode: {barcode}")
    album_name, artist_name = lookup_album_by_barcode(barcode)
    if not album_name or not artist_name:
        return "No album found for this barcode."

    album_id, album_name, artist_name = search_album_on_spotify(sp, album_name, artist_name)
    if album_id:
        return add_album_to_spotify(sp, album_id)
    else:
        return "Album not found on Spotify."

def lookup_and_append_to_csv(barcode, filename):
    """
    Perform the lookup from barcode to MusicBrainz album and artist, then use the MusicBrainz album and artist
    to lookup a Spotify album. Append the following CSV fields to the file: barcode, MusicBrainz artist, 
    MusicBrainz album, Spotify album ID, Spotify artist, Spotify album.
    
    :param barcode: The barcode of the album to look up
    :param filename: The name of the CSV file to append the results to
    """
    # Perform MusicBrainz lookup
    musicbrainzngs.set_useragent(REPO_NAME, VERSION, CONTACT)
    try:
        result = musicbrainzngs.search_releases(barcode=barcode)
        if result['release-list']:
            release = result['release-list'][0]
            mb_album = release['title']
            mb_artist = release['artist-credit'][0]['artist']['name']
            print(f"Found album on MusicBrainz: {mb_album} by {mb_artist}")
        else:
            print("No album found for this barcode on MusicBrainz.")
            return
    except musicbrainzngs.WebServiceError as e:
        print(f"Error looking up album on MusicBrainz: {e}")
        return

    # Perform Spotify lookup
    credentials = get_spotify_credentials()
    client_id = credentials['client_id']
    client_secret = credentials['client_secret']
    sp = get_spotify_token(client_id, client_secret, "http://localhost:8888/callback")
    
    query = f"album:{mb_album} artist:{mb_artist}"
    result = sp.search(q=query, type='album', limit=1)
    
    if result['albums']['items']:
        album = result['albums']['items'][0]
        spotify_album_id = album['id']
        spotify_album = album['name']
        spotify_artist = album['artists'][0]['name']
        print(f"Found album on Spotify: {spotify_album} by {spotify_artist}")
    else:
        print("Album not found on Spotify.")
        return

    # Append results to CSV file
    with open(filename, 'a', newline='') as csvfile:
        csvwriter = csv.writer(csvfile)
        csvwriter.writerow([barcode, mb_artist, mb_album, spotify_album_id, spotify_artist, spotify_album])
        print(f"Appended results to {filename}")

def main():
    """
    Main function to parse arguments and initiate the album lookup and add process.
    """
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
    result = lookup_and_append_to_csv(args.barcode, 'albums.csv')
#    result = lookup_and_add_album(sp, args.barcode)
    print(result)

if __name__ == "__main__":
    main()