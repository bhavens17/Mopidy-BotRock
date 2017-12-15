
var coreActions = require('../../services/core/actions')
var uiActions = require('../../services/ui/actions')
var mopidyActions = require('../../services/mopidy/actions')
var lastfmActions = require('../../services/lastfm/actions')
var helpers = require('../../helpers')

/**
 * Send an ajax request to the Spotify API
 *
 * @param dispatch obj
 * @param getState obj
 * @param endpoint string = the url to query (ie /albums/:uri)
 * @param method string
 * @param data mixed = request payload
 * @return Promise
 **/
const sendRequest = (dispatch, getState, endpoint, method = 'GET', data = false) => {

    return new Promise((resolve, reject) => {         
        getToken(dispatch, getState )
            .then(
                response => {

                    // prepend the API baseurl, unless the endpoint already has it (ie pagination requests)
                    var url = 'https://api.spotify.com/v1/'+endpoint
                    if (endpoint.startsWith('https://api.spotify.com/')){
                        url = endpoint;
                    }

                    // create our ajax request config
                    var config = {
                        method: method,
                        url: url,
                        cached: true,
                        timeout: 30000,
                        headers: {
                            Authorization: 'Bearer '+ response,
                            Accept: 'application/json'
                        }
                    }

                    // only if we've got data do we add it to the request (this prevents appending of "&false" to the URL)
                    if (data){
                        if (typeof(data) === 'string'){
                            config.data = data
                        } else {
                            config.data = JSON.stringify(data)
                        }
                    }

                    // add reference to loader queue
                    var loader_key = helpers.generateGuid()
                    dispatch(uiActions.startLoading(loader_key, 'spotify_'+endpoint))

                    $.ajax(config).then(
                            response => {
                                dispatch(uiActions.stopLoading(loader_key))                            
                                resolve(response)
                            },
                            (xhr, status, error) => {
                                dispatch(uiActions.stopLoading(loader_key))

                                // TODO: Instead of allowing request to fail before renewing the token, once refreshed
                                // we should retry the original request(s)
                                if (xhr.responseJSON.error.message == 'The access token expired'){
                                    dispatch(refreshToken(dispatch, getState))
                                }

                                reject({
                                    config: config,
                                    xhr: xhr,
                                    status: status,
                                    error: error
                                });
                            }
                        )
                },
                error => {
                    reject(error)
                }
            );
        }
    );
}


/**
* Check an access token validity
*
* @return Promise
**/
function getToken(dispatch, getState){
    return new Promise((resolve, reject) => {

        // token is okay for now, so just resolve with the current token
        if (getState().spotify.token_expiry && new Date().getTime() < getState().spotify.token_expiry){
            resolve(getState().spotify.access_token)
            return
        }

        // token is expiring/expired, so go get a new one and resolve that
        refreshToken(dispatch, getState)
            .then(
                response => {
                    resolve(response.access_token)
                },
                error => {
                    reject(error)
                }
            );
    });
}

function refreshToken(dispatch, getState){
    return new Promise((resolve, reject) => {

        if (getState().spotify.authorization){

            var config = {
                method: 'GET',
                url: getState().spotify.authorization_url+'?action=refresh&refresh_token='+getState().spotify.refresh_token,
                dataType: "json",
                timeout: 10000
            };

            $.ajax(config)
                .then(
                    response => {
                        response.token_expiry = new Date().getTime() + (response.expires_in * 1000 )
                        response.source = 'spotify'
                        dispatch({
                            type: 'SPOTIFY_TOKEN_REFRESHED',
                            data: response
                        })
                        resolve(response)
                    },
                    (xhr, status, error) => {
                        dispatch({ type: 'SPOTIFY_DISCONNECTED' })
                        reject({
                            config: config,
                            xhr: xhr,
                            status: status,
                            error: error
                        });
                    }
                );

        } else {

            var config = {
                method: 'GET',
                url: 'http' + (getState().mopidy.ssl ? 's' : '') + '://'+getState().mopidy.host+':'+getState().mopidy.port+'/botrock/http/refresh_spotify_token',
                dataType: "json",
                timeout: 10000
            }

            $.ajax(config)
                .then(
                    response => {
                        var token = response.spotify_token;
                        token.token_expiry = new Date().getTime() + (token.expires_in * 1000 );
                        token.source = 'mopidy';
                        dispatch({
                            type: 'SPOTIFY_TOKEN_REFRESHED',
                            access_token_provider: 'backend',
                            data: token
                        });
                        resolve(token);

                    },
                    (xhr, status, error) => {
                        dispatch({ type: 'SPOTIFY_DISCONNECTED' })
                        reject({
                            config: config,
                            xhr: xhr,
                            status: status,
                            error: error
                        });
                    }
                );
        }

    })
}

export function set(data){
    return {
        type: 'SPOTIFY_SET',
        data: data
    }
}

export function connect(){
    return (dispatch, getState) => {
        dispatch({ type: 'SPOTIFY_CONNECTING' });
        dispatch(getMe());
    }
}


