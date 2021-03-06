/*
 * @author David Menger
 */
'use strict';

const request = require('request-promise');

const RES_HANDLER = (res, nextData) => nextData;

function wait (ms) {
    return new Promise(res => setTimeout(res, ms));
}

function sender (data, token) {
    return request({
        uri: 'https://graph.facebook.com/v2.8/me/messages',
        qs: { access_token: token },
        method: 'POST',
        body: data,
        json: true
    });
}

function sendData (senderFn, token, data, queue, sent = [], handler = RES_HANDLER, res = null) {
    const next = handler(res, data);

    if (!next) {
        return sent;
    }

    let promise;
    if (next.wait) {
        promise = wait(next.wait);
    } else {
        sent.push(next);
        promise = senderFn(next, token);
    }
    return promise
        .then(result =>
            sendData(senderFn, token, queue.shift(), queue, sent, handler, result));
}

function getDisconnectedError (e) {
    if (!e.response || !e.response.body || !e.response.body.error) {
        return null;
    }
    if (e.response.statusCode !== 403 || e.response.body.error.code !== 200) {
        return null;
    }
    const err = new Error(e.response.body.error.message);
    err.code = 403;
    return err;
}

function senderFactory (token, logger = console, onSenderError = () => {}, senderFn = sender) {
    const factoryFn = function factory (incommingMessage, pageId, handler = RES_HANDLER) {
        const queue = [];
        let working = false;

        return function send (payload) {
            if (working) {
                // store in queue
                queue.push(payload);
            } else {
                working = true;
                const sent = [];
                sendData(senderFn, token, payload, queue, sent, handler)
                    .then(() => {
                        working = false;
                        logger.log(sent, incommingMessage);
                    })
                    .catch((e) => {
                        // detect disconnected users
                        const err = getDisconnectedError(e);

                        if (onSenderError(err || e, incommingMessage) !== true) {
                            logger.error(e, sent, incommingMessage);
                        }
                    });
            }
        };
    };

    return factoryFn;
}

module.exports = {
    senderFactory,
    sender
};
