var appModel = function()
{
	var self = this;
	
	self.playbackState = ko.observable();
	self.currentTrack = ko.observable();
	self.currentTrackDesc = ko.computed(function(){
		return self.currentTrack() ?  self.trackDesc(self.currentTrack()) : "";
	});

	self.trackDesc = function (track) {
	    return track.name + " by " + track.artists[0].name +
	        " from " + track.album.name;
	};

	self.getCurrentTrack = function(){
		self.mopidy.playback.getCurrentTrack().then(function(track){
			self.currentTrack(track);
		});
	}

	self.getPlaybackState = function(){
		self.mopidy.playback.getState().then(self.playbackState);
	}

	self.playbackStateChanged = function(data){
		self.playbackState(data.new_state);
	}

	self.playPauseTrack = function(){
		if(self.playbackState() == "playing")
			self.mopidy.playback.pause();
		else
			self.mopidy.playback.play();
	}

	self.nextTrack = function(){
		self.mopidy.playback.next();
	}

	self.previousTrack = function(){
		self.mopidy.playback.previous();
	}

	self.alert = function(){
		window.alert('here');
	}

	self.getCurrentTrackAndPlaybackState = function(){
		self.getCurrentTrack();
		self.getPlaybackState();
	}

	self.mopidy = new Mopidy();
	self.mopidy.on(console.log.bind(console));
	self.mopidy.on("state:online", self.getCurrentTrackAndPlaybackState);
	self.mopidy.on("event:playbackStateChanged", self.playbackStateChanged);
	self.mopidy.on("event:trackPlaybackStarted", self.getCurrentTrack);
}