/**
 * Handle authorization process
 **/

export function authorizationGranted(data){
    data.token_expiry = new Date().getTime() + data.expires_in;
    return { type: 'SPOTIFY_AUTHORIZATION_GRANTED', data: data }
}

export function revokeAuthorization(){
    return { type: 'SPOTIFY_AUTHORIZATION_REVOKED' }
}

export function refreshingToken(){
    return (dispatch, getState) => {
        dispatch({ type: 'SPOTIFY_TOKEN_REFRESHING' });
        refreshToken(dispatch, getState );
    }
}

export function importAuthorization(data){
    return {
        type: 'SPOTIFY_IMPORT_AUTHORIZATION',
        user: data.user,
        authorization: data.authorization
    }
}


/**
 * Get current user
 **/
export function getMe(){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, 'me' )
            .then(
                response => {
                    dispatch({
                        type: 'SPOTIFY_ME_LOADED',
                        data: response
                    });
                    dispatch({ type: 'SPOTIFY_CONNECTED' });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load your profile',
                        error
                    ));
                    dispatch({ type: 'SPOTIFY_DISCONNECTED' });
                }
            );
    }
}


/**
 * Get a single track
 *
 * @param uri string
 **/
export function getTrack(uri){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, 'tracks/'+ helpers.getFromUri('trackid', uri))
            .then(
                response => {
                    let track = Object.assign(
                        {},
                        response,
                        {
                            images: response.album.images
                        }
                    )

                    dispatch({
                        type: 'TRACK_LOADED',
                        key: uri,
                        track: track
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load track',
                        error
                    ));
                }
            );
    }
}

export function getFeaturedPlaylists(){
    return (dispatch, getState) => {

        dispatch({ type: 'SPOTIFY_FEATURED_PLAYLISTS_LOADED', data: false });

        var date = new Date();
        date.setHours(date.getHours() - 1);
        var year = date.getFullYear();
        var month = date.getMonth();
        if (month < 10 ) month = '0'+month;
        var day = date.getDay();
        if (day < 10 ) day = '0'+day;
        var hour = date.getHours();
        if (hour < 10 ) hour = '0'+hour;
        var min = date.getMinutes();
        if (min < 10 ) min = '0'+min;
        var sec = date.getSeconds();
        if (sec < 10 ) sec = '0'+sec;

        var timestamp = year+'-'+month+'-'+day+'T'+hour+':'+min+':'+sec;

        sendRequest(dispatch, getState, 'browse/featured-playlists?country='+getState().core.country+'&limit=50&locale='+getState().core.locale+'&timestamp='+timestamp)
            .then(
                response => {
                    var playlists = []
                    for (var i = 0; i < response.playlists.items.length; i++){
                        playlists.push(Object.assign(
                            {},
                            response.playlists.items[i],
                            {
                                can_edit: (getState().spotify.me && response.playlists.items[i].owner.id == getState().spotify.me.id),
                                tracks_total: response.playlists.items[i].tracks.total
                            }
                        ))
                    }

                    // Pick the first playlist, and get the full playlist object
                    // We use this as in our introduction parallax panel, and need the full playlist
                    dispatch(getPlaylist(playlists[0].uri))

                    dispatch({
                        type: 'PLAYLISTS_LOADED',
                        playlists: playlists
                    });

                    dispatch({
                        type: 'SPOTIFY_FEATURED_PLAYLISTS_LOADED',
                        data: {
                            message: response.message,
                            playlists: helpers.arrayOf('uri',response.playlists.items)
                        }
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load featured playlists',
                        error
                    ));
                }
            );
    }
}

export function getCategories(){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, 'browse/categories?limit=50&country='+getState().core.country+'&locale='+getState().core.locale )
            .then(
                response => {
                    dispatch({
                        type: 'CATEGORIES_LOADED',
                        categories: response.categories.items
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load categories',
                        error
                    ));
                }
            );
    }
}

export function getCategory(id){
    return (dispatch, getState) => {

        dispatch({
            type: 'CATEGORY_LOADED',
            key: 'category:'+id,
            category: {
                playlists_uris: null
            }
        });

        // get the category
        sendRequest(dispatch, getState, 'browse/categories/'+id+'?country='+getState().core.country+'&locale='+getState().core.locale )
            .then(
                response => {
                    var category = Object.assign({}, response)
                    dispatch({
                        type: 'CATEGORY_LOADED',
                        key: 'category:'+id,
                        category: Object.assign({}, response)
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load category',
                        error
                    ));
                }
            )

        // and the category's playlists
        sendRequest(dispatch, getState, 'browse/categories/'+id+'/playlists?limit=50&country='+getState().core.country+'&locale='+getState().core.locale )
            .then(
                response => {
                    var playlists = []
                    for (var i = 0; i < response.playlists.items.length; i++){
                        playlists.push(Object.assign(
                            {},
                            response.playlists.items[i],
                            {
                                tracks: null,
                                tracks_more: null,
                                tracks_total: response.playlists.items[i].tracks.total
                            }
                        ))
                    }

                    dispatch({
                        type: 'PLAYLISTS_LOADED',
                        playlists: playlists
                    });

                    dispatch({
                        type: 'SPOTIFY_CATEGORY_PLAYLISTS_LOADED',
                        key: 'category:'+id,
                        data: response
                    });                
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load category playlists',
                        error
                    ));
                }
            )
    }
}

