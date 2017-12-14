
import ReactGA from 'react-ga'

var helpers = require('../../helpers.js')
var coreActions = require('../core/actions.js')
var uiActions = require('../ui/actions.js')
var pusherActions = require('./actions.js')
var lastfmActions = require('../lastfm/actions.js')
var spotifyActions = require('../spotify/actions.js')

const PusherMiddleware = (function(){ 

    // container for the actual websocket
    var socket = null

    // requests pending
    var deferredRequests = []

    // handle all manner of socket messages
    const handleMessage = (ws, store, message) => {

        if (store.getState().ui.log_pusher){
            console.log('Pusher', message);
        }

        // Response with request_id
        if (message.request_id !== undefined && message.request_id){

            // Response matches a pending request
            if (deferredRequests[message.request_id] !== undefined){

                store.dispatch(uiActions.stopLoading(message.request_id));

                // Response is an error
                if (message.status <= 0){
                    deferredRequests[message.request_id].reject(message);

                // Successful response
                } else {
                    deferredRequests[message.request_id].resolve(message);
                }

            // Hmm, the response doesn't appear to be for us?
            } else {
                store.dispatch(coreActions.handleException(
                    'Pusher: Response received with no matching request', 
                    message
                ));
            }

        // General broadcast received
        } else {

            // Broadcast of an error
            if (message.status !== undefined && message.status <= 0){
                store.dispatch(coreActions.handleException(
                    'Pusher: '+message.message, 
                    message
                ));
            } else {
                message.type = 'PUSHER_'+message.type.toUpperCase();
                store.dispatch(message);  
            }
        }
    }

    const request = (store, method, data = {}) => {
        return new Promise((resolve, reject) => {

            var request_id = helpers.generateGuid()
            var message = {
                method: method,
                data: data,
                request_id: request_id
            }
            socket.send(JSON.stringify(message));

            store.dispatch(uiActions.startLoading(request_id, 'pusher_'+method));

            // Start our 15 second timeout
            var timeout = setTimeout(
                function(){
                    store.dispatch(uiActions.stopLoading(request_id));
                    reject({message: "Request timed out", method: method, data: data});
                },
                30000
            );
            
            // add query to our deferred responses
            deferredRequests[request_id] = {
                resolve: resolve,
                reject: reject
            };
        })
    }

    return store => next => action => {
        switch(action.type){

            case 'PUSHER_CONNECT':
                var state = store.getState();
                
                // Stagnant socket, close it first
                if (socket != null){
                    socket.close();
                }

                store.dispatch({ type: 'PUSHER_CONNECTING' });
                
                var connection = {
                    client_id: helpers.generateGuid(),
                    connection_id: helpers.generateGuid(),
                    username: 'Anonymous'
                }
                if (state.pusher.username){
                    connection.username = state.pusher.username;
                }
                connection.username = connection.username//.replace(/\W/g, '');
                
                socket = new WebSocket(
                    'ws'+(window.location.protocol === 'https:' ? 's' : '')+'://'+state.mopidy.host+':'+state.mopidy.port+'/botrock/ws/',
                    [ connection.client_id, connection.connection_id, connection.username ]
                );

                socket.onmessage = (message) => {
                    var message = JSON.parse(message.data);
                    handleMessage(socket, store, message )
                };

                socket.onclose = () => {
                    store.dispatch({
                        type: 'PUSHER_DISCONNECTED'
                    })

                    // attempt to reconnect every 5 seconds
                    setTimeout(() => {
                        store.dispatch(pusherActions.connect())
                    }, 5000);
                };

                break;

            case 'PUSHER_CONNECTED':
                var state = store.getState();
                ReactGA.event({ category: 'Pusher', action: 'Connected', label: action.username})
                request(store, 'get_config')
                    .then(
                        response => {
                            if (response.error){
                                console.error(response.error)
                                return false
                            }

                            response.type = 'PUSHER_CONFIG'
                            store.dispatch(response);

                            var core = store.getState().core
                            if (!core.country || !core.locale){
                                store.dispatch(coreActions.set({
                                    country: response.config.country,
                                    locale: response.config.locale
                                }))
                            }
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Could not load config',
                                error
                            ));
                        }
                    );
                request(store, 'get_version')
                    .then(
                        response => {
                            if (response.error){
                                console.error(response.error)
                                return false
                            }
                            response.type = 'PUSHER_VERSION'
                            store.dispatch(response)
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Could not load version',
                                error
                            ));
                        }
                    );
                request(store, 'get_radio')
                    .then(
                        response => {
                            if (response.error){
                                console.error(response.error)
                                return false
                            }

                            response.type = 'PUSHER_RADIO'
                            store.dispatch(response)
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Could not load radio',
                                error
                            ));
                        }
                    );
                request(store, 'get_botrock_voting')
                    .then(
                        response => {
                            store.dispatch({
                                type: 'PUSHER_BOTROCK_VOTING_UPDATED'
                                ,voting: response.voting
                            })
                        },
                        error => {
                            store.dispatch(coreActions.handleException(
                                'Could not get BotRock voting',
                                error
                            ));
                        }
                    );
                
                if(!state.pusher.username)
                {
                    store.dispatch(uiActions.openModal('enter_username', { username: state.pusher.username }))
                }

                store.dispatch(pusherActions.getQueueMetadata())

                return next(action);
                break;

            case 'PUSHER_INSTRUCT':
                request(action)
                    .then(
                        response => {
                            store.dispatch({ type: 'PUSHER_INSTRUCT', data: response.data })
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Instruct failed',
                                error
                            ));
                        }
                    );
                break

            case 'PUSHER_DELIVER_MESSAGE':
                request(store, 'deliver_message', action.data)
                    .then(
                        response => {
                            store.dispatch(uiActions.createNotification('Message delivered') )
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Could not deliver message',
                                error
                            ));
                        }
                    );
                break

            case 'PUSHER_DELIVER_BROADCAST':
                request(store, 'broadcast', action.data)
                break

            case 'PUSHER_GET_QUEUE_METADATA':
                request(store, 'get_queue_metadata')
                    .then(
                        response => {
                            response.type = 'PUSHER_QUEUE_METADATA'
                            store.dispatch(response)
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Could not load queue metadata',
                                error
                            ));
                        }
                    );
                break;

            case 'PUSHER_ADD_QUEUE_METADATA':
                request(store, 'add_queue_metadata', {
                    tlids: action.tlids, 
                    added_from: action.from_uri,
                    added_by: store.getState().pusher.username
                })
                break;

            case 'PUSHER_START_UPGRADE':
                ReactGA.event({ category: 'Pusher', action: 'Upgrade', label: '' })
                request(store, 'upgrade')
                    .then(
                        response => {
                            if (response.error){
                                console.error(response.error)
                                return false
                            }

                            if (response.upgrade_successful){
                                store.dispatch(uiActions.createNotification('Upgrade complete') )
                            } else {
                                store.dispatch(uiActions.createNotification('Upgrade failed, please upgrade manually','bad') )
                            }

                            response.type = 'PUSHER_VERSION'
                            store.dispatch(response)
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Could not start upgrade',
                                error
                            ));
                        }
                    );
                return next(action);
                break;

            case 'PUSHER_SET_USERNAME':
                request(store, 'set_username', {
                    username: action.username
                })
                    .then(
                        response => {
                            if (response.error){
                                console.error(response.error)
                                return false
                            }
                            response.type = 'PUSHER_USERNAME_CHANGED'
                            store.dispatch(response)
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Could not set username',
                                error
                            ));
                        }
                    );
                return next(action);
                break;

            case 'PUSHER_GET_CONNECTIONS':
                request(store, 'get_connections')
                    .then(
                        response => {             
                            if (response.error){
                                console.error(response.error)
                                return false
                            }
                            response.type = 'PUSHER_CONNECTIONS'
                            store.dispatch(response)
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Could not load connections',
                                error
                            ));
                        }
                    );
                return next(action);
                break

            case 'PUSHER_SPOTIFY_AUTHORIZATION':
                store.dispatch(uiActions.openModal('receive_authorization', {authorization: action.authorization, user: action.me}))
                break

            case 'PUSHER_START_RADIO':
            case 'PUSHER_UPDATE_RADIO':
                ReactGA.event({ category: 'Pusher', action: 'Start radio', label: action.uris.join() })

                // start our UI process notification  
                if (action.type == 'PUSHER_UPDATE_RADIO'){
                    store.dispatch(uiActions.startProcess('PUSHER_RADIO_PROCESS', 'Updating radio'))
                } else {
                    store.dispatch(uiActions.startProcess('PUSHER_RADIO_PROCESS', 'Starting radio'))
                }

                var data = {
                    update: (action.type == 'PUSHER_UPDATE_RADIO'),
                    seed_artists: [],
                    seed_genres: [],
                    seed_tracks: []
                }
                
                for(var i = 0; i < action.uris.length; i++){
                    switch(helpers.uriType(action.uris[i] )){
                        case 'artist':
                            data.seed_artists.push(action.uris[i] );
                            break;
                        case 'track':
                            data.seed_tracks.push(action.uris[i] );
                            break;
                        case 'genre':
                            data.seed_genres.push(action.uris[i] );
                            break;
                    }
                }

                request(store, 'change_radio', data)
                    .then(
                        response => {
                            store.dispatch(uiActions.processFinished('PUSHER_RADIO_PROCESS'));
                            if (response.status == 0){
                                store.dispatch(uiActions.createNotification(response.message, 'bad'));
                            }
                        },
                        error => {       
                            store.dispatch(uiActions.processFinished('PUSHER_RADIO_PROCESS'));                     
                            store.dispatch(coreActions.handleException(
                                'Could not change radio',
                                error
                            ));
                        }
                    )
                break

            case 'PUSHER_STOP_RADIO':
                store.dispatch(uiActions.createNotification('Stopping radio'))
                ReactGA.event({ category: 'Pusher', action: 'Stop radio' })

                var data = {
                    seed_artists: [],
                    seed_genres: [],
                    seed_tracks: []
                }

                // we don't need to wait for response, as change will be broadcast
                request(store, 'stop_radio', data)
                break

            case 'PUSHER_RADIO_STARTED':
            case 'PUSHER_RADIO_CHANGED':
                if (action.radio && action.radio.enabled && store.getState().spotify.enabled){
                    store.dispatch(spotifyActions.resolveRadioSeeds(action.radio))
                }
                next(action)
                break

            case 'PUSHER_BROWSER_NOTIFICATION':
                store.dispatch(uiActions.createBrowserNotification(action))
                break

            case 'PUSHER_RESTART':
                // Hard reload. This doesn't strictly clear the cache, but our compiler's
                // cache buster should handle that 
                window.location.reload(true);
                break

            case 'PUSHER_VERSION':
                ReactGA.event({ category: 'Pusher', action: 'Version', label: action.version.current })

                if (action.version.upgrade_available){
                    store.dispatch(uiActions.createNotification('Version '+action.version.latest+' is available. See settings to upgrade.' ) )
                }
                next(action )
                break

            case 'PUSHER_CONFIG':
                store.dispatch(spotifyActions.set({
                    locale: (action.config.locale ? action.config.locale : null),
                    country: (action.config.country ? action.config.country : null),
                    authorization_url: (action.config.spotify_authorization_url ? action.config.spotify_authorization_url : null)
                }))
                store.dispatch(lastfmActions.set({
                    authorization_url: (action.config.lastfm_authorization_url ? action.config.lastfm_authorization_url : null)
                }))

                next(action )
                break

            case 'PUSHER_DEBUG':
                request(store, action.message.method, action.message.data )
                    .then(
                        response => {
                            store.dispatch({type: 'DEBUG', response: response})
                        },
                        error => {                            
                            store.dispatch(coreActions.handleException(
                                'Could not debug',
                                error,
                                error.message
                            ));
                        }
                    );
                break;

            case 'PUSHER_ERROR':
                store.dispatch(uiActions.createNotification(action.message, 'bad'))
                ReactGA.event({ category: 'Pusher', action: 'Error', label: action.message })
                break

            case 'PUSHER_CAST_BOTROCK_VOTE':
                var state = store.getState();
                var username = state.pusher.username;
                request(store, 'cast_botrock_vote', { song_number: action.song_number, username: username })
                    .then(
                        response => {
                            console.log(response)
                        },
                        error => {
                            store.dispatch(coreActions.handleException(
                                'Could not cast BotRock vote',
                                error
                            ));
                        }
                    );
                break

            case 'PUSHER_BOTROCK_VOTING_UPDATED':
                if(action.voting)
                {
                    for(var i = 0; i < action.voting.songs.length; i++){
                        var song = action.voting.songs[i];
                        if (helpers.uriSource(song.track.uri) == 'spotify' && store.getState().spotify.enabled){
                            store.dispatch(spotifyActions.getTrack(song.track.uri))
                        }
                    }
                }
                return next(action);

            case 'PUSHER_BOTROCK_VOTING_WON':
                if(action.song)
                {
                    store.dispatch(uiActions.createNotification("We have a winner!  '" + action.song.track.name + "' by " + action.song.track.artist))
                }

            // This action is irrelevant to us, pass it on to the next middleware
            default:
                return next(action);
        }
    }

})();

export default PusherMiddleware
