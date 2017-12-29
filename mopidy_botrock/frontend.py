# future imports
from __future__ import unicode_literals
from mopidy.core import CoreListener

# stdlib imports
import logging
import json
import time
import threading

# third-party imports
import mem
import pykka
import paho.mqtt.client as mqtt

logger = logging.getLogger(__name__)

class BotRockFrontend(pykka.ThreadingActor, CoreListener):

	def __init__(self, config, core):
		super(BotRockFrontend, self).__init__()

		logger.info("mopidy_botrock initializing ... ")
		
		mem.botrock.core = core
		mem.botrock.config = config
		
		#_accesskey = self.config['accesskey']
		#_secretkey = self.config['secretkey']
		_channeltoken = config['botrock']['channeltoken']
		self.topic = config['botrock']['topic']

		self.client = mqtt.Client()
		self.client.on_connect = self.on_mqtt_connect
		self.client.on_message = self.on_mqtt_message

		self.client.username_pw_set("token:" + _channeltoken)

		self.mqtt_connect()

		self.tl_track_now_playing = None

	def mqtt_connect(self):
		_hostname = 'mqtt.beebotte.com'
		while True:
			try:
				self.client.connect(_hostname, 1883, 60)

				self.client.loop_start()
				break
			except:
				logger.error('Unable to connect to MQTT server, retrying...')
				time.sleep(4)

	def on_mqtt_connect(self, client, data, flags, rc):
		client.subscribe(self.topic, 1)
		logger.info("Connected to topic: " + self.topic)

	def on_mqtt_message(self, client, data, msg):
		logger.info("Received a message on " + msg.topic + " with payload " + str(msg.payload))
		payload = json.loads(msg.payload)
		#logger.info(payload)
		data = payload[u'data']
		action = data[u'action']
		self.handle_mqtt_action(action, data)

	def on_start(self):        
		logger.info('Starting BotRock '+ mem.botrock.version)

	def tracklist_changed(self):
		logger.debug('tracklist_changed')
		mem.botrock.play_first_track_if_one_not_already_playing()

	def track_playback_started(self, tl_track):
		logger.debug('BotRock - track_playback_started - track: ' + tl_track.track.name.encode('ascii', 'ignore').decode('ascii'))
		mem.botrock.update_botrock_voting_status()
		if not self.tl_track_now_playing:
			logger.debug('BotRock - No tl_track_now_playing.  Set to playing track')
			timer = threading.Timer(1, self.set_tl_track_now_playing_callback, [tl_track])
			timer.start()

	def track_playback_ended(self, tl_track, time_position):
		logger.debug('BotRock - track_playback_ended - track: ' + tl_track.track.name.encode('ascii', 'ignore').decode('ascii') + ', time_position: ' + str(time_position))
			
		if self.tl_track_now_playing and self.tl_track_now_playing.tlid == tl_track.tlid:
			logger.debug('BotRock - tl_track_now_playing matches tl_track')
			
			logger.debug('BotRock - Playback ended, tallying votes')
			winner_played = mem.botrock.play_winner_of_botrock_voting()
			logger.debug('BotRock - voting tallied, winner_played: ' + str(winner_played))

			logger.debug('BotRock - Remove track')
			mem.botrock.remove_tl_track(tl_track)
			self.tl_track_now_playing = None

	def set_tl_track_now_playing_callback(self, tl_track):
		logger.debug('BotRock - set_tl_track_now_playing_callback - tl_track: ' + tl_track.track.name.encode('ascii', 'ignore').decode('ascii'))
		self.tl_track_now_playing = tl_track
			
	def handle_mqtt_action(self, action, data = None):
		try:
			logger.info("handle_mqtt_action - Action: " + action + ", Data: " + str(data))
			if action == "play":
				self.playbackPlay()
			elif action == "playFirst":
				tracks = self.tracklistSlice(0, 1)
				track = tracks.get()[0]
				self.playbackPlay(track)
			elif action == "stop":
				mem.botrock.core.playback.stop()
			elif action == "next":
				mem.botrock.core.playback.next()
			elif action == "previous":
				mem.botrock.core.playback.previous()
			elif action == "pause":
				mem.botrock.core.playback.pause()
			elif action == "resume":
				mem.botrock.core.playback.resume()
			elif action == "tracklistAdd":
				uris = data[u'uris']
				at_position = None
				if u'at_position' in data:
					at_position = data[u'at_position']
				return self.tracklistAdd(uris, at_position)
			elif action == "playNow":
				insertIndex = 0
				currentTrack = self.playbackGetCurrentTlTrack().get()
				if currentTrack:
					insertIndex = self.tracklistIndex(currentTrack).get()
				#logger.info(currentTrack)
				tracks = self.tracklistAdd(data[u'uris'], insertIndex)
				track = tracks.get()[0]
				self.playbackPlay(track)
			elif action == "vote":
				mem.botrock.cast_botrock_vote_internal(data[u'username'], data[u'song_number'])
			else:
				logger.info("Unhandled action")
			pass
		except Exception as e:
			logger.error(e)
		
	def playbackPlay(self, tl_track = None, tlid = None):
		return mem.botrock.core.playback.play(tl_track, tlid)

	def playbackStop(self):
		return mem.botrock.core.playback.stop()

	def playbackNext(self):
		return mem.botrock.core.playback.next()

	def playbackPrevious(self):
		return mem.botrock.core.playback.previous()

	def playbackPause(self):
		return mem.botrock.core.playback.pause()

	def playbackResume(self):
		return mem.botrock.core.playback.resume()

	def playbackGetCurrentTlTrack(self):
		return mem.botrock.core.playback.get_current_tl_track()

	def tracklistAdd(self, uris, at_position = None):
		return mem.botrock.core.tracklist.add(at_position = at_position, uris = uris)

	def tracklistSlice(self, start, end):
		return mem.botrock.core.tracklist.slice(start, end)

	def tracklistIndex(self, tl_track = None, tlid = None):
		return mem.botrock.core.tracklist.index(tl_track, tlid)