export function getNewReleases(){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, 'browse/new-releases?country='+getState().core.country+'&limit=50' )
            .then(
                response => {
                    dispatch({
                        type: 'SPOTIFY_NEW_RELEASES_LOADED',
                        data: response
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load new releases',
                        error
                    ));
                }
            );
    }
}

export function getURL(url, action_name, key = false){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, url )
            .then(
                response => {
                    dispatch({
                        type: action_name,
                        key: key,
                        data: response
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load URL',
                        error
                    ));
                }
            );
    }
}

export function getMore(url, core_action = null, custom_action = null){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, url)
            .then(
                response => {
                    if (core_action){
                        dispatch(coreActions.loadedMore(
                            core_action.parent_type,
                            core_action.parent_key,
                            core_action.records_type,
                            response
                        ));
                    } else if (custom_action){
                        custom_action.data = response;
                        dispatch(custom_action);
                    } else {
                        dispatch(coreActions.handleException(
                            'No callback handler for loading more items'
                        ));
                    }
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load more '+callback_action.parent_type+' '+callback_action.records_type+'s',
                        error
                    ));
                }
            );
    }
}

export function clearSearchResults(){
    return {
        type: 'SPOTIFY_CLEAR_SEARCH_RESULTS'
    }
}

export function getSearchResults(type, query, limit = 50, offset = 0){
    return (dispatch, getState) => {

        dispatch(uiActions.startProcess('SPOTIFY_GET_SEARCH_RESULTS_PROCESSOR','Searching Spotify'))

        type = type.replace(/s+$/, "")
        if (type == 'all'){
            type = 'album,artist,track'
        }

        var url = 'search?q='+query
        url += '&type='+type
        url += '&country='+getState().core.country
        url += '&limit='+limit
        url += '&offset='+offset

        sendRequest(dispatch, getState, url )
            .then(
                response => {                
                    if (response.tracks !== undefined){
                        dispatch({
                            type: 'SPOTIFY_SEARCH_RESULTS_LOADED',
                            context: 'tracks',
                            results: response.tracks.items,
                            more: response.tracks.next,
                        });
                    }
                    
                    if (response.artists !== undefined){
                        dispatch({
                            type: 'ARTISTS_LOADED',
                            artists: response.artists.items
                        });
                        dispatch({
                            type: 'SPOTIFY_SEARCH_RESULTS_LOADED',
                            context: 'artists',
                            results: helpers.arrayOf('uri',response.artists.items),
                            more: response.artists.next,
                        });
                    }
                    
                    if (response.albums !== undefined){
                        dispatch({
                            type: 'ALBUMS_LOADED',
                            albums: response.albums.items
                        });
                        dispatch({
                            type: 'SPOTIFY_SEARCH_RESULTS_LOADED',
                            context: 'albums',
                            results: helpers.arrayOf('uri',response.albums.items),
                            more: response.albums.next,
                        });
                    }

                    if (response.playlists !== undefined){
                        var playlists = []
                        for (var i = 0; i < response.playlists.items.length; i++){
                            playlists.push(Object.assign(
                                {},
                                response.playlists.items[i],
                                {
                                    can_edit: (getState().spotify.me && response.playlists.items[i].owner.id == getState().spotify.me.id),
                                    tracks_total: response.playlists.items[i].tracks.total
                                }
                            ))
                        }
                        dispatch({
                            type: 'PLAYLISTS_LOADED',
                            playlists: playlists
                        });

                        dispatch({
                            type: 'SPOTIFY_SEARCH_RESULTS_LOADED',
                            context: 'playlists',
                            results: helpers.arrayOf('uri',playlists),
                            more: response.playlists.next
                        });
                    }

                    dispatch(uiActions.processFinished('SPOTIFY_GET_SEARCH_RESULTS_PROCESSOR'))
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load search results',
                        error
                    ));
                }
            );
    }
}

export function getAutocompleteResults(field_id, query, types = ['album','artist','playlist','track']){
    return (dispatch, getState) => {

        dispatch({type: 'SPOTIFY_AUTOCOMPLETE_LOADING', field_id: field_id})

        var genre_included = types.includes('genre')
        if (genre_included){
            var index = types.indexOf('genre')
            types.splice(index,1)
        }

        var endpoint = 'search?q='+query
        endpoint += '&type='+types.join(',')
        endpoint += '&country='+getState().core.country

        sendRequest(dispatch, getState, endpoint)
            .then(
                response => {
                    var genres = []
                    if (genre_included){
                        var available_genres = getState().ui.genres
                        if (available_genres){
                            for (var i = 0; i < available_genres.length; i++){
                                if (available_genres[i].includes(query)){
                                    var genre = available_genres[i]
                                    genres.push({
                                        name: (genre.charAt(0).toUpperCase()+genre.slice(1)).replace('-',' '),
                                        uri: 'spotify:genre:'+genre
                                    })
                                }
                            }
                        }
                    }
                    dispatch({
                        type: 'SPOTIFY_AUTOCOMPLETE_LOADED',
                        field_id: field_id,
                        results: {
                            artists: (response.artists ? response.artists.items : []),
                            albums: (response.albums ? response.albums.items : []),
                            playlists: (response.playlists ? response.playlists.items : []),
                            tracks: (response.tracks ? response.tracks.items : []),
                            genres: genres
                        }
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load autocomplete results',
                        error
                    ));
                }
            );
    }
}

