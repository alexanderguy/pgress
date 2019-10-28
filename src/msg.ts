
function MsgReader(view: DataView): void {
    this.view = view;
    this.pos = 0;
}

MsgReader.prototype._advance = function(n: number) {
    this.pos += n;
};

MsgReader.prototype.left = function() {
    return this.view.byteLength - this.pos;
};

MsgReader.prototype.char8 = function() {
    var val = this.uint8();
    return String.fromCharCode(val);
}

MsgReader.prototype.uint8 = function() {
    var val = this.view.getUint8(this.pos);
    this._advance(1);

    return val;
}

MsgReader.prototype.uint8array = function(n: number) {
    var buf = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this._advance(n);
    return buf;
}

MsgReader.prototype.int32 = function() {
    var val = this.view.getInt32(this.pos);
    this._advance(4);

    return val;
}

MsgReader.prototype.int16 = function() {
    var val = this.view.getInt16(this.pos);
    this._advance(2);

    return val;
}

MsgReader.prototype.string = function() {
    var buf = new Uint8Array(this.view.buffer);
    // Offset from the view base, plus the current position.
    var bufOffset = this.view.byteOffset + this.pos;

    var stringEnd = buf.indexOf(0, bufOffset);

    if (stringEnd === -1) {
        throw "couldn't find zero termination!";
    }

    var t = buf.slice(bufOffset, stringEnd);
    var s = new TextDecoder('utf-8').decode(t);

    this._advance((stringEnd - bufOffset) + 1);

    return s;
}

function MsgWriter(id?: string): void {
    this.buf = new ArrayBuffer(4096);
    this.view = new DataView(this.buf);
    this.pos = 0;
    this.sizePos = 0;
    this.id = id;

    if (this.id) {
        this.char8(this.id);
    }

    // Make space for the size.
    this.int32(0);
}

MsgWriter.prototype.int32 = function(v: number) {
    this.view.setInt32(this.pos, v);
    this.pos += 4;
};

MsgWriter.prototype.int16 = function(v: number) {
    this.view.setInt16(this.pos, v);
    this.pos += 2;
};

MsgWriter.prototype.uint8array = function(v: Array<number>) {
    // XXX - We could do this better.
    for (var i = 0; i < v.length; i++) {
        this.uint8(v[i]);
    }
};

MsgWriter.prototype.string = function(v: string) {
    var enc = new TextEncoder();
    var sBuf = enc.encode(v);
    this.uint8array(sBuf)
    this.uint8(0);
};

MsgWriter.prototype.uint8 = function(v: number) {
    this.view.setUint8(this.pos, v);
    this.pos += 1;
};

MsgWriter.prototype.char8 = function(v: string) {
    this.uint8(v.charCodeAt(0));
};

MsgWriter.prototype.finish = function() {
    var res = this.buf.slice(0, this.pos);
    var view = new DataView(res);

    if (this.id) {
        view.setInt32(1, this.pos - 1);
    } else {
        view.setInt32(0, this.pos);
    }

    return res;
};

export { MsgWriter, MsgReader };
