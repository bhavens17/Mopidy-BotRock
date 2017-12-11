from __future__ import unicode_literals

import logging, os, json
import tornado.web
import tornado.websocket
import handlers

from mopidy import config, ext
from frontend import BotRockFrontend
from handlers import WebsocketHandler, HttpHandler
from core import BotRockCore

__version__ = '0.1.0'

# TODO: If you need to log, use loggers named after the current Python module
logger = logging.getLogger(__name__)

class Extension(ext.Extension):

    dist_name = 'Mopidy-BotRock'
    ext_name = 'botrock'
    version = __version__

    def get_default_config(self):
        conf_file = os.path.join(os.path.dirname(__file__), 'ext.conf')
        return config.read(conf_file)

    def get_config_schema(self):
        schema = super(Extension, self).get_config_schema()
        #schema['accesskey'] = config.String()
        #schema['secretkey'] = config.String()
        schema['channeltoken'] = config.String()
        schema['topic'] = config.String()
        return schema

    def setup(self, registry):
        # You will typically only implement one of the following things
        # in a single extension.

        # TODO: Edit or remove entirely
        from .frontend import BotRockFrontend
        registry.add('frontend', BotRockFrontend)

        # TODO: Edit or remove entirely
        # from .backend import FoobarBackend
        # registry.add('backend', FoobarBackend)

        # TODO: Edit or remove entirely
        registry.add('http:app', {
            'name': self.ext_name,
            'factory': botrock_factory
            #'path': os.path.join(os.path.dirname(__file__), 'public'),
        })

        # create our core instance
        mem.botrock = BotRockCore()
        mem.botrock.version = self.version

    def botrock_factory(config, core):
        path = os.path.join( os.path.dirname(__file__), 'static')
        
        return [
            (r"/images/(.*)", tornado.web.StaticFileHandler, {
                'path': config['local-images']['image_dir']
            }),
            (r'/http/([^/]*)', handlers.HttpHandler, {
                'core': core,
                'config': config
            }),
            (r'/ws/?', handlers.WebsocketHandler, { 
                'core': core,
                'config': config
            }),
            (r'/(.*)', tornado.web.StaticFileHandler, {
                'path': path,
                'default_filename': 'index.html'
            }),
        ]