export function clearAutocompleteResults(field_id = null){
    return {
        type: 'SPOTIFY_AUTOCOMPLETE_CLEAR',
        field_id: field_id
    }
}

/**
 * Resolve radio seeds into full objects
 *
 * @param radio object
 **/
export function resolveRadioSeeds(radio){
    return (dispatch, getState) => {

        if (radio.seed_artists.length > 0){
            var artist_ids = '';
            for (var i = 0; i < radio.seed_artists.length; i++){
                if (i > 0) artist_ids += ','
                artist_ids += helpers.getFromUri('artistid', radio.seed_artists[i])
            }

            sendRequest(dispatch, getState, 'artists?ids='+ artist_ids )
            .then(
                response => {
                    if (response && response.artists){
                        dispatch({
                            type: 'ARTISTS_LOADED',
                            artists: response.artists
                        })
                    } else {
                        console.error('No Spotify artists returned', artist_ids)
                    }
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not resolve radio artist seeds',
                        error
                    ));
                }
            )
        }

        if (radio.seed_tracks.length > 0){
            var track_ids = '';
            for (var i = 0; i < radio.seed_tracks.length; i++){
                if (i > 0) track_ids += ','
                track_ids += helpers.getFromUri('trackid', radio.seed_tracks[i])
            }
            
            sendRequest(dispatch, getState, 'tracks?ids='+ track_ids )
            .then(
                response => {
                    dispatch({
                        type: 'TRACKS_LOADED',
                        tracks: response.tracks
                    })
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load radio track seeds',
                        error
                    ));
                }
            )
        }
    }
}


/**
 * =============================================================== DISCOVER =============
 * ======================================================================================
 **/


/**
 * Get my favorites
 *
 * @param uri string
 **/
export function getFavorites(limit = 50, term = 'long_term'){
    return (dispatch, getState) => {

        dispatch({type: 'SPOTIFY_FAVORITES_LOADED', artists: [], tracks: []})

        $.when(
            sendRequest(dispatch, getState, 'me/top/artists?limit='+limit+'&time_range='+term),
            sendRequest(dispatch, getState, 'me/top/tracks?limit='+limit+'&time_range='+term)

        ).then(
            (artists_response, tracks_response) => {
                dispatch({
                    type: 'SPOTIFY_FAVORITES_LOADED',
                    artists: artists_response.items,
                    tracks: tracks_response.items
                });
            },
            (artists_error, tracks_error) => {
                dispatch(coreActions.handleException(
                    'Could not load favorites',
                    Object.assign({},artists_error,tracks_error)
                ));
            }
        )
    }
}


/**
 * Get our recommendations
 * This is based off our 'favorites' and then we use those as seeds
 *
 * @param uris = array of artist or track URIs or a genre string
 **/
