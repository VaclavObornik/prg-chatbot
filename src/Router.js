/*
 * @author David Menger
 */
'use strict';

const ReducerWrapper = require('./ReducerWrapper');
const { makeAbsolute } = require('./pathUtils');
const pathToRegexp = require('path-to-regexp');

/**
 * Cascading router
 *
 * @class Router
 * @extends {ReducerWrapper}
 */
class Router extends ReducerWrapper {

    constructor () {
        super();

        this._routes = [];
    }

    _normalizePath (path) {
        let normalizedPath;

        if (!path.match(/^\//)) {
            normalizedPath = `/${path}`;
        } else {
            normalizedPath = path;
        }

        return normalizedPath.replace(/\/$/, '');
    }

    _isMatcher (value) {
        const type = typeof value;
        return type === 'string' || value instanceof RegExp ||
            (type === 'function' && value.length <= 1);
    }

    _makeMatchCallback (pattern) {
        if (pattern instanceof RegExp || typeof pattern === 'string') {
            // @todo webalized pattern
            return req => req.text(true).match(pattern);
        }

        return pattern;
    }

    /**
     * Appends middleware, action handler or another router
     *
     * @param {string} [action] name of the action
     * @param {RegExp|string|function} [matcher] - The function can be async
     * @param {...(function|Router)} reducers
     * @returns {{next:function}}
     *
     * @example
     * // middleware
     * router.use((req, res, postBack, next) => {
     *     next();
     * });
     *
     * // route with matching regexp
     * router.use('action', /help/, (req, res) => {
     *     res.text('Hello!');
     * });
     *
     * // route with matching function (the function is considered as matcher
     * // in case of the function accepts zero or one argument)
     * router.use('action', req => req.text() === 'a', (req, res) => {
     *     res.text('Hello!');
     * });
     *
     * // use multiple reducers
     * router.use('/path', reducer1, reducer2)
     *    .next('exitAction', (data, req, res, postBack, next) => {
     *        postBack('anotherAction', { someData: true })
     *    });
     *
     * // append router with exit action
     * router.use('/path', subRouter)
     *    .next('exitAction', (data, req, res, postBack, next) => {
     *        postBack('anotherAction', { someData: true })
     *    });
     *
     * @memberOf Router
     */
    use (...reducers) {

        let path = typeof reducers[0] === 'string' ? reducers.shift() : '*';
        path = this._normalizePath(path);

        // matcher can be only if there is another reduce function
        const match = (reducers.length >= 2 && this._isMatcher(reducers[0]))
            ? this._makeMatchCallback(reducers.shift())
            : null;

        const nexts = [];

        this._routes.push({
            path,
            match,
            nexts,
            reducers: reducers.map((reducer) => {

                let isReducer = false;
                let reduce = reducer;

                if (typeof reduce === 'object' && reduce.reduce) {
                    isReducer = true;

                    reduce.on('action', (...args) => this.emit('action', ...args));
                    reduce.on('_action', (...args) => this.emit('_action', ...args));

                    const reduceFn = reduce.reduce.bind(reduce);
                    reduce = (...args) => reduceFn(...args);
                }

                return {
                    pathMatch: pathToRegexp(path, [], { end: !isReducer }),
                    reduce,
                    isReducer
                };
            })
        });

        return {
            next (actionName, listener) {
                nexts.push({
                    action: actionName,
                    listener,
                    pathMatch: pathToRegexp(path)
                });
                return this;
            }
        };
    }

    _createNext (route, req, res, postBack, path) {
        const next = (action = null, data = {}) => {
            let finnished = false;
            res.setPath(path);
            if (route.nexts) {
                finnished = route.nexts.some((nextAction) => {
                    if (nextAction.action === action || nextAction.action === '*') {
                        const nextContext = this._createNext({}, req, res);
                        nextAction.listener(data, req, res, postBack, nextContext);

                        if (!nextContext.called) {
                            return true;
                        } else if (nextContext.action) {
                            next.action = nextContext.action;
                            next.data = nextContext.data;
                            next.called = true;
                            return true;
                        }
                    }
                    return false;
                });
            }

            if (!finnished && action) {
                next.action = action;
                next.data = data;
            }
            if (!next.called) {
                next.called = !finnished;
            }
        };

        next.action = null;
        next.data = {};
        next.called = false;

        return next;
    }

    _relativePostBack (origPostBack, path) {
        return function postBack (action, data = {}) {
            return origPostBack(makeAbsolute(action, path), data);
        };
    }

    _makePostBackRelative (origPostBack, path) {
        const postBack = this._relativePostBack(origPostBack, path);
        postBack.wait = () => {
            const deferredPostBack = origPostBack.wait();
            return this._relativePostBack(deferredPostBack, path);
        };
        return postBack;
    }

    async reduce (req, res, postBack = () => {}, next = () => {}, path = '/') {
        const action = this._action(req, path);
        const relativePostBack = this._makePostBackRelative(postBack, path);

        let found = false;

        routesLoop:
        for (const route of this._routes) {
            const matchingRouteReducers = await this._filterMatchingReducers(route, action, req);

            for (const reducer of matchingRouteReducers) {
                let pathContext = `${path === '/' ? '' : path}${route.path.replace(/\/\*/, '')}`;
                res.setPath(path);
                const nextContext = this._createNext(route, req, res, relativePostBack, path);
                await reducer.reduce(req, res, relativePostBack, nextContext, pathContext);

                if (!reducer.isReducer) {
                    pathContext = `${path === '/' ? '' : path}${route.path}`;
                    this._emitAction(req, pathContext);
                }

                if (!nextContext.called) {
                    found = true;
                    break routesLoop;
                } else if (nextContext.action) {
                    await next(nextContext.action, nextContext.data);
                    found = true;
                    break routesLoop;
                }
            }
        }

        if (!found) {
            await next();
        }
    }

    async _filterMatchingReducers (route, action, req) {

        // we want to call route.match only once in case of multiple reducers
        if ((!action || route.path === '/*') && route.match !== null) {
            return await route.match(req) ? route.reducers : [];
        }

        if (action && route.path !== '/*') {
            return route.reducers.filter(reducer => reducer.pathMatch.exec(action));
        }

        return route.reducers.filter(reducer => reducer.pathMatch.exec('/'));
    }

    _action (req, path) {
        let action = req.action();

        // try to normalize the action
        if (action) {
            if (!action.match(/^\//)) {
                action = `/${action}`;
            }
            if (action.indexOf(path) === 0) {
                // return relative path with slash at the begining
                if (path !== '/') {
                    return action.substr(path.length);
                }

                return action;
            }
        }

        return null;
    }
}

module.exports = Router;
