# future imports
from __future__ import absolute_import
from __future__ import unicode_literals

# stdlib imports
import logging
import json

from mopidy import core

# third-party imports
import pykka
import paho.mqtt.client as mqtt

logger = logging.getLogger(__name__)

class BotRockFrontend(pykka.ThreadingActor, core.CoreListener):

	def __init__(self, config, core):
		super(BotRockFrontend, self).__init__()
		
		logger.info("mopidy_botrock initializing ... ")
		
		mem.botrock.core = core
		mem.botrock.config = config

		_hostname = 'mqtt.beebotte.com'
		#_accesskey = self.config['accesskey']
		#_secretkey = self.config['secretkey']
		_channeltoken = self.config['channeltoken']
		self.topic = self.config['topic']

		self.client = mqtt.Client()
		self.client.on_connect = self.on_mqtt_connect
		self.client.on_message = self.on_mqtt_message

		self.client.username_pw_set("token:" + _channeltoken)

		self.client.connect(_hostname, 1883, 60)

		self.client.loop_start()

		#Turn on consume mode, to cause tracks to be removed from playlist as they finish playing
		self.core.tracklist.set_consume(True)

	def on_mqtt_connect(self, client, data, flags, rc):
		client.subscribe(self.topic, 1)
		logger.info("Connected to topic: " + self.topic)
	
	def on_mqtt_message(self, client, data, msg):
		logger.info("Received a message on " + msg.topic + " with payload " + str(msg.payload))
		payload = json.loads(msg.payload)
		#logger.info(payload)
		data = payload[u'data']
		action = data[u'action']
		self.handle_action(action, data)

	def handle_action(self, action, data = None):
		try:
			logger.info("Action: " + action)
			if action == "play":
				self.playbackPlay()
			elif action == "playFirst":
				tracks = self.tracklistSlice(0, 1)
				track = tracks.get()[0]
				self.playbackPlay(track)
			elif action == "stop":
				self.core.playback.stop()
			elif action == "next":
				self.core.playback.next()
			elif action == "previous":
				self.core.playback.previous()
			elif action == "pause":
				self.core.playback.pause()
			elif action == "resume":
				self.core.playback.resume()
			elif action == "tracklistAdd":
				uris = data[u'uris']
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
			else:
				logger.info("Unhandled action")
			pass
		except Exception as e:
			logger.error(e)
		
	def playbackPlay(self, tl_track = None, tlid = None):
		return self.core.playback.play(tl_track, tlid)

	def playbackStop(self):
		return self.core.playback.stop()

	def playbackNext(self):
		return self.core.playback.next()

	def playbackPrevious(self):
		return self.core.playback.previous()

	def playbackPause(self):
		return self.core.playback.pause()

	def playbackResume(self):
		return self.core.playback.resume()

	def playbackGetCurrentTlTrack(self):
		return self.core.playback.get_current_tl_track()


	def tracklistAdd(self, uris, at_position = 0):
		return self.core.tracklist.add(at_position = at_position, uris = uris)

	def tracklistSlice(self, start, end):
		return self.core.tracklist.slice(start, end)

	def tracklistIndex(self, tl_track = None, tlid = None):
		return self.core.tracklist.index(tl_track, tlid)