export function getRecommendations(uris = [], limit = 20){
    return (dispatch, getState) => {

        dispatch({type: 'CLEAR_SPOTIFY_RECOMMENDATIONS'});

        // build our starting point
        var artists_ids = []
        var tracks_ids = []
        var genres = []

        for (var i = 0; i < uris.length; i++){
            var uri = uris[i]

            switch (helpers.uriType(uri)){
                
                case 'artist':
                    artists_ids.push(helpers.getFromUri('artistid',uri))
                    break

                case 'track':
                    tracks_ids.push(helpers.getFromUri('trackid',uri))
                    break

                case 'genre':
                    genres.push(helpers.getFromUri('genreid',uri))
                    break

                case 'default':
                    genres.push(uri)
                    break
            }
        }

        // construct our endpoint URL with all the appropriate arguments
        var endpoint = 'recommendations'
        endpoint += '?seed_artists='+artists_ids.join(',')
        endpoint += '&seed_tracks='+tracks_ids.join(',')
        endpoint += '&seed_genres='+genres.join(',')
        endpoint += '&limit='+limit

        sendRequest(dispatch, getState, endpoint)
            .then(
                response => {
                    var tracks = Object.assign([], response.tracks);

                    // We only get simple artist objects, so we need to
                    // get the full object. We'll add URIs to our recommendations
                    // anyway so we can proceed in the meantime
                    var artists_uris = []
                    if (tracks.length > artists_ids.length && tracks.length > 10){
                        while (artists_uris.length < 5){
                            var random_index = Math.round(Math.random() * (tracks.length - 1))
                            var artist = tracks[random_index].artists[0]

                            // Make sure this artist is not already in our sample, and
                            // is not one of the seeds
                            if (!artists_uris.includes(artist.uri) && !artists_ids.includes(artist.id)){
                                artists_uris.push(artist.uri)
                                dispatch(getArtist(artist.uri))
                            }
                        }
                    }

                    // Copy already loaded albums into array
                    var albums = []
                    var albums_uris = []
                    if (tracks.length > 10){
                        while (albums.length < 5){
                            var random_index = Math.round(Math.random() * (tracks.length - 1))
                            var album = tracks[random_index].album

                            // Make sure this album is not already in our sample
                            if (!albums_uris.includes(album.uri)){
                                albums_uris.push(album.uri)
                                albums.push(album)
                            }
                        }
                    }
                    
                    if (albums.length > 0){
                        dispatch({
                            type: 'ALBUMS_LOADED',
                            albums: albums
                        });
                    }

                    if (tracks.length > 0){
                        dispatch({
                            type: 'TRACKS_LOADED',
                            tracks: tracks
                        });
                    }

                    dispatch({
                        type: 'SPOTIFY_RECOMMENDATIONS_LOADED',
                        seeds_uris: uris,
                        tracks_uris: helpers.arrayOf('uri',tracks),
                        artists_uris: artists_uris,
                        albums_uris: helpers.arrayOf('uri',albums)
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load recommendations',
                        error
                    ));
                }
            )
    }
}


/**
 * Get all the available genres
 *
 * @param uri string
 **/
export function getGenres(){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, 'recommendations/available-genre-seeds')
            .then(
                response => {
                    dispatch({
                        type: 'SPOTIFY_GENRES_LOADED',
                        genres: response.genres
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load genres',
                        error
                    ));
                }
            )
    }
}




/**
 * =============================================================== ARTIST(S) ============
 * ======================================================================================
 **/

/**
 * Get a single artist
 *
 * @param uri string
 * @param full boolean (whether we want a full artist object)
 **/
export function getArtist(uri, full = false){
    return (dispatch, getState) => {

        // Start with an empty object
        // As each requests completes, they'll add to this object
        var artist = {}

        // We need our artist, obviously
        var requests = [        
            sendRequest(dispatch, getState, 'artists/'+ helpers.getFromUri('artistid', uri) )
            .then(
                response => {
                    Object.assign(artist, response);
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load artist',
                        error
                    ));
                }
            )
        ];

        // Do we want a full artist, with all supporting material?
        if (full){

            requests.push(
                sendRequest(dispatch, getState, 'artists/'+ helpers.getFromUri('artistid', uri) +'/top-tracks?country='+getState().core.country )
                    .then(
                        response => {
                            Object.assign(artist, response);
                        },
                        error => {
                            dispatch(coreActions.handleException(
                                'Could not load artist\'s top tracks',
                                error
                            ));
                        }
                    )
            );

            requests.push(
                sendRequest(dispatch, getState, 'artists/'+ helpers.getFromUri('artistid', uri) +'/related-artists' )
                .then(
                    response => {
                        dispatch({
                            type: 'ARTISTS_LOADED',
                            artists: response.artists
                        }); 
                        Object.assign(artist, { related_artists_uris: helpers.arrayOf('uri',response.artists) });
                    },
                    error => {
                        dispatch(coreActions.handleException(
                            'Could not load artist\'s related artists',
                            error
                        ));
                    }
                )
            );
        }

        // Run our requests
        $.when.apply($, requests).then(() => {

            if (artist.musicbrainz_id){
                dispatch(lastfmActions.getArtist(artist.uri, false, artist.musicbrainz_id))
            } else {
                dispatch(lastfmActions.getArtist(artist.uri, artist.name.replace('&','and')))
            }

            dispatch({
                type: 'ARTIST_LOADED',
                key: artist.uri,
                artist: artist
            })

            // Now go get our artist albums
            if (full){
                sendRequest(dispatch, getState, 'artists/'+ helpers.getFromUri('artistid', uri) +'/albums?market='+getState().core.country )
                .then(
                    response => {
                        dispatch({
                            type: 'SPOTIFY_ARTIST_ALBUMS_LOADED',
                            data: response,
                            key: uri
                        })
                    },
                    error => {
                        dispatch(coreActions.handleException(
                            'Could not load artist\'s albums',
                            error
                        ));
                    }
                );
            }
        })
    }
}

export function getArtists(uris){
    return (dispatch, getState) => {

        // now get all the artists for this album (full objects)
        var ids = '';
        for(var i = 0; i < uris.length; i++){
            if (ids != '' ) ids += ','
            ids += helpers.getFromUri('artistid', uris[i] );
        }

        sendRequest(dispatch, getState, 'artists/?ids='+ids )
            .then(
                response => {
                    for (var i = i; i < response.length; i++){
                        var artist = response
                        for (var i = 0; i < artist.albums.length; i++){
                            dispatch({
                                type: 'ALBUM_LOADED',
                                album: artist.albums[i]
                            }); 
                        }
                        artist.albums = helpers.arrayOf('uri',artist.albums)
                        artist.albums_more = artist.albums.next
                        dispatch({
                            type: 'ARTIST_LOADED',
                            artist: artist
                        });                    
                    }
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load artists',
                        error
                    ));
                }
            );
    }
}


