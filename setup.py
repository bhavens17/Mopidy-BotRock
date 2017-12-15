from __future__ import unicode_literals

import re

from setuptools import find_packages, setup


def get_version(filename):
    with open(filename) as fh:
        metadata = dict(re.findall("__([a-z]+)__ = '([^']+)'", fh.read()))
        return metadata['version']


setup(
    name='Mopidy-BotRock',
    version=get_version('mopidy_botrock/__init__.py'),
    url='https://github.com/bhavens17/mopidy-botrock',
    license='Apache License, Version 2.0',
    author='Brad Havens',
    author_email='bhavens@hawk.iit.edu',
    description='Mopidy extension for multi-user voting jukebox',
    long_description=open('README.rst').read(),
    packages=find_packages(exclude=['tests', 'tests.*']),
    zip_safe=False,
    include_package_data=True,
    install_requires=[
        'setuptools >= 3.3',
        'pylast >= 1.6.0',
        'Mopidy >= 2.0',
        'Mopidy-Local-Images >= 1.0',
        'ConfigObj >= 5.0.6',
        'requests >= 2.0.0',
        'paho-mqtt >= 1.3.1'
    ],
    entry_points={
        'mopidy.ext': [
            'botrock = mopidy_botrock:Extension',
        ],
    },
    classifiers=[
        'Environment :: No Input/Output (Daemon)',
        'Intended Audience :: End Users/Desktop',
        'License :: OSI Approved :: Apache Software License',
        'Operating System :: OS Independent',
        'Programming Language :: Python :: 2',
        'Topic :: Multimedia :: Sound/Audio :: Players',
    ],
)
