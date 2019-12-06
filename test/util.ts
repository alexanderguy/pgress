import { strict as assert } from 'assert';
import { MsgReader } from "../src/msg";

export class SocketMock {
    private _readers: Array<MsgReader>

    constructor() {
        this._readers = [];
    }

    send(packet: any): void {
        this._readers.push(new MsgReader(new DataView(packet)));
    }

    packetCount(): number {
        return this._readers.length;
    }

    popReader(): MsgReader {
        return this._readers.shift();
    }
}

const s2u8 = function(s: string): Uint8Array {
    let r = [];

    for (let i = 0; i < s.length; i++) {
        r.push(s.charCodeAt(i));
    }

    return new Uint8Array(r);
}

export class AssertReader {
    private r: MsgReader

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

export const ExpectEvents = function(pg, msg, events) {
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
