import { strict as assert } from 'assert';
import { EventDispatcher, PGConn } from "../src/proto";
import { MsgReader, MsgWriter } from "../src/msg";

describe('EventDispatcher', function() {
    describe('SimpleSingle', function() {
        const d = new EventDispatcher();
        const eventCount = {};

        let incEvent = function(e) {
            let count = eventCount[e.type] || 0;
            count += 1;
            eventCount[e.type] = count;
        };

        it('addListeners', function() {
            d.addEventListener("someEvent", incEvent);
            d.addEventListener("anotherEvent", incEvent);
        });

        it('dispatchCheck0', function() {
            d.dispatchEvent(new CustomEvent('someEvent'));
            assert.equal(eventCount['someEvent'], 1);
        });

        it('dispatchCheck1', function() {
            d.dispatchEvent(new CustomEvent('someEvent'));
            assert.equal(eventCount['someEvent'], 2);
        });

        it('removeListener0', function() {
            d.removeEventListener("someEvent", incEvent);
        });

        it('dispatchToNowhere0', function() {
            d.dispatchEvent(new CustomEvent('someEvent'));
            assert.equal(eventCount['someEvent'], 2);
        });

        it('checkOther0', function() {
            d.dispatchEvent(new CustomEvent('anotherEvent'));
            assert.equal(eventCount['anotherEvent'], 1);
        });

        it('removeListener1', function() {
            d.removeEventListener("anotherEvent", incEvent);
        });

        it('checkOther1', function() {
            d.dispatchEvent(new CustomEvent('anotherEvent'));
            assert.equal(eventCount['anotherEvent'], 1);
        });

        it('removeNonexistent', function() {
            d.removeEventListener("nonexistent", incEvent);
        });

    });
});


const SocketMock = function() {
    this._readers = [];
};

SocketMock.prototype.send = function(packet: any): void {
    this._readers.push(new MsgReader(new DataView(packet)));
};

SocketMock.prototype.packetCount = function() {
    return this._readers.length;
};

SocketMock.prototype.popReader = function() {
    return this._readers.shift();
};

const s2u8 = function(s: string) {
    let r = [];

    for (let i = 0; i < s.length; i++) {
        r.push(s.charCodeAt(i));
    }

    return new Uint8Array(r);
};

describe('PGConn', function() {
    describe('basicMessages', function() {
        const pg = new PGConn();
        const sock = new SocketMock();

        pg.attachSocket(sock);

        it("startup", function() {
            pg.startupMessage({
                key1: "param1",
                key2: "param2",
            });
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();

            assert.equal(r.int32(), 33);
            assert.equal(r.int32(), 196608);
            assert.equal(r.string(), "key1");
            assert.equal(r.string(), "param1");
            assert.equal(r.string(), "key2");
            assert.equal(r.string(), "param2");
            assert.equal(r.uint8(), 0);
            assert.equal(r.left(), 0);
        });

        it("bind", function() {
            pg.bind("portalName", "preparedName", ["binary", "somethingElse"], ["param0", "param1"], ["somethingElse", "binary"]);
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();

            assert.equal(r.char8(), "B");
            assert.equal(r.int32(), 62);
            assert.equal(r.string(), "portalName");
            assert.equal(r.string(), "preparedName");

            // Check Parameter Formats
            assert.equal(r.int16(), 2);
            assert.equal(r.int16(), 1);
            assert.equal(r.int16(), 0);

            // Check Parameters
            assert.equal(r.int16(), 2);
            assert.equal(r.int32(), 6);
            assert.deepEqual(r.uint8array(6), s2u8("param0"));
            assert.equal(r.int32(), 6);
            assert.deepEqual(r.uint8array(6), s2u8("param1"));

            // Check Result Formats
            assert.equal(r.int16(), 2);
            assert.equal(r.int16(), 0);
            assert.equal(r.int16(), 1);

            assert.equal(r.left(), 0);
        });

        it("bindComplete", function() {
            let events = 0;
            const cb = (e) => {
                events += 1;
            };

            pg.addEventListener("BindComplete", cb);

            const w = new MsgWriter("2");
            pg.recv(w.finish());

            pg.removeEventListener("BindComplete", cb);

            assert.equal(events, 1);
        });

        it("backendKeyData", function() {
            let events = 0;
            const cb = (e) => {
                events += 1;
                assert.equal(e.detail["processId"], 42);
                assert.equal(e.detail["secretKey"], -1);
            };

            pg.addEventListener("BackendKeyData", cb);
            const w = new MsgWriter("K");
            w.int32(42);
            w.int32(-1);
            pg.recv(w.finish());
            pg.removeEventListener("BackendKeyData");

            assert.equal(events, 1);
        });
    });
});
