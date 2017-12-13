
import React, { PropTypes } from 'react'

import Icon from '../Icon'
import * as helpers from '../../helpers'

export default class EnterUsernameModal extends React.Component{

	constructor(props){
		super(props)
		this.state = {
			username: ''
		}
	}

	enterUsername(e){		
		e.preventDefault();	

		if (!this.state.username || this.state.username == ''){
			this.setState({error: 'Name is required'})
			return false
		} else {	
			this.props.pusherActions.setUsername(this.state.username)
			this.props.uiActions.closeModal()
		}

		return false
	}

	render(){
		return (
			<div>
				<h1>Enter Name</h1>
				<form onSubmit={(e) => this.enterUsername(e)}>
					<div className="field text">
						<span className="label">Name</span>
						<input
							type="text"
							onChange={e => this.setState({ username: e.target.value })}
							value={this.state.username} />
					</div>
					
					<div className="actions centered-text">
					<button type="submit" className="primary wide">Done</button>
					</div>

				</form>
			</div>
		)
	}
}