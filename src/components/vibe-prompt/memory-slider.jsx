import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';

/**
 * A bound-method range slider for the conversation-memory depth setting.
 * Lives in its own file so vibe-prompt.jsx stays a single React component
 * file (react/no-multi-comp with ignoreStateless:true).
 */
class MemorySlider extends React.Component {
    constructor (props) {
        super(props);
        this.handleChange = this.handleChange.bind(this);
    }
    handleChange (e) {
        this.props.onChange(Number(e.target.value));
    }
    render () {
        return (
            <input
                className={classNames('vibe-memory-slider', this.props.className)}
                id={this.props.id}
                type="range"
                min={0}
                max={10}
                step={1}
                value={this.props.value}
                aria-label={this.props.ariaLabel}
                onChange={this.handleChange}
            />
        );
    }
}

MemorySlider.propTypes = {
    ariaLabel: PropTypes.string.isRequired,
    className: PropTypes.string,
    id: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    value: PropTypes.number.isRequired
};

export default MemorySlider;
