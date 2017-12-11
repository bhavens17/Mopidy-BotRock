
import React, { PropTypes } from 'react'
import FontAwesome from 'react-fontawesome'

import Icon from '../Icon'
import * as helpers from '../../helpers'

export default class AddToQueueModal extends React.Component{

	constructor(props){
		super(props)
		this.state = {
			uris: '',
			next: false
		}
	}

	handleSubmit(e){
		var uris = this.state.uris.split(',');
		this.props.mopidyActions.enqueueURIs(uris, null, this.state.next);
		this.props.uiActions.closeModal();
	}

	render(){
		return (
			<div>
				<h1>Add to queue</h1>
				<h2 className="grey-text">Add a comma-separated list of URIs to the play queue. You must have the appropriate Mopidy backend enabled for each URI schema (eg spotify:, yt:).</h2>

				<form onSubmit={e => this.handleSubmit(e)}>
					<div className="field text">
						<span className="label">URI(s)</span>
						<input 
							type="text"
							onChange={e => this.setState({uris: e.target.value})} 
							value={this.state.uris} />
					</div>

					<div className="field radio white">
						<span className="label">Position</span>
						<label>
							<input 
								type="radio"
								name="next"
								checked={!this.state.next}
								onChange={e => this.setState({next: false})} />
							<span className="label">End</span>
						</label>
						<label>
							<input 
								type="radio"
								name="next"
								checked={this.state.next}
								onChange={e => this.setState({next: true})} />
							<span className="label">After current track</span>
						</label>
					</div>

					<div className="actions centered-text">
						<button type="submit" className="primary wide">Add</button>
					</div>
				</form>
			</div>
		)
	}
}