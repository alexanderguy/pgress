class MsgReader {
    view: DataView
    pos: number

    constructor(view: DataView) {
        this.view = view;
        this.pos = 0;
    }

    _advance(n: number) {
        this.pos += n;
    }

    left(): number {
        return this.view.byteLength - this.pos;
    }

    char8(): string {
        let val = this.uint8();
        return String.fromCharCode(val);
    }

    uint8(): number {
        let val = this.view.getUint8(this.pos);
        this._advance(1);

        return val;
    }

    uint8array(n: number): Uint8Array {
        let buf = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
        this._advance(n);
        return buf;
    }

    int32(): number {
        let val = this.view.getInt32(this.pos);
        this._advance(4);

        return val;
    }

    int16(): number {
        let val = this.view.getInt16(this.pos);
        this._advance(2);

        return val;
    }

    string(): string {
        let buf = new Uint8Array(this.view.buffer);
        // Offset from the view base, plus the current position.
        let bufOffset = this.view.byteOffset + this.pos;

        let stringEnd = buf.indexOf(0, bufOffset);

        if (stringEnd === -1) {
            throw "couldn't find zero termination!";
        }

        let t = buf.slice(bufOffset, stringEnd);
        let s = new TextDecoder('utf-8').decode(t);

        this._advance((stringEnd - bufOffset) + 1);

        return s;
    }
}

class MsgWriter {
    buf: ArrayBuffer
    view: DataView
    pos: number
    sizePos: number
    id: string

    constructor(id?: string) {
        this.buf = new ArrayBuffer(4096)
        this.view = new DataView(this.buf)
        this.pos = 0
        this.sizePos = 0
        this.id = id

        if (this.id) {
            this.char8(this.id);
        }

        // Make space for the size.
        this.int32(0);
    }

    int32(v: number) {
        this.view.setInt32(this.pos, v);
        this.pos += 4;
    }

    int16(v: number) {
        this.view.setInt16(this.pos, v);
        this.pos += 2;
    }

    uint8array(v: Array<number> | Uint8Array): void {
        // XXX - We could do this better.
        for (let i = 0; i < v.length; i++) {
            this.uint8(v[i]);
        }
    }

    string(v: string) {
        let enc = new TextEncoder();
        let sBuf = enc.encode(v);
        this.uint8array(sBuf)
        this.uint8(0);
    }

    uint8(v: number) {
        this.view.setUint8(this.pos, v);
        this.pos += 1;
    }

    char8(v: string) {
        this.uint8(v.charCodeAt(0));
    }

    finish() {
        let res = this.buf.slice(0, this.pos);
        let view = new DataView(res);

        if (this.id) {
            view.setInt32(1, this.pos - 1);
        } else {
            view.setInt32(0, this.pos);
        }

        return res;
    }
}

export { MsgWriter, MsgReader };
