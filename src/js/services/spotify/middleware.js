
import ReactGA from 'react-ga'

var helpers = require('./../../helpers')
var spotifyActions = require('./actions')
var uiActions = require('../ui/actions')
var pusherActions = require('../pusher/actions')

const SpotifyMiddleware = (function(){

    /**
     * The actual middleware inteceptor
     **/
    return store => next => action => {
        var state = store.getState();

        switch(action.type){

            case 'SPOTIFY_CONNECTED':
                var label = null
                if (store.getState().spotify.me){
                    if (store.getState().core.anonymise_analytics){
                        label = "anonymised_"+store.getState().pusher.client_id;
                    } else {
                        label = store.getState().spotify.me.id;
                    }
                }
                ReactGA.event({ category: 'Spotify', action: 'Connected', label: label })

                // TODO: remove this so we don't tap out our API limits before we even get started
                // Perhaps fire this on demand? Context menu, playlists loading or AddToPlaylistModal
                if (store.getState().spotify_authorized){
                    store.dispatch(spotifyActions.getAllLibraryPlaylists())
                }

                next(action);
                break

            case 'SPOTIFY_AUTHORIZATION_GRANTED':
                ReactGA.event({ category: 'Spotify', action: 'Authorization granted'});

                // Flush out the previous user's library
                store.dispatch(spotifyActions.flushLibrary());

                next(action);
                break;

            case 'SPOTIFY_AUTHORIZATION_REVOKED':
                var label = null
                if (store.getState().spotify.me){
                    if (store.getState().core.anonymise_analytics){
                        label = "anonymised_"+store.getState().pusher.client_id;
                    } else {
                        label = store.getState().spotify.me.id;
                    }
                }
                ReactGA.event({ category: 'Spotify', action: 'Authorization revoked', label: label})
                next(action)

                // Now dispatch a getMe to get the backend-provided user
                store.dispatch(spotifyActions.getMe());

                // Flush out the previous user's library
                store.dispatch(spotifyActions.flushLibrary());

                break;

            case 'SPOTIFY_IMPORT_AUTHORIZATION':
                var label = null;
                if (action.me && action.me.id){
                    if (store.getState().core.anonymise_analytics){
                        label = "anonymised_"+store.getState().pusher.client_id;
                    } else {
                        label = action.me.id;
                    }
                }
                ReactGA.event({ category: 'Spotify', action: 'Authorization imported', label: label });

                // Flush out the previous user's library
                store.dispatch(spotifyActions.flushLibrary());

                next(action);
                break;

            case 'SPOTIFY_RECOMMENDATIONS_LOADED':
                if (action.seeds_uris){
                    ReactGA.event({ category: 'Spotify', action: 'Recommendations', label: action.seeds_uris.join(',') })
                }
                next(action)
                break;

            case 'SPOTIFY_USER_LOADED':
                if (action.data) ReactGA.event({ category: 'User', action: 'Load', label: action.data.uri })
                next(action)
                break;

            case 'SPOTIFY_CREATE_PLAYLIST':
                store.dispatch(spotifyActions.createPlaylist(action.name, action.description, action.is_private, action.is_collaborative ))
                break;

            case 'SPOTIFY_REMOVE_PLAYLIST_TRACKS':
                var playlist = Object.assign({},state.core.playlists[action.key]);
                store.dispatch(spotifyActions.deleteTracksFromPlaylist(playlist.uri, playlist.snapshot_id, action.tracks_indexes ))
                break;


            case 'SPOTIFY_ADD_PLAYLIST_TRACKS':
                store.dispatch(spotifyActions.addTracksToPlaylist(action.key, action.tracks_uris ))
                break;


            case 'SPOTIFY_REORDER_PLAYLIST_TRACKS':
                store.dispatch(spotifyActions.reorderPlaylistTracks(action.key, action.range_start, action.range_length, action.insert_before, action.snapshot_id ))
                break;


            case 'SPOTIFY_SAVE_PLAYLIST':
                store.dispatch(spotifyActions.savePlaylist(action.key, action.name, action.description, action.is_public, action.is_collaborative ))
                break;

            case 'SPOTIFY_NEW_RELEASES_LOADED':
                store.dispatch({
                    type: 'ALBUMS_LOADED',
                    albums: action.data.albums.items
                });
                store.dispatch({
                    type: 'NEW_RELEASES_LOADED',
                    uris: helpers.arrayOf('uri',action.data.albums.items),
                    more: action.data.albums.next,
                    total: action.data.albums.total
                });
                break

            case 'SPOTIFY_ARTIST_ALBUMS_LOADED':
                store.dispatch({
                    type: 'ALBUMS_LOADED',
                    albums: action.data.items
                });
                store.dispatch({
                    type: 'ARTIST_ALBUMS_LOADED',
                    key: action.key,
                    uris: helpers.arrayOf('uri',action.data.items),
                    more: action.data.next,
                    total: action.data.total
                });
                break

            case 'SPOTIFY_USER_PLAYLISTS_LOADED':
                var playlists = []
                for(var i = 0; i < action.data.items.length; i++){
                    var playlist = Object.assign(
                        {},
                        action.data.items[i],
                        {
                            tracks_total: action.data.items[i].tracks.total
                        }
                    )

                    // remove our tracklist. It'll overwrite any full records otherwise
                    delete playlist.tracks

                    playlists.push(playlist)
                }

                store.dispatch({
                    type: 'PLAYLISTS_LOADED',
                    playlists: playlists
                });

                store.dispatch({
                    type: 'USER_PLAYLISTS_LOADED',
                    key: action.key,
                    uris: helpers.arrayOf('uri',playlists),
                    more: action.data.next,
                    total: action.data.total
                });
                break

            case 'SPOTIFY_CATEGORY_PLAYLISTS_LOADED':
                var playlists = []
                for(var i = 0; i < action.data.playlists.items.length; i++){
                    var playlist = Object.assign(
                        {},
                        action.data.playlists.items[i],
                        {
                            tracks_total: action.data.playlists.items[i].tracks.total
                        }
                    )

                    // remove our tracklist. It'll overwrite any full records otherwise
                    delete playlist.tracks

                    playlists.push(playlist)
                }

                store.dispatch({
                    type: 'PLAYLISTS_LOADED',
                    playlists: playlists
                });

                store.dispatch({
                    type: 'CATEGORY_PLAYLISTS_LOADED',
                    key: action.key,
                    uris: helpers.arrayOf('uri',playlists),
                    more: action.data.playlists.next,
                    total: action.data.playlists.total
                });
                break

            case 'SPOTIFY_FAVORITES_LOADED':
                if (action.artists.length > 0){
                    store.dispatch({
                        type: 'ARTISTS_LOADED',
                        artists: action.artists
                    })
                    action.artists_uris = helpers.arrayOf('uri',action.artists)
                }
                if (action.tracks.length > 0){
                    store.dispatch({
                        type: 'TRACKS_LOADED',
                        tracks: action.tracks
                    })
                    action.tracks_uris = helpers.arrayOf('uri',action.tracks)
                }
                next(action)
                break

            case 'SPOTIFY_TRACK_LOADED':
                store.dispatch({
                    type: 'TRACKS_LOADED',
                    tracks: [action.data]
                });
                next(action);
                break


            /**
             * Searching
             * More results are lazy-loaded on demand, based on the _more URL
             **/

            case 'SEARCH_STARTED':
                store.dispatch({ 
                    type: 'SPOTIFY_CLEAR_SEARCH_RESULTS'
                });
                next(action)
                break

            case 'SPOTIFY_SEARCH_RESULTS_LOADED_MORE_TRACKS':
                store.dispatch({
                    type: 'SPOTIFY_SEARCH_RESULTS_LOADED',
                    context: 'tracks',
                    results: action.data.tracks.items,
                    more: action.data.tracks.next
                });
                break

            case 'SPOTIFY_SEARCH_RESULTS_LOADED_MORE_ARTISTS':
                
                store.dispatch({
                    type: 'ARTISTS_LOADED',
                    artists: action.data.artists.items
                });

                store.dispatch({
                    type: 'SPOTIFY_SEARCH_RESULTS_LOADED',
                    context: 'artists',
                    results: helpers.arrayOf('uri',action.data.playlists.items),
                    more: action.data.playlists.next
                });
                break

            case 'SPOTIFY_SEARCH_RESULTS_LOADED_MORE_ALBUMS':

                store.dispatch({
                    type: 'ALBUMS_LOADED',
                    albums: action.data.albums.items
                });

                store.dispatch({
                    type: 'SPOTIFY_SEARCH_RESULTS_LOADED',
                    context: 'playlists',
                    results: helpers.arrayOf('uri',action.data.albums.items),
                    more: action.data.albums.next
                });
                break

            case 'SPOTIFY_SEARCH_RESULTS_LOADED_MORE_PLAYLISTS':

                var playlists = []
                for (var i = 0; i < action.data.playlists.items.length; i++){
                    playlists.push(Object.assign(
                        {},
                        action.data.playlists.items[i],
                        {
                            tracks_total: action.data.playlists.items[i].tracks.total
                        }
                    ))
                }

                store.dispatch({
                    type: 'PLAYLISTS_LOADED',
                    playlists: playlists
                });

                store.dispatch({
                    type: 'SPOTIFY_SEARCH_RESULTS_LOADED',
                    context: 'playlists',
                    results: helpers.arrayOf('uri',action.data.playlists.items),
                    more: action.data.playlists.next
                });
                break


            case 'SPOTIFY_ME_LOADED':

                var label = null;
                if (store.getState().core.anonymise_analytics){
                    label = "anonymised_"+store.getState().pusher.client_id;
                } else {    
                    ReactGA.set({userId: action.data.id});
                    label = action.data.id;
                }
                ReactGA.event({category: 'Spotify', action: 'Authorization verified', label: label});

                store.dispatch({
                    type: 'USERS_LOADED',
                    users: [action.data]
                });

                next(action);
                break;

            // This action is irrelevant to us, pass it on to the next middleware
            default:
                return next(action);
        }
    }

})();

export default SpotifyMiddleware