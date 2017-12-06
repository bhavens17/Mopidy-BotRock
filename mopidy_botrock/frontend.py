# future imports
from __future__ import absolute_import
from __future__ import unicode_literals

# stdlib imports
import logging

from mopidy import core

import paho.mqtt.client as mqtt

# third-party imports
import pykka

logger = logging.getLogger(__name__)

class BotRockFrontend(pykka.ThreadingActor, core.CoreListener):

    def __init__(self, config, core):
        logger.info("mopidy_botrock initializing ... ")
        self.core = core
        
        self.config = config['botrock']
	_hostname = 'mqtt.beebotte.com'
        _accesskey = self.config['accesskey']
       	_secretkey = self.config['secretkey']
	_channeltoken = self.config['channeltoken']
	self.channel = self.config['channel']
	self.resource = self.config['resource']

	self.client = mqtt.Client()
	self.client.on_connect = self.on_connect
	self.client.on_message = self.on_message

	if _secretkey:
		self.client.username_pw_set("token:" + _channeltoken)
	else:
		self.client.username_pw_set(_secretkey)

	self.client.connect(_hostname, 1883, 60)

	self.client.loop_start()
	super(BotRockFrontend, self).__init__()

    def on_connect(self, client, data, flags, rc):
	client.subscribe(self.channel + '/' + self.resource, 1)
	logger.info("Connected to channel/resource: " + self.channel + "/" + self.resource)
    def on_message(self, client, data, msg):
	logger.info("received a message on " + msg.topic + " with payload " + str(msg.payload))
