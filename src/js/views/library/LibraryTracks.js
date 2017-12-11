
import React, { PropTypes } from 'react'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import { Link } from 'react-router'

import TrackList from '../../components/TrackList'
import Header from '../../components/Header'
import LazyLoadListener from '../../components/LazyLoadListener'

import * as helpers from '../../helpers'
import * as mopidyActions from '../../services/mopidy/actions'
import * as spotifyActions from '../../services/spotify/actions'

class LibraryTracks extends React.Component{

	constructor(props){
		super(props);
	}

	// on render
	componentDidMount(){
		if (this.props.library_tracks === undefined){
			this.props.spotifyActions.getLibraryTracks();
		}
	}

	loadMore(){
		this.props.spotifyActions.getMore(
			this.props.library_tracks_more,
			null,
			{
				type: 'SPOTIFY_LIBRARY_TRACKS_LOADED_MORE'
			}
		);
	}

	render(){
		if (helpers.isLoading(this.props.load_queue,['spotify_me/tracks'])){
			return (
				<div className="view library-tracks-view">
					<Header icon="music" title="My tracks" />
					<div className="body-loader loading">
						<div className="loader"></div>
					</div>
				</div>
			)
		}

		var tracks = [];
		if (this.props.library_tracks && this.props.tracks){
			for (var i = 0; i < this.props.library_tracks.length; i++){
				var uri = this.props.library_tracks[i]
				if (this.props.tracks.hasOwnProperty(uri)){
					tracks.push(this.props.tracks[uri])
				}
			}
		}

		return (
			<div className="view library-tracks-view">
				<Header icon="music" title="My tracks" />
				<section className="content-wrapper">
					<TrackList tracks={tracks} />
					<LazyLoadListener loading={this.props.library_tracks_more} loadMore={() => this.loadMore()}/>
				</section>
			</div>
		);
	}
}


/**
 * Export our component
 *
 * We also integrate our global store, using connect()
 **/

const mapStateToProps = (state, ownProps) => {
	return {
		load_queue: state.ui.load_queue,
		tracks: state.core.tracks,
		library_tracks: state.spotify.library_tracks,
		library_tracks_more: state.spotify.library_tracks_more
	}
}

const mapDispatchToProps = (dispatch) => {
	return {
		mopidyActions: bindActionCreators(mopidyActions, dispatch),
		spotifyActions: bindActionCreators(spotifyActions, dispatch)
	}
}

export default connect(mapStateToProps, mapDispatchToProps)(LibraryTracks)