
from __future__ import unicode_literals

import random, string, logging, json, pykka, pylast, urllib, urllib2, os, sys, mopidy_botrock, subprocess
import tornado.web
import tornado.websocket
import tornado.ioloop
import tornado.httpclient
import requests
import time
from mopidy import config, ext
from mopidy.core import CoreListener
from pkg_resources import parse_version
from tornado.escape import json_encode, json_decode
from random import *

if sys.platform == 'win32':
    import ctypes

# import logger
logger = logging.getLogger(__name__)

class BotRockCore(object):

    version = 0
    if sys.platform == 'win32':
        is_root = ctypes.windll.shell32.IsUserAnAdmin() != 0
    else:
       is_root = os.geteuid() == 0
    spotify_token = False
    queue_metadata = {}
    connections = {}
    initial_consume = True
    radio = {
        "enabled": 0,
        "seed_artists": [],
        "seed_genres": [],
        "seed_tracks": [],
        "results": []
    }
    botRockVoting = None
    botRockVoteCandidateNum = 2

    ##
    # Generate a random string
    #
    # Used for connection_ids where none is provided by client
    # @return string
    ##
    def generateGuid(self, length):
       return ''.join(random.choice(string.lowercase) for i in range(length))

    ##
    # Digest a protocol header into it's id/name parts
    #
    # @return dict
    ##
    def digest_protocol(self, protocol):
        
        # if we're a string, split into list
        # this handles the different ways we get this passed (select_subprotocols gives string, headers.get gives list)
        if isinstance(protocol, basestring):
        
            # make sure we strip any spaces (IE gives "element,element", proper browsers give "element, element")
            protocol = [i.strip() for i in protocol.split(',')]
        
        # if we've been given a valid array
        try:
            client_id = protocol[0]
            connection_id = protocol[1]
            username = protocol[2]
            generated = False
          
        # invalid, so just create a default connection, and auto-generate an ID
        except:
            client_id = self.generateGuid(12)
            connection_id = self.generateGuid(12)
            username = None
            generated = True
        
        # construct our protocol object, and return
        return {
            "client_id": client_id,
            "connection_id": connection_id,
            "username": username,
            "generated": generated
        }


    def send_message(self, *args, **kwargs):        
        connection_id = kwargs.get('connection_id', None)
        data = kwargs.get('data', {})

        try:
            self.connections[connection_id]['connection'].write_message( json_encode(data) )
        except:
            logger.error('Failed to send message to '+ connection_id)


    def broadcast(self, *args, **kwargs):
        data = kwargs.get('data', {})
        callback = kwargs.get('callback', None)

        for connection in self.connections.itervalues():
            connection['connection'].write_message( json_encode(data) )

        response = {
            'message': 'Broadcast to '+str(len(self.connections))+' connections'
        }
        if (callback):
            callback(response)
        else:
            return response  
    
    ##
    # Connections
    #
    # Contains all our connections and client details. This requires updates
    # when new clients connect, and old ones disconnect. These events are broadcast
    # to all current connections
    ##

    def get_connections(self, *args, **kwargs):  
        callback = kwargs.get('callback', None)

        connections = []
        for connection in self.connections.itervalues():
            connections.append(connection['client'])
        
        response = {
            'connections': connections
        }
        if (callback):
            callback(response)
        else:
            return response  

    def add_connection(self, *args, **kwargs):
        connection_id = kwargs.get('connection_id', None)
        connection = kwargs.get('connection', None)
        client = kwargs.get('client', None)

        new_connection = {
            'client': client,
            'connection': connection
        }
        self.connections[connection_id] = new_connection

        self.send_message(
            connection_id=connection_id,
            data={
                'type': 'connected',
                'connection_id': connection_id,
                'client_id': client['client_id'],
                'username': client['username'],
                'ip': client['ip']
            }
        )

        self.broadcast(
            data={
                'type': 'connection_added',
                'connection': client
            }
        )
    
    def remove_connection(self, connection_id):
        if connection_id in self.connections:
            try:
                client = self.connections[connection_id]['client']  
                del self.connections[connection_id]
                self.broadcast(
                    data={
                        'type': 'connection_removed',
                        'connection': client
                    }
                )
            except:
                logger.error('Failed to close connection to '+ connection_id)           

    def set_username(self, *args, **kwargs):
        callback = kwargs.get('callback', None)
        data = kwargs.get('data', {})
        connection_id = data['connection_id']

        if connection_id in self.connections:
            self.connections[connection_id]['client']['username'] = data['username']
            self.broadcast(
                data={
                    'type': 'connection_updated',
                    'connection': self.connections[connection_id]['client']
                }
            )
            response = {
                'connection_id': connection_id,
                'username': data['username']
            }
            if (callback):
                callback(response)
            else:
                return response  

        else:
            error = 'Connection "'+data['connection_id']+'" not found'
            logger.error(error)

            error = {
                'message': error
            }
            if (callback):
                callback(False, error)
            else:
                return error   

    def deliver_message(self, *args, **kwargs):
        callback = kwargs.get('callback', False)
        data = kwargs.get('data', {})

        if data['connection_id'] in self.connections:
            self.send_message(connection_id=data['connection_id'], data=data['message'])
            response = {
                'message': 'Sent message to '+data['connection_id']
            }
            if (callback):
                callback(response)
            else:
                return response

        else:
            error = 'Connection "'+data['connection_id']+'" not found'
            logger.error(error)

            error = {
                'message': error
            }
            if (callback):
                callback(False, error)
            else:
                return error
            



    ##
    # System controls
    #
    # Faciitates upgrades and configuration fetching
    ##  

    def get_config(self, *args, **kwargs):
        callback = kwargs.get('callback', False)

        # handle config setups where there is no username/password
        # BotRock won't work properly anyway, but at least we won't get server errors
        if 'spotify' in self.config and 'username' in self.config['spotify']:
            spotify_username = self.config['spotify']['username']
        else:        
            spotify_username = False

        response = {
            'config': {
                "spotify_username": spotify_username,
                "country": 'US',#self.config['botrock']['country'],
                "locale": 'en_US',#self.config['botrock']['locale'],
                "spotify_authorization_url": 'https://jamesbarnsley.co.nz/auth_spotify.php',#self.config['botrock']['spotify_authorization_url'],
                "lastfm_authorization_url": 'https://jamesbarnsley.co.nz/auth_lastfm.php'#self.config['botrock']['lastfm_authorization_url']
            }
        }

        if (callback):
            callback(response)
        else:
            return response

    def get_version(self, *args, **kwargs):
        callback = kwargs.get('callback', False)

        response = {
            'version': {
                'current': None,
                'latest': None,
                'is_root': None,
                'upgrade_available': None
            }
        }
        if (callback):
            callback(response)
        else:
            return response

    def perform_upgrade(self, *args, **kwargs):
        callback = kwargs.get('callback', False)

        try:
            subprocess.check_call(["pip", "install", "--upgrade", "Mopidy-BotRock"])
            response = {
                'message': "Upgrade started"
            }
            if (callback):
                callback(response)
            else:
                return response

        except subprocess.CalledProcessError as e:
            error = {
                'message': "Could not start upgrade"
            }
            if (callback):
                callback(False, error)
            else:
                return error
        
    def restart(self, *args, **kwargs):
        os.execl(sys.executable, *([sys.executable]+sys.argv))


    ##
    # Spotify Radio
    #
    # Accepts seed URIs and creates radio-like experience. When our tracklist is nearly
    # empty, we fetch more recommendations. This can result in duplicates. We keep the
    # recommendations limit low to avoid timeouts and slow UI
    ##

    def get_radio(self, *args, **kwargs):
        callback = kwargs.get('callback', False)

        response = {
            'radio': self.radio
        }
        if (callback):
            callback(response)
        else:
            return response

    def change_radio(self, *args, **kwargs):
        callback = kwargs.get('callback', False)
        data = kwargs.get('data', {})

        # figure out if we're starting or updating radio mode
        if data['update'] and self.radio['enabled']:
            starting = False
            self.initial_consume = self.core.tracklist.get_consume()
        else:
            starting = True
        
        # fetch more tracks from Mopidy-Spotify
        self.radio = data
        self.radio['enabled'] = 1;
        self.radio['results'] = [];
        uris = self.load_more_tracks()

        # make sure we got recommendations
        if uris:
            if starting:
                self.core.tracklist.clear()

            self.core.tracklist.set_consume(True)

            # We only want to play the first batch
            added = self.core.tracklist.add(uris = uris[0:3])

            if (not added.get()):
                logger.error("No recommendations added to queue")

                self.radio['enabled'] = 0;
                error = {
                    'message': 'No recommendations added to queue',
                    'radio': self.radio
                }
                if (callback):
                    callback(False, error)
                else:
                    return error

            # Save results (minus first batch) for later use
            self.radio['results'] = uris[3:]

            if starting:
                self.core.playback.play()
                self.broadcast(
                    data={
                        'type': 'radio_started',
                        'radio': self.radio
                    }
                )
            else:
                self.broadcast(
                    data={
                        'type': 'radio_changed',
                        'radio': self.radio
                    }
                )

            self.get_radio(callback=callback)
            return
        
        # Failed fetching/adding tracks, so no-go
        else:
            logger.error("No recommendations returned by Spotify")
            self.radio['enabled'] = 0;
            error = {
                'message': 'Could not start radio',
                'radio': self.radio
            }
            if (callback):
                callback(False, error)
            else:
                return error


    def stop_radio(self, *args, **kwargs):
        callback = kwargs.get('callback', False)

        self.radio = {
            "enabled": 0,
            "seed_artists": [],
            "seed_genres": [],
            "seed_tracks": [],
            "results": []
        }

        # restore initial consume state
        self.core.tracklist.set_consume(self.initial_consume)
        self.core.playback.stop()        

        self.broadcast(
            data={
                'type': 'radio_stopped',
                'radio': self.radio
            }
        )
        
        response = {
            'message': 'Stopped radio'
        }
        if (callback):
            callback(response)
        else:
            return response


    def load_more_tracks(self, *args, **kwargs):
        
        try:
            self.get_spotify_token()
            spotify_token = self.spotify_token
            access_token = spotify_token['access_token']
        except:
            error = 'BotRockFrontend: access_token missing or invalid'
            logger.error(error)
            return False
            
        try:
            url = 'https://api.spotify.com/v1/recommendations/'
            url = url+'?seed_artists='+(",".join(self.radio['seed_artists'])).replace('spotify:artist:','')
            url = url+'&seed_genres='+(",".join(self.radio['seed_genres'])).replace('spotify:genre:','')
            url = url+'&seed_tracks='+(",".join(self.radio['seed_tracks'])).replace('spotify:track:','')
            url = url+'&limit=50'

            req = urllib2.Request(url)
            req.add_header('Authorization', 'Bearer '+access_token)

            response = urllib2.urlopen(req, timeout=30).read()
            response_dict = json.loads(response)
            
            uris = []
            for track in response_dict['tracks']:
                uris.append( track['uri'] )

            return uris

        except:
            logger.error('BotRockFrontend: Failed to fetch Spotify recommendations')
            return False


    def check_for_radio_update( self ):
        tracklistLength = self.core.tracklist.length.get()        
        if (tracklistLength < 3 and self.radio['enabled'] == 1):
            
            # Grab our loaded tracks
            uris = self.radio['results']

            # We've run out of pre-fetched tracks, so we need to get more recommendations
            if (len(uris) < 3):
                uris = self.load_more_tracks()

            # Remove the next batch, and update our results
            self.radio['results'] = uris[3:]

            # Only add the next set of uris
            uris = uris[0:3]

            self.core.tracklist.add(uris = uris)
                


    ##
    # Additional queue metadata
    #
    # This maps tltracks with extra info for display in BotRock, including
    # added_by and from_uri.
    ##

    def get_queue_metadata(self, *args, **kwargs):
        callback = kwargs.get('callback', False)

        response = {
            'queue_metadata': self.queue_metadata
        }
        if (callback):
            callback(response)
        else:
            return response

    def add_queue_metadata(self, *args, **kwargs):
        callback = kwargs.get('callback', False)
        data = kwargs.get('data', {})

        for tlid in data['tlids']:
            item = {
                'tlid': tlid,
                'added_from': data['added_from'],
                'added_by': data['added_by']
            }
            self.queue_metadata['tlid_'+str(tlid)] = item

        self.broadcast(
            data={
                'type': 'queue_metadata_changed',
                'queue_metadata': self.queue_metadata
            }
        )
        
        response = {
            'message': 'Added queue metadata'
        }
        if (callback):
            callback(response)
        else:
            return response

    def clean_queue_metadata(self, *args, **kwargs):
        callback = kwargs.get('callback', False)
        cleaned_queue_metadata = {}

        for tltrack in self.core.tracklist.get_tl_tracks().get():

            # if we have metadata for this track, push it through to cleaned dictionary
            if 'tlid_'+str(tltrack.tlid) in self.queue_metadata:
                cleaned_queue_metadata['tlid_'+str(tltrack.tlid)] = self.queue_metadata['tlid_'+str(tltrack.tlid)]

        self.queue_metadata = cleaned_queue_metadata


    ##
    # Spotify authentication
    #
    # Uses the Client Credentials Flow, so is invisible to the user. We need this token for
    # any backend spotify requests (we don't tap in to Mopidy-Spotify, yet). Also used for
    # passing token to frontend for javascript requests without use of the Authorization Code Flow.
    ##

    def get_spotify_token(self, *args, **kwargs):
        callback = kwargs.get('callback', False)

        # Expired, so go get a new one
        if (not self.spotify_token or self.spotify_token['expires_at'] <= time.time()):
            self.refresh_spotify_token()

        response = {
            'spotify_token': self.spotify_token
        }

        if (callback):
            callback(response)
        else:
            return response

    def refresh_spotify_token(self, *args, **kwargs):
        callback = kwargs.get('callback', None)
        
        # Use client_id and client_secret from config
        # This was introduced in Mopidy-Spotify 3.1.0
        url = 'https://auth.mopidy.com/spotify/token'
        data = {
            'client_id': self.config['spotify']['client_id'],
            'client_secret': self.config['spotify']['client_secret'],
            'grant_type': 'client_credentials'
        }

        try:
            http_client = tornado.httpclient.HTTPClient()
            request = tornado.httpclient.HTTPRequest(url, method='POST', body=urllib.urlencode(data))
            response = http_client.fetch(request)

            token = json.loads(response.body)
            token['expires_at'] = time.time() + token['expires_in']
            self.spotify_token = token

            self.broadcast(
                data={
                    'type': 'spotify_token_changed',
                    'spotify_token': self.spotify_token
                }
            )

            response = {
                'spotify_token': token
            }
            if (callback):
                callback(response)
            else:
                return response

        except urllib2.HTTPError as e:
            error = json.loads(e.read())
            error = {'message': 'Could not refresh token: '+error['error_description']}

            if (callback):
                callback(False, error)
            else:
                return error


    ##
    # Proxy a request to an external provider
    #
    # This is required when requesting to non-CORS providers. We simply make the request
    # server-side and pass that back. All we change is the response's Access-Control-Allow-Origin
    # to prevent CORS-blocking by the browser.
    ##

    def proxy_request(self, *args, **kwargs):
        callback = kwargs.get('callback', False)
        origin_request = kwargs.get('request', None)
        
        try:
            data = kwargs.get('data', {})
        except:
            callback(False, {
                'message': 'Malformed data',
                'source': 'proxy_request'
            })
            return

        # Our request includes data, so make sure we POST the data
        if 'url' not in data:
            callback(False, {
                'message': 'Malformed data (missing URL)',
                'source': 'proxy_request',
                'original_request': data
            })
            return

        # Construct request headers
        # If we have an original request, pass through it's headers
        if origin_request:
            headers = origin_request.headers
        else:
            headers = {}

        # Adjust headers
        headers["Accept-Language"] = "*" 
        headers["Accept-Encoding"] = "deflate" 
        if "Content-Type" in headers:
            del headers["Content-Type"]
        if "Host" in headers:
            del headers["Host"]
        if "X-Requested-With" in headers:
            del headers["X-Requested-With"]
        if "X-Forwarded-Server" in headers:
            del headers["X-Forwarded-Server"]
        if "X-Forwarded-Host" in headers:
            del headers["X-Forwarded-Host"]
        if "X-Forwarded-For" in headers:
            del headers["X-Forwarded-For"]
        if "Referrer" in headers:
            del headers["Referrer"]

        # Our request includes data, so make sure we POST the data
        if ('data' in data and data['data']):
            http_client = tornado.httpclient.AsyncHTTPClient()
            request = tornado.httpclient.HTTPRequest(data['url'], method='POST', body=json.dumps(data['data']), headers=headers, validate_cert=False)
            http_client.fetch(request, callback=callback)

        # No data, so just a simple GET request
        else:

            # Strip out our origin content-length otherwise this confuses
            # the target server as content-length doesn't apply to GET requests
            if "Content-Length" in headers:
                del headers["Content-Length"]

            http_client = tornado.httpclient.AsyncHTTPClient()
            request = tornado.httpclient.HTTPRequest(data['url'], headers=headers, validate_cert=False)
            http_client.fetch(request, callback=callback)

    ##
    # create_new_botrock_voting
    ##  
    def create_new_botrock_voting(self):
        logger.debug('create_new_botrock_voting')
        tracklist = self.core.tracklist.get_tl_tracks().get()
            
        if len(tracklist) > self.botRockVoteCandidateNum:
            self.botRockVoting = {
                "songs": self.get_songs_for_botrock_voting()
            }

            self.broadcast(
                data={
                    'type': 'botrock_voting_updated',
                    'voting': self.botRockVoting
                })

    ##
    # get_songs_for_botrock_voting
    ##
    def get_songs_for_botrock_voting(self):
        logger.debug('get_songs_for_botrock_voting')
        tracklist = self.core.tracklist.get_tl_tracks().get()
        currenttrack = self.core.playback.get_current_tl_track().get()
        trackIndexList = []
        songList = []
        
        for songIndex in range(0, self.botRockVoteCandidateNum):
            track = None
            while True:
                trackIndex = randint(1, len(tracklist) - 1)
                track = tracklist[trackIndex]
                if track != currenttrack and trackIndex not in trackIndexList:
                    trackIndexList.append(trackIndex)
                    break
            artistNameList = []
            for artist in track.track.artists:
                artistNameList.append(artist.name)
            songList.append({
                "track": {
                    "tlid": track.tlid
                    ,"uri": track.track.uri
                    ,"name": track.track.name
                    ,"artist": ', '.join(artistNameList)
                },
                "votes": [],
                "first_vote_timestamp": None
                })
        
        return songList

    ##
    # remove_botrock_voting
    ##  
    def remove_botrock_voting(self):
        self.botRockVoting = None

        self.broadcast(
            data={
                'type': 'botrock_voting_updated',
                'voting': self.botRockVoting
            })

    ##
    # get_botrock_voting
    ##
    def get_botrock_voting(self, *args, **kwargs):
        callback = kwargs.get('callback', False)
        logger.debug(u'get_botrock_voting')
            
        returnData = {
            "voting": self.botRockVoting
        }
        if (callback):
            callback(returnData)
        else:
            return returnData

    ##
    # cast_botrock_vote
    ##
    def cast_botrock_vote(self, *args, **kwargs):
        callback = kwargs.get('callback', False)
        data = kwargs.get('data', {})

        self.cast_botrock_vote_internal(data['username'], data['song_number'])

        returnData = {
            "voting": self.botRockVoting
        }
        
        if (callback):
            callback(returnData)
        else:
            return returnData

    ##
    # cast_botrock_vote_internal
    ##
    def cast_botrock_vote_internal(self, username, song_number):
        song_index = song_number - 1
        logger.debug('Vote cast: username - ' + username + ', song_index - ' + str(song_index))

        for i in range(0, len(self.botRockVoting['songs'])):
            song = self.botRockVoting['songs'][i]
            if i == song_index:
                #Match. Check to make sure user is not already in votes list
                if not username in song['votes']:
                    song['votes'].append(username)
                else:
                    song['votes'].remove(username)
            else:
                #Not a match.  Check if user has previously voted for this song and if so, remove it
                if username in song['votes']:
                    song['votes'].remove(username)

            #Set song vote timestamp
            if len(song['votes']) == 0:
                #Song does not have any votes.  Clear its timestamp
                song['first_vote_timestamp'] = None
            elif song['first_vote_timestamp'] == None:
                #Song has votes but no timestamp.  Set timestamp
                song['first_vote_timestamp'] = time.time()

        #broadcast message that voting has been updated
        self.broadcast(
            data={
                'type': 'botrock_voting_updated',
                'voting': self.botRockVoting
            })

    ##
    # play_winner_of_botrock_voting
    ##
    def play_winner_of_botrock_voting(self):
        logger.debug('play_winner_of_botrock_voting')

        winner = None

        if self.botRockVoting:
            winnerVotes = 0
            winnerTimestamp = 0
            for song in self.botRockVoting['songs']:
                songVotes = len(song['votes'])
                songTimestamp = song['first_vote_timestamp']
                if songVotes > winnerVotes or (songVotes > 0 and songVotes == winnerVotes and songTimestamp < winnerTimestamp):
                    winner = song
                    winnerVotes = songVotes
                    winnerTimestamp = songTimestamp
            if winner:
                winnerIndex = self.core.tracklist.index(tlid = winner['track']['tlid']).get()
                logger.debug('Voting Winner: ' + str(winner) + ' index: ' + str(winnerIndex))

                self.broadcast(
                    data={
                        'type': 'botrock_voting_won',
                        'song': winner
                    })
                
                #Move winner to top of tracklist
                self.core.tracklist.move(start = winnerIndex, end = winnerIndex + 1, to_position = 0)
                #Play winner
                self.core.playback.play(tlid = winner['track']['tlid'])

            self.botRockVoting = None

        return winner != None

    ##
    # remove_tl_track
    ##
    def remove_tl_track(self, tl_track):
        logger.debug('remove_tl_track')
        self.core.tracklist.remove({ 'tlid': [ tl_track.tlid ] }).get()

    ##
    # update_botrock_voting_status
    ##
    def update_botrock_voting_status(self):
        tracklist = self.core.tracklist.get_tl_tracks().get()
        if len(tracklist) <= self.botRockVoteCandidateNum:
            self.remove_botrock_voting()
        elif self.botRockVoting == None:
            self.create_new_botrock_voting()

    ##
    # play_first_track_if_one_not_already_playing
    ##
    def play_first_track_if_one_not_already_playing(self):
        state = self.core.playback.get_state().get()
        if state == 'stopped':
            tracklist = self.core.tracklist.get_tl_tracks().get()
            if len(tracklist) > 0:
                self.core.playback.play(tlid = tracklist[0].tlid)
    ##
    # Simple test method
    ##
    def test(self, *args, **kwargs):
        callback = kwargs.get('callback', None)
        data = kwargs.get('data', {})

        if data and 'force_error' in data:
            callback(False, {'message': "Could not sleep, forced error"})
            return
        else:
            time.sleep(1)
            callback({'message': "Slept for one second"}, False)
            return
