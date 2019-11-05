import * as assert from 'assert';
import { MsgReader, MsgWriter } from "../src/msg";

describe('MsgWriter', function() {
    it('emptyNoId', function() {
        const w = new MsgWriter();
        const res = w.finish();
        const view = new DataView(res);

        assert.equal(res.byteLength, 4);
        assert.equal(view.getInt32(0), 4);
    });

    it('emptyBlankId', function() {
        const w = new MsgWriter('');
        const res = w.finish();
        const view = new DataView(res);

        assert.equal(res.byteLength, 4);
        assert.equal(view.getInt32(0), 4);
    });

    it('emptyWithId', function() {
        const w = new MsgWriter('P');
        const res = w.finish();
        const view = new DataView(res);

        assert.equal(view.byteLength, 5);
        assert.equal(String.fromCharCode(view.getInt8(0)), "P");
        assert.equal(view.getInt32(1), 4);
    });

    describe('simpleTypeCheckWithId', function() {
        const w = new MsgWriter('A');
        w.int32(-42);
        w.int16(-16);

        w.uint8array([0xBA, 0x5E, 0xBA, 0x11]);
        w.string("hey you guys");
        w.uint8(0x42);
        w.char8("M");
        const res = w.finish();
        const view = new DataView(res);

        it('checkLength', function() {
            assert.equal(view.byteLength, 30);
            assert.equal(view.getInt32(1), 29);
        });

        it('checkId', function() {
            assert.equal(String.fromCharCode(view.getUint8(0)), "A");
        });

        it('checkInt32', function() {
            assert.equal(view.getInt32(5), -42);
        });

        it('checkInt16', function() {
            assert.equal(view.getInt16(9), -16);
        });

        it('checkUint8Buf', function() {
            const buf = [0xBA, 0x5E, 0xBA, 0x11]
            for (let i = 0; i < buf.length; i++) {
                assert.equal(view.getUint8(11 + i), buf[i]);
            }
        });

        it('checkString', function() {
            const buf = "hey you guys";
            for (let i = 0; i < buf.length; i++) {
                assert.equal(String.fromCharCode(view.getUint8(15 + i)), buf[i]);
            }

            assert.equal(view.getUint8(15 + 12), 0);
        });

        it('checkUint8', function() {
            assert.equal(view.getUint8(28), 0x42);
        });

        it('checkChar8', function() {
            assert.equal(String.fromCharCode(view.getUint8(29)), "M");
        });
    });
});

describe('MsgReader', function() {
    it('readerSanityCheck', function() {
        const w = new MsgWriter('P');
        const res = w.finish();
        const view = new DataView(res)
        const r = new MsgReader(view);

        assert.equal(view.byteLength, 5);
        assert.equal(r.char8(), "P");
        assert.equal(r.int32(), 4);
    });

    describe("simpleTypeCheckWithId", function() {
        const w = new MsgWriter('A');
        w.int32(-42);
        w.int16(-16);

        w.uint8array([0xBA, 0x5E, 0xBA, 0x11]);
        w.string("hey you guys");
        w.uint8(0x42);
        w.char8("M");
        const res = w.finish();
        const view = new DataView(res);
        const r = new MsgReader(view);

        it('checkId', function() {
            assert.equal(r.char8(), "A");
        });

        it('checkLength', function() {
            assert.equal(r.int32(), 29);
        });

        it('checkInt32', function() {
            assert.equal(r.int32(), -42);
        });

        it('checkInt16', function() {
            assert.equal(r.int16(), -16);
        });

        it('checkUint8Array', function() {
            var should = [0xBA, 0x5E, 0xBA, 0x11];
            var is = r.uint8array(4);

            assert.equal(should.length, is.length);

            for (let i = 0; i < is.length; i++) {
                assert.equal(should[i], is[i]);
            }
        });

        it('checkString', function() {
            var should = "hey you guys";
            var is = r.string();

            assert.equal(should, is);
        });

        it('checkUint8', function() {
            assert.equal(r.uint8(), 0x42);
        });

        it('checkChar8', function() {
            assert.equal(r.char8(), "M");
        });
    });
});
