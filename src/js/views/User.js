
import React, { PropTypes } from 'react'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import FontAwesome from 'react-fontawesome'

import Thumbnail from '../components/Thumbnail'
import PlaylistGrid from '../components/PlaylistGrid'
import LazyLoadListener from '../components/LazyLoadListener'
import Parallax from '../components/Parallax'
import ContextMenuTrigger from '../components/ContextMenuTrigger'

import * as helpers from '../helpers'
import * as mopidyActions from '../services/mopidy/actions'
import * as spotifyActions from '../services/spotify/actions'

class User extends React.Component{

	constructor(props){
		super(props);
	}

	componentDidMount(){
		this.loadUser();
	}

	componentWillReceiveProps(nextProps){
		if (nextProps.params.uri != this.props.params.uri){
			this.loadUser(nextProps);
		}
	}

	loadUser(props = this.props){
		if (!props.user){
			this.props.spotifyActions.getUser(props.params.uri, true);
		}
	}

	loadMore(){
		this.props.spotifyActions.getMore(
			this.props.user.playlists_more,
			{
				parent_type: 'user',
				parent_key: this.props.params.uri,
				records_type: 'playlist'
			}
		);
	}

	isMe(){
		let userid = helpers.getFromUri('userid',this.props.params.uri);
		return (this.props.me && this.props.me.id && this.props.me.id == userid);
	}

	render(){
		var user_id = helpers.getFromUri('userid',this.props.params.uri)
		if (helpers.isLoading(this.props.load_queue,['spotify_users/'+user_id,'spotify_users/'+user_id+'/playlists/?'])){
			return (
				<div className="body-loader">
					<div className="loader"></div>
				</div>
			)
		}

		if (!this.props.user){
			return null;
		}

		var playlists = [];
		if (this.props.user.playlists_uris){
			for (var i = 0; i < this.props.user.playlists_uris.length; i++){
				var uri = this.props.user.playlists_uris[i]
				if (this.props.playlists.hasOwnProperty(uri)){
					playlists.push(this.props.playlists[uri])
				}
			}
		}

		if (this.props.user && this.props.user.images){
			var image = helpers.sizedImages(this.props.user.images).huge
		} else {
			var image = null
		}

		return (
			<div className="view user-view">
				<div className="intro">
					<Parallax image={image} />
					<div className="liner">
						<h1>{ this.props.user.display_name ? this.props.user.display_name : this.props.user.id }</h1>
						<h2>
							<ul className="details">
								{this.props.user.playlists_total ? <li>{this.props.user.playlists_total ? this.props.user.playlists_total.toLocaleString() : 0} playlists</li> : null}
								{this.props.user.followers ? <li>{this.props.user.followers.total.toLocaleString()} followers</li> : null}
								{this.isMe() ? <li><span className="blue-text">You</span></li> : null}
							</ul>
						</h2>
					</div>
				</div>
				
				<div className="content-wrapper">
					<section className="grid-wrapper">
						<h4>Playlists</h4>
						<PlaylistGrid playlists={playlists} />
						<LazyLoadListener loading={this.props.user.playlists_more} loadMore={() => this.loadMore()} />
					</section>
				</div>
			</div>
		)
	}
}

const mapStateToProps = (state, ownProps) => {
	var uri = ownProps.params.uri;
	return {
		load_queue: state.ui.load_queue,
		spotify_authorized: state.spotify.authorization,
		me: state.spotify.me,
		playlists: state.core.playlists,
		user: (state.core.users[uri] !== undefined ? state.core.users[uri] : false)
	};
}

const mapDispatchToProps = (dispatch) => {
	return {
		spotifyActions: bindActionCreators(spotifyActions, dispatch)
	}
}

export default connect(mapStateToProps, mapDispatchToProps)(User)