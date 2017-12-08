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
		logger.info("mopidy_botrock initializing ... ")
		self.core = core

		self.config = config['botrock']
		_hostname = 'mqtt.beebotte.com'
		#_accesskey = self.config['accesskey']
		#_secretkey = self.config['secretkey']
		_channeltoken = self.config['channeltoken']
		self.topic = self.config['topic']

		self.client = mqtt.Client()
		self.client.on_connect = self.on_connect
		self.client.on_message = self.on_message

		#if _secretkey:
		#	self.client.username_pw_set(_secretkey)
		#else:
		self.client.username_pw_set("token:" + _channeltoken)

		self.client.connect(_hostname, 1883, 60)

		self.client.loop_start()
		super(BotRockFrontend, self).__init__()

	def on_connect(self, client, data, flags, rc):
		client.subscribe(self.topic, 1)
		logger.info("Connected to topic: " + self.topic)
	def on_message(self, client, data, msg):
		logger.info("Received a message on " + msg.topic + " with payload " + str(msg.payload))
		payload = json.loads(msg.payload)
		#logger.info(payload)
		data = payload[u'data']
		action = data[u'action']
		self.handle_action(action, data)
	def handle_action(self, action, data = None):
		logger.info('handle_action')
		try:
			logger.info("Action: " + action)
			if action == "play":
				self.core.playback.play()
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
			elif action == "playTrack":
				tl_track = data[u'tl_track']
				tlid = data[u'tlid']
				self.core.playback.play(tl_track, tlid)
			elif action == "tracklistAdd":
				uris = data[u'uris']
				at_position = data[u'at_position']
				tracks = self.core.tracklist.add(at_position = at_position, uris = uris)
				return tracks
			elif action == "playImmediate":
				tracklistAddData = {}
				tracklistAddData[u'at_position'] = 0
				tracklistAddData[u'uris'] = data[u'uris']
				tracks = self.handle_action(action = "tracklistAdd", data = tracklistAddData)
				track = tracks.get()[0]
				logger.info(track)
				playTrackData = {}
				playTrackData[u'tl_track'] = track
				playTrackData[u'tlid'] = None
				self.handle_action(action = "playTrack", data = playTrackData)
			else:
				logger.info("Unhandled action")
			pass
		except Exception as e:
			logger.info(e)
		