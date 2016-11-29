/*
 * @author David Menger
 */
'use strict';

const { tokenize } = require('./tokenizer');
const { quickReplyAction } = require('./quickReplies');

/**
 * Instance of {Request} class is passed as first parameter of handler (req)
 *
 * @class Request
 */
class Request {

    constructor (data, state) {
        this.data = data;

        this.message = data.message || null;

        this._postback = data.postback || null;

        this.attachments = (data.message && data.message.attachments) || [];

        this.senderId = data.sender && data.sender.id;

        /**
         * @prop {object} state current state of the conversation
         */
        this.state = state;
    }

    /**
     * Checks, when message contains an attachment (file, image or location)
     *
     * @returns {boolean}
     *
     * @memberOf Request
     */
    isAttachment () {
        return this.attachments.length > 0;
    }

    _checkAttachmentType (type, attachmentIndex = 0) {
        if (this.attachments.length <= attachmentIndex) {
            return false;
        }
        return this.attachments[attachmentIndex].type === type;
    }

    /**
     * Checks, when the attachment is an image
     *
     * @param {number} [attachmentIndex=0] use, when user sends more then one attachment
     * @returns {boolean}
     *
     * @memberOf Request
     */
    isImage (attachmentIndex = 0) {
        return this._checkAttachmentType('image', attachmentIndex);
    }

    /**
     * Checks, when the attachment is a file
     *
     * @param {number} [attachmentIndex=0] use, when user sends more then one attachment
     * @returns {boolean}
     *
     * @memberOf Request
     */
    isFile (attachmentIndex = 0) {
        return this._checkAttachmentType('file', attachmentIndex);
    }

    /**
     * Returns whole attachment or null
     *
     * @param {number} [attachmentIndex=0] use, when user sends more then one attachment
     * @returns {object|null}
     *
     * @memberOf Request
     */
    attachment (attachmentIndex = 0) {
        if (this.attachments.length <= attachmentIndex) {
            return null;
        }
        return this.attachments[attachmentIndex];
    }

    /**
     * Returns attachment URL
     *
     * @param {number} [attachmentIndex=0] use, when user sends more then one attachment
     * @returns {string|null}
     *
     * @memberOf Request
     */
    attachmentUrl (attachmentIndex = 0) {
        if (this.attachments.length <= attachmentIndex) {
            return null;
        }
        const { payload } = this.attachments[attachmentIndex];
        if (!payload) {
            return null;
        }
        return payload && payload.url;
    }

    /**
     * Returns true, when the request is text message, quick reply or attachment
     *
     * @returns {boolean}
     *
     * @memberOf Request
     */
    isMessage () {
        return this.message !== null;
    }

    /**
     * Returns text of the message
     *
     * @param {boolean} [tokenized=false] when true, message is normalized to lowercase with `-`
     * @returns {string}
     *
     * @example
     * console.log(req.text(true)) // "can-you-help-me"
     *
     * @memberOf Request
     */
    text (tokenized = false) {
        if (this.message === null) {
            return '';
        }

        if (tokenized && this.message.text) {
            return tokenize(this.message.text);
        }

        return this.message.text || '';
    }

    /**
     * Returns action or data of quick reply
     * When `getData` is `true`, object will be returned. Otherwise string or null.
     *
     * @param {boolean} [getData=false]
     * @returns {null|string|object}
     *
     * @example
     * typeof res.quickReply() === 'string' || res.quickReply() === null;
     * typeof res.quickReply(true) === 'object';
     *
     * @memberOf Request
     */
    quickReply (getData = false) {
        if (this.message === null
            || !this.message.quick_reply) {
            return null;
        }

        return this._processPayload(this.message.quick_reply, getData);
    }

    /**
     * Returns true, if request is the postback
     *
     * @returns {boolean}
     *
     * @memberOf Request
     */
    isPostBack () {
        return this._postback !== null;
    }

    /**
     * Returns action of the postback or quickreply
     * When `getData` is `true`, object will be returned. Otherwise string or null.
     *
     * 1. the postback is checked
     * 2. the quick reply is checked
     *
     * @param {boolean} [getData=false]
     * @returns {null|string|object}
     *
     * @example
     * typeof res.action() === 'string' || res.action() === null;
     * typeof res.action(true) === 'object';
     *
     * @memberOf Request
     */
    action (getData = false) {
        let res = null;

        if (this._postback !== null) {
            res = this._processPayload(this._postback, getData);
        }
        if (!res && this.message !== null && this.message.quick_reply) {
            res = this._processPayload(this.message.quick_reply, getData);
        }

        if (getData) {
            return res || {};
        }

        if (!res && this.state._expectedKeywords) {
            res = quickReplyAction(this.state._expectedKeywords, this.text(true));
        }
        if (!res && this.state._expected) {
            res = this.state._expected;
        }

        return res || null;
    }

    /**
     * Returns action or data of postback
     * When `getData` is `true`, object will be returned. Otherwise string or null.
     *
     * @param {boolean} [getData=false]
     * @returns {null|string|object}
     *
     * @example
     * typeof res.postBack() === 'string' || res.postBack() === null;
     * typeof res.postBack(true) === 'object';
     *
     * @memberOf Request
     */
    postBack (getData = false) {
        if (this._postback === null) {
            return null;
        }
        return this._processPayload(this._postback, getData);
    }

    _processPayload (object = {}, getData = false) {
        let { payload } = object;
        let isObject = typeof payload === 'object' && payload !== null;
        const byDefault = getData ? {} : null;

        if (typeof payload === 'string' && payload.match(/^\{.*\}$/)) {
            payload = JSON.parse(payload);
            isObject = true;
        }

        if (getData && isObject) {
            return payload.data || payload;
        } if (isObject) {
            return payload.action;
        }

        return payload || byDefault;
    }

}

Request.createPostBack = function (senderId, action, data = {}) {
    return {
        sender: {
            id: senderId
        },
        postback: {
            payload: {
                action,
                data
            }
        }
    };
};

Request.text = function (senderId, text) {
    return {
        sender: {
            id: senderId
        },
        message: {
            text
        }
    };
};

Request.quickReply = function (senderId, action, data = {}) {
    return {
        sender: {
            id: senderId
        },
        message: {
            text: action,
            quick_reply: {
                payload: JSON.stringify({
                    action,
                    data
                })
            }
        }
    };
};

Request.fileAttachment = function (senderId, url, type = 'file') {
    return {
        sender: {
            id: senderId
        },
        message: {
            attachments: [{
                type,
                payload: {
                    url
                }
            }]
        }
    };
};

module.exports = Request;