export function enqueueArtistTopTracks(uri){
    return (dispatch, getState) => {
        const artists = getState().core.artists

        // Do we have this artist (and their tracks) in our index already?
        if (typeof(artists[uri]) !== 'undefined' && typeof(artists[uri].tracks) !== 'undefined'){
            const uris = helpers.arrayOf('uri',artists[uri].tracks)
            dispatch(mopidyActions.enqueueURIs(uris, uri))

        // We need to load the artist's top tracks first
        } else {
            sendRequest(dispatch, getState, 'artists/'+ helpers.getFromUri('artistid', uri) +'/top-tracks?country='+getState().core.country )
            .then(
                response => {
                    const uris = helpers.arrayOf('uri',response.tracks)
                    dispatch(mopidyActions.enqueueURIs(uris, uri))
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not enqueue artist\'s top tracks',
                        error
                    ));
                }
            )
        }
    }
}



/**
 * =============================================================== USER(S) ==============
 * ======================================================================================
 **/

export function getUser(uri, and_playlists = false){
    return (dispatch, getState) => {

        // get the user
        sendRequest(dispatch, getState, 'users/'+ helpers.getFromUri('userid',uri) )
            .then(
                response => {
                    dispatch({
                        type: 'USERS_LOADED',
                        users: [response]
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load user',
                        error
                    ));
                }
            )

        if (and_playlists){
            dispatch(getUserPlaylists(uri));
        }
    }
}

export function getUserPlaylists(user_uri){
    return (dispatch, getState) => {

        // get the first page of playlists
        sendRequest(dispatch, getState, 'users/'+ helpers.getFromUri('userid', user_uri) +'/playlists?limit=40' )
            .then(
                response => {
                    var playlists = []
                    for (var i = 0; i < response.items.length; i++){

                        var can_edit = false
                        if (getState().spotify.me && response.items[i].owner.id == getState().spotify.me.id){
                            can_edit = true
                        }

                        playlists.push(Object.assign(
                            {},
                            response.items[i],
                            {
                                can_edit: can_edit,
                                tracks_total: response.items[i].tracks.total
                            }
                        ))
                    }

                    dispatch({
                        type: 'LOADED_MORE',
                        parent_type: 'user',
                        parent_key: user_uri,
                        records_type: 'playlist',
                        records_data: response
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load user\'s playlists',
                        error
                    ));
                }
            );
    }
}




/**
 * =============================================================== ALBUM(S) =============
 * ======================================================================================
 **/

/**
 * Single album
 *
 * @oaram uri string
 **/
export function getAlbum(uri){
    return (dispatch, getState) => {

        // get the album
        sendRequest(dispatch, getState, 'albums/'+ helpers.getFromUri('albumid', uri) )
            .then(
                response => {

                    // dispatch our loaded artists (simple objects)
                    dispatch({
                        type: 'ARTISTS_LOADED',
                        artists: response.artists
                    });

                    var album = Object.assign(
                        {},
                        response,
                        {
                            artists_uris: helpers.arrayOf('uri',response.artists),
                            tracks: response.tracks.items,
                            tracks_more: response.tracks.next,
                            tracks_total: response.tracks.total
                        }
                    )

                    // add our album to all the tracks
                    for (var i = 0; i < album.tracks.length; i++){
                        album.tracks[i].album = {
                            name: album.name,
                            uri: album.uri
                        }
                    }

                    dispatch({
                        type: 'ALBUM_LOADED',
                        key: album.uri,
                        album: album
                    });

                    // now get all the artists for this album (full objects)
                    // we do this to get the artist artwork
                    var artist_ids = [];
                    for(var i = 0; i < response.artists.length; i++){
                        artist_ids.push(helpers.getFromUri('artistid', response.artists[i].uri ) )
                    }

                    // get all album artists as full objects
                    sendRequest(dispatch, getState, 'artists/?ids='+artist_ids )
                        .then(
                            response => {
                                dispatch({
                                    type: 'ARTISTS_LOADED',
                                    artists: response.artists
                                });
                            },
                            error => {
                                dispatch(coreActions.handleException(
                                    'Could not load album\'s artists',
                                    error
                                ));
                            }
                        );

                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load album',
                        error
                    ));
                }
            )
    }
}



/**
 * =============================================================== PLAYLIST(S) ==========
 * ======================================================================================
 **/

