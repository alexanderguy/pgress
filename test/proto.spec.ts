import { strict as assert } from 'assert';
import { EventDispatcher, PGConn } from "../src/proto";
import { MsgReader, MsgWriter } from "../src/msg";

describe('EventDispatcher', function() {
    describe('SimpleSingle', function() {
        const d = new EventDispatcher();
        const eventCount = {};

        let incEvent = function(e: CustomEvent) {
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

class AssertReader {
    r: any

    constructor(reader: MsgReader, id?: string) {
        this.r = reader

        if (id !== undefined) {
            assert.equal(this.r.char8(), id);
        }

        // XXX - We should use this size.
        this.r.int32();
    }

    int32(v: number): void {
        assert.equal(this.r.int32(), v);
    }

    string(v: string): void {
        assert.equal(this.r.string(), v);
    }

    uint8(v: number): void {
        assert.equal(this.r.uint8(), v);
    }

    int16(v: number): void {
        assert.equal(this.r.int16(), v);
    }

    char8(v: string): void {
        assert.equal(this.r.char8(), v);
    }

    uint8array(v: Uint8Array | string): void {
        if (typeof v === "string") {
            const a = s2u8(v)
            assert.deepEqual(this.r.uint8array(a.byteLength), a);
        } else {
            assert.deepEqual(this.r.uint8array(v.byteLength), v);
        }
    }

    done(): void {
        assert.equal(this.r.left(), 0);
    }
}

const expectEvents = function(pg, msg, events) {
    let callbacks = {};
    let received = {};

    for (const key of Object.keys(events)) {
        let cb = function(e: Event) {
            let count = received[e.type] || 0;
            count += 1;
            received[e.type] = count;

            // XXX - We need a better type check.
            if (typeof events[key] !== "number") {
                events[key].cb(e);
            }

        };

        callbacks[key] = cb;
        pg.addEventListener(key, cb);

    }
    pg.recv(msg);

    for (const key of Object.keys(events)) {
        if (typeof events[key] === 'number') {
            assert.equal(events[key], received[key]);
        } else {
            assert.equal(events[key].count, received[key]);
        }

        pg.removeEventListener(key, callbacks[key]);
    }
};


describe('PGConn', function() {
    describe('basicMessages', function() {
        const pg = new PGConn();
        const sock = new SocketMock();

        pg.attachSocket(sock);

        it("AuthenticationOk", function() {
            const w = new MsgWriter("R");
            w.int32(0);

            expectEvents(pg, w.finish(), {
                "AuthenticationOk": 1
            });
        });

        it("AuthenticationMD5Password", function() {
            const w = new MsgWriter("R");
            w.int32(5);
            w.uint8array([0xDE, 0xAD, 0xBE, 0xEF]);

            expectEvents(pg, w.finish(), {
                "AuthenticationMD5Password": {
                    count: 1,
                    cb: (e: CustomEvent) => {
                        assert.deepEqual(new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]), e.detail.salt);
                    }
                }
            });
        });

        it("AuthenticationError", function() {
            const w = new MsgWriter("R");
            w.int32(666);

            expectEvents(pg, w.finish(), {
                "error": 1
            });
        });

        it("startup", function() {
            pg.startupMessage({
                key1: "param1",
                key2: "param2",
            });
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();
            const ar = new AssertReader(r);

            ar.int32(33);
            ar.int32(196608);
            ar.string("key1");
            ar.string("param1");
            ar.string("key2");
            ar.string("param2");
            ar.uint8(0);

            ar.done();
        });

        it("bind", function() {
            pg.bind("portalName", "preparedName", ["binary", "somethingElse"], ["param0", "param1"], ["somethingElse", "binary"]);
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader()
            const ar = new AssertReader(r);

            ar.char8("B");
            ar.int32(62);
            ar.string("portalName");
            ar.string("preparedName");

            // Check Parameter Formats
            ar.int16(2);
            ar.int16(1);
            ar.int16(0);

            // Check Parameters
            ar.int16(2);
            ar.int32(6);
            ar.uint8array("param0");
            ar.int32(6);
            ar.uint8array("param1");

            // Check Result Formats
            ar.int16(2);
            ar.int16(0);
            ar.int16(1);

            ar.done();
        });

        it("bindComplete", function() {
            let events = 0;
            const cb = () => {
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
            const cb = (e: CustomEvent) => {
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

        it("commandComplete", function() {
            let events = 0;
            const cb = (e: CustomEvent) => {
                events += 1;
                assert.equal(e.detail, "myTag");
            };

            pg.addEventListener("CommandComplete", cb);
            const w = new MsgWriter("C");
            w.string("myTag");
            pg.recv(w.finish());
            pg.removeEventListener("CommandComplete");

            assert.equal(events, 1);
        });
    });
});
