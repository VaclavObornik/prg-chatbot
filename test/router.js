/*
 * @author David Menger
 */
'use strict';

const assert = require('assert');
const sinon = require('sinon');
const Router = require('../src/Router');
const co = require('co');

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

        it('should work', co.wrap(function* () {
            const router = new Router();

            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq();
            const res = createMockRes();

            router.use('/first', noRoute);
            router.use('/*', route);

            yield router.reduce(req, res);

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
        }));

        it('should call matching url', co.wrap(function* () {
            const router = new Router();

            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq('', 'action');
            const res = createMockRes();

            router.use('action', route);
            router.use('*', noRoute);

            yield router.reduce(req, res);

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);

        }));

        it('should call matching text with regexp', co.wrap(function* () {
            const router = new Router();

            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq('just a text', null);
            const res = createMockRes();

            router.use(/^just\sa\stext$/, route);
            router.use('*', noRoute);

            yield router.reduce(req, res);

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);

        }));

        it('should pass request to next routes', co.wrap(function* () {
            const router = new Router();

            let i = 0;

            const first = sinon.spy(() => Router.CONTINUE);
            const second = sinon.spy(() => Router.CONTINUE);
            const resolver = sinon.spy(() => new Promise(resolve => setTimeout(resolve, 50))
                .then(() => i++)
                .then(() => Router.CONTINUE)
            );
            const third = sinon.spy(() => {
                assert.equal(i, 1, 'The third reducer should be called after async resolver was resolved.');
                return new Promise(resolve => setTimeout(resolve, 50))
                    .then(() => i++)
                    .then(() => Router.CONTINUE);
            });
            const fourth = sinon.spy(() => {
                assert.equal(i, 2, 'The fourth reducer should be called after the third async reducer was resolved.');
                return Router.CONTINUE;
            });
            const last = sinon.spy();
            const req = createMockReq('just a text', null);
            const res = createMockRes();

            router.use('fakin-action', /^just\sa\stext$/, first);
            router.use('anotheraction', 'just a text', second);
            router.use('anotheraction', resolver, third, fourth);
            router.use('*', last);

            yield router.reduce(req, res);

            shouldBeCalled(first, req, res);
            shouldBeCalled(second, req, res);
            shouldBeCalled(third, req, res);
            shouldBeCalled(fourth, req, res);
            shouldBeCalled(last, req, res);

            assert.equal(resolver.callCount, 1, 'The resolver should be called once');
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
        }));

    });

    describe('#use()', function () {
        it('should accept a router as parameter', co.wrap(function* () {
            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq('', '/nested/inner');
            const res = createMockRes();

            const router = new Router();
            const nestedRouter = new Router();

            nestedRouter.use('/inner', route);

            router.use('/nested', nestedRouter);
            router.use('/', noRoute);

            yield router.reduce(req, res);

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
        }));

        it('should allow to set exit actions', co.wrap(function* () {
            const route = sinon.spy(() => 'exit');
            const noRoute = sinon.spy();

            const unusedExit = sinon.spy(() => Router.CONTINUE);
            const exit = sinon.spy(() => 'globalAction');
            const noExit = sinon.spy();

            const req = createMockReq('', '/nested/inner');
            const res = createMockRes();

            const router = new Router();
            const nestedRouter = new Router();

            nestedRouter.use('/inner', route)
                .next('unusedExit', unusedExit)
                .next('exit', exit);

            router.use('/nested', nestedRouter);
            router.use('/', noRoute);

            const globalResult = yield router.reduce(req, res, () => {});

            // assert routes
            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);

            // assert exits
            assert(unusedExit.notCalled);
            assert(exit.called);
            assert(!noExit.called);

            assert.deepEqual(globalResult, ['globalAction', {}]);
        }));

        it('should pass expected actions to nested routers', co.wrap(function* () {
            const route = sinon.spy(() => Router.CONTINUE);
            const noRoute = sinon.spy();
            const finalRoute = sinon.spy();

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

            const reduceResult = yield router.reduce(req, res);

            // assert routes
            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
            shouldBeCalled(finalRoute, req, res);


            assert.equal(reduceResult, undefined);

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
        }));

        it('should execute wildcard actions when the pattern is matching', co.wrap(function* () {
            const router = new Router();

            const route = sinon.spy();
            const noRoute = sinon.spy();
            const req = createMockReq('action with text', 'anotherAction');
            const res = createMockRes();

            router.use(/should-not-match/, noRoute);
            router.use(/^action\swith\stext$/, route);
            router.use(noRoute);

            yield router.reduce(req, res);

            shouldBeCalled(route, req, res);
            assert(!noRoute.called, 'route should not be called');
        }));

        it('should make relative paths absolute and call postBack methods', co.wrap(function* () {
            const router = new Router();

            const route = sinon.spy((req, res, postBack) => postBack('relative', { data: 1 }));
            const noRoute = sinon.spy();
            const postBack = sinon.spy();
            const req = createMockReq('action with text', 'anotherAction');
            const res = createMockRes();

            router.use(route);
            router.use('*', noRoute);

            yield router.reduce(req, res, postBack, '/prefix');

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
            assert(postBack.calledOnce);
            assert.deepEqual(postBack.firstCall.args, ['/prefix/relative', { data: 1 }]);
        }));

        it('should make relative paths absolute and call wait postBack methods', co.wrap(function* () {
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

            yield router.reduce(req, res, postBack, '/prefix');

            assert(!noRoute.called, 'route should not be called');
            shouldBeCalled(route, req, res);
            assert(postBack.wait.calledOnce);
            assert(deferredPostBack.calledOnce);
            assert.deepEqual(deferredPostBack.firstCall.args, ['/prefix/relative', { data: 1 }]);
        }));

    });

});