export function createPlaylist(name, description, is_public, is_collaborative){
    return (dispatch, getState) => {

        var data = {
            name: name,
            description: description, 
            public: is_public,
            collaborative: is_collaborative
        }

        sendRequest(dispatch, getState, 'users/'+ getState().spotify.me.id +'/playlists/', 'POST', data)
        .then(
            response => {
                dispatch({
                    type: 'PLAYLIST_LOADED',
                    key: response.uri,
                    playlist: Object.assign(
                        {},
                        response,
                        {
                            can_edit: true,
                            tracks: [],
                            tracks_more: null,
                            tracks_total: 0
                        })
                });

                dispatch(uiActions.createNotification('Created playlist'))
            },
            error => {
                dispatch(coreActions.handleException(
                    'Could not create playlist',
                    error
                ));
            }
        )
    }
}

export function savePlaylist(uri, name, description, is_public, is_collaborative){
    return (dispatch, getState) => {

        var data = {
            name: name,
            description: description, 
            public: is_public,
            collaborative: is_collaborative
        }

        sendRequest(dispatch, getState, 'users/'+ getState().spotify.me.id +'/playlists/'+ helpers.getFromUri('playlistid',uri), 'PUT', data)
        .then(
            response => {
                dispatch({
                    type: 'PLAYLIST_UPDATED',
                    key: uri,
                    playlist: {
                        name: name,
                        public: is_public,
                        collaborative: is_collaborative,
                        description: description
                    }
                })
                dispatch(uiActions.createNotification('Saved'))
            },
            error => {
                dispatch(coreActions.handleException(
                    'Could not save playlist',
                    error
                ));
            }
        )
    }
}

export function getPlaylist(uri){
    return (dispatch, getState) => {

        // get the main playlist object
        sendRequest(dispatch, getState, 'users/'+ helpers.getFromUri('userid',uri) +'/playlists/'+ helpers.getFromUri('playlistid',uri) +'?market='+getState().core.country )
        .then(
            response => {

                // convert links in description
                var description = null
                if (response.description){
                    description = response.description
                    description = description.split('<a href="spotify:artist:').join('<a href="#'+global.baseURL+'artist/spotify:artist:')
                    description = description.split('<a href="spotify:album:').join('<a href="#'+global.baseURL+'album/spotify:album:')
                    description = description.split('<a href="spotify:user:').join('<a href="#'+global.baseURL+'user/spotify:user:')
                }

                var playlist = Object.assign(
                    {},
                    response,
                    {
                        can_edit: (getState().spotify.me && response.owner.id == getState().spotify.me.id),
                        tracks: helpers.formatTracks(response.tracks.items),
                        tracks_more: response.tracks.next,
                        tracks_total: response.tracks.total,
                        description: description
                    }
                )

                dispatch({
                    type: 'PLAYLIST_LOADED',
                    key: playlist.uri,
                    playlist: playlist
                })
            },
            error => {
                dispatch(coreActions.handleException(
                    'Could not load playlist',
                    error
                ));
            }
        )
    }
}

/**
 * Get all tracks for a playlist
 *
 * Recursively get .next until we have all tracks
 **/

export function getPlaylistTracksForPlaying(uri){
    return (dispatch, getState) => {
        dispatch(uiActions.startProcess(
            'SPOTIFY_GET_PLAYLIST_TRACKS_FOR_PLAYING_PROCESSOR',
            'Loading playlist tracks', 
            {
                uri: uri,
                next: 'users/'+ helpers.getFromUri('userid',uri) +'/playlists/'+ helpers.getFromUri('playlistid',uri) +'/tracks?market='+getState().core.country
            }
        ))
    }
}

export function getPlaylistTracksForPlayingProcessor(data){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, data.next)
            .then(
                response => {

                    // Check to see if we've been cancelled
                    if (getState().ui.processes['SPOTIFY_GET_PLAYLIST_TRACKS_FOR_PLAYING_PROCESSOR'] !== undefined){
                        var processor = getState().ui.processes['SPOTIFY_GET_PLAYLIST_TRACKS_FOR_PLAYING_PROCESSOR']

                        if (processor.status == 'cancelling'){
                            dispatch(uiActions.processCancelled('SPOTIFY_GET_PLAYLIST_TRACKS_FOR_PLAYING_PROCESSOR'))
                            return false
                        }
                    }

                    // Add on our new batch of loaded tracks
                    var uris = []
                    var new_uris = []
                    for (var i = 0; i < response.items.length; i++){
                        new_uris.push(response.items[i].track.uri)
                    }
                    if (data.uris){
                        uris = [...data.uris, ...new_uris];
                    } else {
                        uris = new_uris;
                    }

                    // We got a next link, so we've got more work to be done
                    if (response.next){
                        dispatch(uiActions.updateProcess(
                            'SPOTIFY_GET_PLAYLIST_TRACKS_FOR_PLAYING_PROCESSOR', 
                            'Loading '+(response.total-uris.length)+' playlist tracks', 
                            {
                                next: response.next,
                                total: response.total,
                                remaining: response.total - uris.length
                            }
                        ))
                        dispatch(uiActions.runProcess(
                            'SPOTIFY_GET_PLAYLIST_TRACKS_FOR_PLAYING_PROCESSOR', 
                            {
                                next: response.next,
                                uris: uris
                            }
                        ))
                    } else {
                        dispatch(mopidyActions.playURIs(uris, data.uri))
                        dispatch(uiActions.processFinished('SPOTIFY_GET_PLAYLIST_TRACKS_FOR_PLAYING_PROCESSOR'))
                    }
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load tracks to play playlist',
                        error
                    ));
                }
            );
    }
}

