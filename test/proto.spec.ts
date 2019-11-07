import { strict as assert } from 'assert';
import { EventDispatcher, PGConn } from "../src/proto";
import { MsgReader, MsgWriter } from "../src/msg";

// XXX - FIXTHIS - This MD5 module is being barfed on by tsc, so just
// hide it as any behind a webpack require.
declare function require(module: string): any;
const md5 = require("../src/md5");

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
    describe('basicPositive', function() {
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

        it("BackendKeyData", function() {
            const w = new MsgWriter("K");
            w.int32(-5);
            w.int32(-6);
            expectEvents(pg, w.finish(), {
                BackendKeyData: {
                    count: 1,
                    cb: (e: CustomEvent) => {
                        assert.equal(e.detail.processId, -5);
                        assert.equal(e.detail.secretKey, -6);
                    }
                }
            });
        });

        it("BackendKeyData", function() {
            const w = new MsgWriter("K");
            w.int32(42);
            w.int32(-1);

            expectEvents(pg, w.finish(), {
                "BackendKeyData": {
                    count: 1,
                    cb: (e: CustomEvent) => {
                        assert.equal(e.detail["processId"], 42);
                        assert.equal(e.detail["secretKey"], -1);
                    }
                }
            });
        });

        it("Bind", function() {
            pg.bind("portalName", "preparedName", ["binary", "somethingElse"], ["param0", "param1"], ["somethingElse", "binary"]);
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader()
            const ar = new AssertReader(r, "B");

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

        it("BindComplete", function() {
            const w = new MsgWriter("2");
            expectEvents(pg, w.finish(), {
                "BindComplete": 1
            });
        });

        it("Close", function() {
            pg.close("L", "someName");
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader()
            const ar = new AssertReader(r, "C");

            ar.char8("L");
            ar.string("someName");
            ar.done();
        });

        it("CloseComplete", function() {
            const w = new MsgWriter("3");
            expectEvents(pg, w.finish(), {
                "CloseComplete": 1
            });
        });

        it("CommandComplete", function() {
            const w = new MsgWriter("C");
            w.string("myTag");

            expectEvents(pg, w.finish(), {
                "CommandComplete": {
                    count: 1,
                    cb: (e: CustomEvent) => {
                        assert.equal(e.detail, "myTag");
                    }
                }
            });
        });

        it("Describe", function() {
            pg.describe("t", "name");
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader()
            const ar = new AssertReader(r, "D");

            ar.char8("t");
            ar.string("name");
            ar.done();
        });

        it("EmptyQueryResponse", function() {
            const w = new MsgWriter("I");
            expectEvents(pg, w.finish(), {
                "EmptyQueryResponse": 1
            });
        });

        it("ErrorResponse", function() {
            const w = new MsgWriter("E");
            w.char8('A');
            w.string("errorA");
            w.char8('B');
            w.string("errorB");
            w.uint8(0);

            expectEvents(pg, w.finish(), {
                "ErrorResponse": {
                    count: 1,
                    cb: (e: CustomEvent) => {
                        assert.equal(e.detail.length, 2);
                        assert.deepEqual(e.detail[0], { code: "A", msg: "errorA" });
                        assert.deepEqual(e.detail[1], { code: "B", msg: "errorB" });
                    }
                }
            });
        });

        it("Execute", function() {
            pg.execute("portal", 42);
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();
            const ar = new AssertReader(r, "E");
            ar.string("portal");
            ar.int32(42);
            ar.done();
        });

        it("Flush", function() {
            pg.flush();
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();
            const ar = new AssertReader(r, "H");
            ar.done();
        });

        it("NoticeResponse", function() {
            const w = new MsgWriter("N");
            w.char8('A');
            w.string("msgA");
            w.char8('B');
            w.string("msgB");
            w.uint8(0);

            expectEvents(pg, w.finish(), {
                "NoticeResponse": {
                    count: 1,
                    cb: (e: CustomEvent) => {
                        assert.equal(e.detail.length, 2);
                        assert.deepEqual(e.detail[0], { code: "A", msg: "msgA" });
                        assert.deepEqual(e.detail[1], { code: "B", msg: "msgB" });
                    }
                }
            });
        });

        it("ParameterStatus", function() {
            const w = new MsgWriter("S");
            w.string("name");
            w.string("value");

            expectEvents(pg, w.finish(), {
                "ParameterStatus": {
                    count: 1,
                    cb: (e: CustomEvent) => {
                        assert.equal(e.detail.name, "name");
                        assert.equal(e.detail.value, "value");
                    }
                }
            });
        });

        it("Parse", function() {
            pg.parse("name", "query", [1, 2, 3]);
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();
            const ar = new AssertReader(r, 'P');
            ar.string("name");
            ar.string("query");
            ar.int16(3);
            ar.int32(1);
            ar.int32(2);
            ar.int32(3);
            ar.done();
        });

        it("ParseComplete", function() {
            const w = new MsgWriter('1');

            expectEvents(pg, w.finish(), {
                "ParseComplete": 1
            });
        });

        it("PasswordMessage", function() {
            const passHash = md5.hex("passworduser");
            const hashRes = md5.create();

            hashRes.update(passHash);
            hashRes.update("salt");

            const hashHex = "md5" + hashRes.hex();

            pg.passwordMessage("user", "salt", "password");
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();
            const ar = new AssertReader(r, 'p');
            ar.string(hashHex);
            ar.done();
        });

        it("PortalSuspended", function() {
            const w = new MsgWriter('s');

            expectEvents(pg, w.finish(), {
                "PortalSuspended": 1
            });
        });

        it("Query", function() {
            pg.query("query");
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();
            const ar = new AssertReader(r, 'Q');
            ar.string("query");
            ar.done();
        });

        it("ReadyForQuery", function() {
            const w = new MsgWriter('Z');
            w.char8('B');

            expectEvents(pg, w.finish(), {
                "ReadyForQuery": {
                    count: 1,
                    cb: (e: CustomEvent) => {
                        assert.equal(e.detail.status, 'B');
                    }
                }
            }
            );
        });

        it("RowDescription", function() {
            const fields = [
                { name: "name1", tableOID: 1, attrN: 2, oid: 3, size: 4, modifier: 5, format: "binary" },
                { name: "name2", tableOID: 1, attrN: 2, oid: 3, size: 4, modifier: 5, format: "binary" }
            ];

            const w = new MsgWriter("T");
            w.int16(2);

            w.string("name1");
            w.int32(1);
            w.int16(2);
            w.int32(3);
            w.int16(4);
            w.int32(5);
            w.int16(1);

            w.string("name2");
            w.int32(1);
            w.int16(2);
            w.int32(3);
            w.int16(4);
            w.int32(5);
            w.int16(1);

            expectEvents(pg, w.finish(), {
                "RowDescription": {
                    count: 1,
                    cb: (e: CustomEvent) => {
                        assert.equal(e.detail.fields.length, 2);
                        assert.deepEqual(e.detail.fields[0], fields[0]);
                        assert.deepEqual(e.detail.fields[1], fields[1]);
                    }
                }
            });
        });

        it("StartupMessage", function() {
            pg.startupMessage({
                key1: "param1",
                key2: "param2",
            });
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();
            const ar = new AssertReader(r);
            ar.int32(196608);
            ar.string("key1");
            ar.string("param1");
            ar.string("key2");
            ar.string("param2");
            ar.uint8(0);

            ar.done();
        });

        it("Sync", function() {
            pg.sync();
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();
            const ar = new AssertReader(r, 'S');
            ar.done();
        });

        it("Terminate", function() {
            pg.terminate();
            assert.equal(sock.packetCount(), 1);
            const r = sock.popReader();
            const ar = new AssertReader(r, 'X');
            ar.done();
        });
    });
});
