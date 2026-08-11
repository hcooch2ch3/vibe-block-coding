import {IntlProvider as ReactIntlProvider} from 'react-intl';
import {connect} from 'react-redux';

import vibeMessages from './ai-harness/vibe-l10n';

// Merge our custom `vibe.*` translations for the active locale over the base
// scratch-l10n messages. English needs nothing (components carry defaultMessage),
// so vibeMessages only holds non-English locales; other locales pass through.
const mapStateToProps = state => {
    const locale = state.locales.locale;
    const extra = vibeMessages[locale];
    return {
        key: locale,
        locale: locale,
        messages: extra ? Object.assign({}, state.locales.messages, extra) : state.locales.messages
    };
};

export default connect(mapStateToProps)(ReactIntlProvider);