export function getPlaylistTracksForQueueing(uri){
    return (dispatch, getState) => {
        dispatch(uiActions.startProcess(
            'SPOTIFY_GET_PLAYLIST_TRACKS_FOR_QUEUEING_PROCESSOR',
            'Loading playlist tracks', 
            {
                uri: uri,
                next: 'users/'+ helpers.getFromUri('userid',uri) +'/playlists/'+ helpers.getFromUri('playlistid',uri) +'/tracks?market='+getState().core.country
            }
        ))
    }
}

export function getPlaylistTracksForQueueingProcessor(data){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, data.next)
            .then(
                response => {

                    // Check to see if we've been cancelled
                    if (getState().ui.processes['SPOTIFY_GET_PLAYLIST_TRACKS_FOR_QUEUEING_PROCESSOR'] !== undefined){
                        var processor = getState().ui.processes['SPOTIFY_GET_PLAYLIST_TRACKS_FOR_QUEUEING_PROCESSOR']

                        if (processor.status == 'cancelling'){
                            dispatch(uiActions.processCancelled('SPOTIFY_GET_PLAYLIST_TRACKS_FOR_QUEUEING_PROCESSOR'))
                            return false
                        }
                    }

                    // Add on our new batch of loaded tracks
                    var uris = []
                    var new_uris = []
                    for (var i = 0; i < response.items.length; i++){
                        new_uris.push(response.items[i].track.uri)
                    }
                    if (data.uris){
                        uris = [...data.uris, ...new_uris];
                    } else {
                        uris = new_uris;
                    }

                    // We got a next link, so we've got more work to be done
                    if (response.next){
                        dispatch(uiActions.updateProcess(
                            'SPOTIFY_GET_PLAYLIST_TRACKS_FOR_QUEUEING_PROCESSOR', 
                            'Loading '+(response.total-uris.length)+' playlist tracks', 
                            {
                                next: response.next,
                                total: response.total,
                                remaining: response.total - uris.length
                            }
                        ))
                        dispatch(uiActions.runProcess(
                            'SPOTIFY_GET_PLAYLIST_TRACKS_FOR_QUEUEING_PROCESSOR', 
                            {
                                next: response.next,
                                uris: uris
                            }
                        ))
                    } else {
                        dispatch(mopidyActions.enqueueURIs(uris, data.uri))
                        dispatch(uiActions.processFinished('SPOTIFY_GET_PLAYLIST_TRACKS_FOR_QUEUEING_PROCESSOR'))
                    }
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not load tracks to play playlist',
                        error
                    ));
                }
            );
    }
}

export function addTracksToPlaylist(uri, tracks_uris){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, 'users/'+ helpers.getFromUri('userid',uri) + '/playlists/'+ helpers.getFromUri('playlistid',uri) + '/tracks', 'POST', { uris: tracks_uris } )
            .then(
                response => {
                    dispatch({
                        type: 'PLAYLIST_TRACKS_ADDED',
                        key: uri,
                        tracks_uris: tracks_uris,
                        snapshot_id: response.snapshot_id
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not add tracks to playlist',
                        error
                    ));
                }
            );
    }
}

export function deleteTracksFromPlaylist(uri, snapshot_id, tracks_indexes){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, 'users/'+ helpers.getFromUri('userid',uri) + '/playlists/'+ helpers.getFromUri('playlistid',uri) + '/tracks', 'DELETE', { snapshot_id: snapshot_id, positions: tracks_indexes } )
            .then(
                response => {
                    dispatch({
                        type: 'PLAYLIST_TRACKS_REMOVED',
                        key: uri,
                        tracks_indexes: tracks_indexes,
                        snapshot_id: response.snapshot_id
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not remove tracks from playlist',
                        error
                    ));
                }
            );
    }
}

export function reorderPlaylistTracks(uri, range_start, range_length, insert_before, snapshot_id){
    return (dispatch, getState) => {
        sendRequest(dispatch, getState, 'users/'+ helpers.getFromUri('userid',uri) + '/playlists/'+ helpers.getFromUri('playlistid',uri) + '/tracks', 'PUT', { uri: uri, range_start: range_start, range_length: range_length, insert_before: insert_before, snapshot_id: snapshot_id } )
            .then(
                response => {
                    dispatch({
                        type: 'PLAYLIST_TRACKS_REORDERED',
                        key: uri,
                        range_start: range_start,
                        range_length: range_length,
                        insert_before: insert_before,
                        snapshot_id: response.snapshot_id
                    });
                },
                error => {
                    dispatch(coreActions.handleException(
                        'Could not reorder playlist tracks',
                        error
                    ));
                }
            );
    }
}