/*
 * @author David Menger
 */
'use strict';

const assert = require('assert');
const sinon = require('sinon');
const Router = require('../src/Router');

function createMockReq (text = '', action = 'action') {
    const req = {
        senderId: 7,
        state: {},
        action (isData) { return isData ? {} : action; },
        text () { return text; }
    };
    return req;
}

function createMockRes () {
    const ret = {
        path: '',
        setPath (path) {
            this.path = path;
        }
    };
    return ret;
}

function shouldBeCalled (route, req, res) {
    assert(route.called, 'route should be called');
    assert.strictEqual(route.firstCall.args[0], req);
    assert.strictEqual(route.firstCall.args[1], res);
    assert.equal(typeof route.firstCall.args[2], 'function');
}

function nextTick () {
    return new Promise(r => process.nextTick(r));
}

describe('Router', function () {

    describe('#reduce()', function () {

        it('should work', async function () {
            const router = new Router();

            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq();
            const res = createMockRes();

            router.use('/first', noRoute);
            router.use('/*', route);

            await router.reduce(req, res);

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
        });

        it('should call matching url', async function () {
            const router = new Router();

            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq('', 'action');
            const res = createMockRes();

            router.use('action', route);
            router.use('*', noRoute);

            await router.reduce(req, res);

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);

        });

        it('should call matching text with regexp', async function () {
            const router = new Router();

            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq('just a text', null);
            const res = createMockRes();

            router.use('action', /^just\sa\stext$/, route);
            router.use('*', noRoute);

            await router.reduce(req, res);

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);

        });

        it('should pass request to next routes', async function () {
            const router = new Router();

            let i = 0;

            const first = sinon.spy((req, res, postBack, next) => next());
            const second = sinon.spy((req, res, postBack, next) => next());
            const resolver = sinon.spy(() => new Promise(resolve => setTimeout(resolve, 50))
                .then(() => i++)
                .then(() => true)
            );
            const third = sinon.spy((req, res, postBack, next) => {
                assert.equal(i, 1, 'The third reducer should be called after async resolver was resolved.');
                return new Promise(resolve => setTimeout(resolve, 50))
                    .then(() => i++)
                    .then(() => next());
            });
            const fourth = sinon.spy((req, res, postBack, next) => {
                assert.equal(i, 2, 'The fourth reducer should be called after the third async reducer was resolved.');
                next();
            });
            const last = sinon.spy();
            const req = createMockReq('just a text', null);
            const res = createMockRes();

            router.use('fakin-action', /^just\sa\stext$/, first);
            router.use('anotheraction', 'just a text', second);
            router.use('anotheraction', resolver, third, fourth);
            router.use('*', last);

            await router.reduce(req, res);

            shouldBeCalled(first, req, res);
            shouldBeCalled(second, req, res);
            shouldBeCalled(third, req, res);
            shouldBeCalled(fourth, req, res);
            shouldBeCalled(last, req, res);

            // assert.equal(resolver.callCount, 1, 'The resolver should be called once');
            assert.strictEqual(resolver.firstCall.args[0], req);

            resolver.calledBefore(first);
            first.calledBefore(second);
            first.calledBefore(third);
            first.calledBefore(fourth);
            first.calledBefore(last);
            second.calledBefore(third);
            second.calledBefore(fourth);
            second.calledBefore(last);
            third.calledBefore(last);
            third.calledBefore(fourth);
            fourth.calledBefore(last);
        });

    });

    describe('#use()', function () {
        it('should accept a router as parameter', async function () {
            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq('', '/nested/inner');
            const res = createMockRes();

            const router = new Router();
            const nestedRouter = new Router();

            nestedRouter.use('/inner', route);

            router.use('/nested', nestedRouter);
            router.use('/', noRoute);

            await await router.reduce(req, res);

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
        });

        it('should allow to set exit actions', async function () {
            const route = sinon.spy((req, res, postBack, next) => next('exit'));
            const noRoute = sinon.spy();
            const globalNext = sinon.spy();

            const genericExit = sinon.spy((data, req, res, postBack, next) => next());
            const exit = sinon.spy((data, req, res, postBack, next) => next('globalAction'));
            const noExit = sinon.spy();

            const req = createMockReq('', '/nested/inner');
            const res = createMockRes();

            const router = new Router();
            const nestedRouter = new Router();

            nestedRouter.use('/inner', route)
                .next('*', genericExit)
                .next('exit', exit)
                .next('*', noExit);

            router.use('/nested', nestedRouter);
            router.use('/', noRoute);

            await router.reduce(req, res, () => {}, globalNext);

            // assert routes
            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);

            // assert exits
            assert(genericExit.called);
            assert(exit.called);
            assert(!noExit.called);

            assert(globalNext.called);
        });

        it('should pass expected actions to nested routers', async function () {
            const route = sinon.spy((req, res, postBack, next) => next());
            const noRoute = sinon.spy();
            const finalRoute = sinon.spy();
            const globalNext = sinon.spy();

            const req = createMockReq('matching text', '/nested/inner');
            const res = createMockRes();

            const router = new Router();
            const nestedRouter = new Router();
            const forbiddenRouter = new Router();

            nestedRouter.use('inner', route);

            forbiddenRouter.use('any', 'matching text', noRoute);

            router.use('/nogo', noRoute);
            router.use('/nested', forbiddenRouter);
            router.use('/nested', nestedRouter);
            router.use('*', finalRoute);

            const actionSpy = sinon.spy();

            router.on('action', actionSpy);

            await router.reduce(req, res, globalNext);

            // assert routes
            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
            shouldBeCalled(finalRoute, req, res);


            assert(!globalNext.called);

            // check fired action event
            return nextTick()
                .then(() => {
                    assert(actionSpy.calledTwice);
                    assert.strictEqual(actionSpy.firstCall.args[0], req.senderId);
                    assert.strictEqual(actionSpy.firstCall.args[1], '/nested/inner');
                    assert.strictEqual(actionSpy.firstCall.args[2], 'matching text');
                    assert.strictEqual(actionSpy.firstCall.args[3], req);

                    assert.strictEqual(actionSpy.secondCall.args[1], '/*');
                });
        });

        it('should execute wildcard actions when the pattern is matching', async function () {
            const router = new Router();

            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq('action with text', 'anotherAction');
            const res = createMockRes();

            router.use(/should-not-match/, noRoute);
            router.use(/^action\swith\stext$/, route);
            router.use(noRoute);

            await router.reduce(req, res);

            shouldBeCalled(route, req, res);
            assert(!noRoute.called, 'route should not be called');
        });

        it('should make relative paths absolute and call postBack methods', async function () {
            const router = new Router();

            const route = sinon.spy((req, res, postBack) => postBack('relative', { data: 1 }));
            const noRoute = sinon.spy();
            const postBack = sinon.spy();
            const req = createMockReq('action with text', 'anotherAction');
            const res = createMockRes();

            router.use(route);
            router.use('*', noRoute);

            await router.reduce(req, res, postBack, undefined, '/prefix');

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
            assert(postBack.calledOnce);
            assert.deepEqual(postBack.firstCall.args, ['/prefix/relative', { data: 1 }]);
        });

        it('should make relative paths absolute and call wait postBack methods', async function () {
            const router = new Router();

            const route = sinon.spy((req, res, postBack) => {
                const resolve = postBack.wait();
                resolve('relative', { data: 1 });
            });

            const noRoute = sinon.spy();
            const deferredPostBack = sinon.spy();

            const postBack = {
                wait: sinon.spy(() => deferredPostBack)
            };
            const req = createMockReq('action with text', 'anotherAction');
            const res = createMockRes();

            router.use(route);
            router.use('*', noRoute);

            await router.reduce(req, res, postBack, undefined, '/prefix');

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
            assert(postBack.wait.calledOnce);
            assert(deferredPostBack.calledOnce);
            assert.deepEqual(deferredPostBack.firstCall.args, ['/prefix/relative', { data: 1 }]);
        });

    });

});
