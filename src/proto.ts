import log from "loglevel";
import { MsgReader, MsgWriter } from "./msg";

// XXX - FIXTHIS - This MD5 module is being barfed on by tsc, so just
// hide it as any behind a webpack require.
declare function require(module: string): any;
let md5 = require("./md5");
// XXX - FIXTHIS

export var PGConn = function(): void {
    this.buf = new ArrayBuffer(0);
    this._events = {};
};

PGConn.prototype.addEventListener = function(eventType: string, f) {
    eventType = eventType.toLowerCase();

    var events = this._events[eventType];

    if (!events) {
        events = [];
    }

    events.push(f);

    this._events[eventType] = events;
};

PGConn.prototype.dispatchEvent = function(event: CustomEvent) {
    var eventType = event.type.toLowerCase();

    log.debug("event type is:", eventType, event);

    var handlers = this._events[eventType];

    if (!handlers) {
        return true;
    }

    // XXX - Handle canceling and whatnot here.
    for (var i = 0; i < handlers.length; i++) {
        handlers[i](event);
    }

    return true;
};

PGConn.prototype.removeEventListener = function(eventType: string, listener) {
    var handlers = this._events[eventType.toLowerCase()];

    if (!handlers) {
        return;
    }

    var newHandlers = [];

    var handler;
    for (var i = 0; i < handlers.length; i++) {
        handler = handlers[i];

        if (handler != listener) {
            newHandlers.push(handler);
        }
    }

    this._events = newHandlers;
};

PGConn.prototype.attachSocket = function(sock) {
    this.conn = sock;
};

PGConn.prototype.socketClosed = function() {
    this.conn = undefined;
};

PGConn.prototype.socketError = function() {
    this.conn = undefined;
};

PGConn.prototype.recv = function(incoming) {
    // Merge the incoming data into the existing buffer.
    var newBuf = new ArrayBuffer(this.buf.byteLength + incoming.byteLength);
    {
        var tmp = new Uint8Array(newBuf);
        tmp.set(new Uint8Array(this.buf));
        tmp.set(new Uint8Array(incoming), this.buf.byteLength);
    }

    this.buf = newBuf;

    var done = false;
    while (!done) {
        // We don't have a message header.
        if (this.buf.byteLength === 0) {
            done = true;
            return;
        }

        if (this.buf.byteLength < 5) {
            log.debug("waiting for more data, we don't have enough to parse the message header.");
            done = true
            continue;
        }

        var view = new DataView(this.buf);
        var byteLength = view.getInt32(1);
        if (this.buf.byteLength < (byteLength + 1)) {
            log.debug("we got length, but it's not enough", this.buf.byteLength, byteLength + 1);
            done = true;
            continue
        }

        var msg = this.buf.slice(0, byteLength + 1);
        this.buf = this.buf.slice(byteLength + 1);

        this._dispatchMsg(msg);
    }
}

PGConn.prototype._dispatchMsg = function(buf) {
    var view = new DataView(buf);

    if (0) {
        log.debug("got message:", new Uint8Array(buf));
    }

    var r = new MsgReader(view);
    var msgCode = r.char8();
    var handler = this["_B_" + msgCode];

    r.int32(); // Length

    if (handler) {
        handler.call(this, r);
    } else {
        log.warn("unknown message code:", msgCode);
        log.warn(new Uint8Array(buf));
    }
};

// AuthenticationOk (B) / AuthenticationMD5Password (B)
PGConn.prototype._B_R = function(r) {
    var authType = r.int32();
    var event;

    switch (authType) {
        case 0:
            // AuthenticationOk
            event = new CustomEvent("AuthenticationOk");
            break;
        case 5:
            // MD5 Password Request
            if (r.left() != 4) {
                log.error("message size not what is expected.");
                return;
            }

            var salt = r.uint8array(4);
            var detail = {
                salt: salt
            };

            event = new CustomEvent("AuthenticationMD5Password", { detail: detail });
            break;
        default:
            log.error("unknown authentication message for code:", authType);
            event = new ErrorEvent("error", { message: "unknown authentication message" });
            break;
    }

    this.dispatchEvent(event);
}

// BackendKeyData (B)
PGConn.prototype._B_K = function(reader) {
    var keyData = {
        processId: reader.int32(),
        secretKey: reader.int32()
    };

    this.dispatchEvent(new CustomEvent("BackendKeyData", { detail: keyData }));
}

// Bind (F)
PGConn.prototype.bind = function(portalName: string, preparedName: string, paramFormats: Array<string>, params: Array<any>, resultFormats: Array<string>) {
    var i;
    var msg = new MsgWriter('B');

    portalName = portalName || "";
    preparedName = preparedName || "";
    paramFormats = paramFormats || [];
    params = params || [];
    resultFormats = resultFormats || [];

    msg.string(portalName);
    msg.string(preparedName);

    var _encodeFormat = function(v: string) {
        if (v == "binary") {
            return 1;
        }

        // Otherwise, we want text.
        return 0;
    }

    // Parameter Formats
    msg.int16(paramFormats.length);
    for (i = 0; i < paramFormats.length; i++) {
        msg.int16(_encodeFormat(paramFormats[i]));
    }

    // Parameters
    var enc = new TextEncoder();
    msg.int16(params.length);
    for (i = 0; i < params.length; i++) {
        var buf = enc.encode(params[i]);
        msg.int32(buf.length);
        msg.uint8array(buf);
    }

    // Result Formats
    msg.int16(resultFormats.length);
    for (i = 0; i < resultFormats.length; i++) {
        msg.int16(_encodeFormat(resultFormats[i]));
    }

    var packet = msg.finish();
    this.conn.send(packet);
}

// BindComplete (B)
PGConn.prototype._B_2 = function(reader) {
    this.dispatchEvent(new CustomEvent("BindComplete"));
}

// Close (F)
PGConn.prototype.close = function(closeType: string, name: string) {
    var msg = new MsgWriter("C");
    msg.char8(closeType);
    msg.string(name);

    var packet = msg.finish();
    this.conn.send(packet);
};

// CloseComplete (B)
PGConn.prototype._B_3 = function(reader) {
    var event = new CustomEvent("CloseComplete")
    this.dispatchEvent(event)
};

// CommandComplete (B)
PGConn.prototype._B_C = function(reader) {
    var tag = reader.string()
    var event = new CustomEvent("CommandComplete")
    this.dispatchEvent(event)
};

// DataRow (B)
PGConn.prototype._B_D = function(reader) {
    var nCols = reader.int16();
    var cols = [];

    for (var i = 0; i < nCols; i++) {
        var nBytes = reader.int32();
        if (nBytes == -1) {
            cols.push(null);
        } else {
            cols.push(reader.uint8array(nBytes));
        }
    }

    var event = new CustomEvent("DataRow", {
        detail: cols
    });
    this.dispatchEvent(event);
}

// Describe (F)
PGConn.prototype.describe = function(descType: string, name: string) {
    var msg = new MsgWriter("D");
    msg.char8(descType);
    msg.string(name);

    var packet = msg.finish();
    this.conn.send(packet);
};

// EmptyQueryResponse (B)
PGConn.prototype._B_I = function(r) {
    this.dispatchEvent(new CustomEvent("EmptyQueryResponse"));
};

// ErrorResponse (B)
PGConn.prototype._B_E = function(r) {
    var errors = [];

    while (r.view.getUint8(r.pos) != 0) {
        errors.push({ code: r.char8(), msg: r.string() });
    }

    this.dispatchEvent(new CustomEvent("ErrorResponse", { detail: errors }));
}

// Execute (F)
PGConn.prototype.execute = function(portal: string, nRows: number) {
    if (!nRows) {
        nRows = 0;
    }

    var msg = new MsgWriter("E");
    msg.string(portal);
    msg.int32(nRows);

    var packet = msg.finish();
    this.conn.send(packet);
};

// Flush (F)
PGConn.prototype.flush = function() {
    var msg = new MsgWriter("H");
    var packet = msg.finish();
    this.conn.send(packet);
}

// NoticeResponse (B)
PGConn.prototype._B_N = function(reader) {
    var notices = [];

    while (reader.view.getUint8(reader.pos) != 0) {
        notices.push({ code: reader.char8(), msg: reader.string() });
    }

    this.dispatchEvent(new CustomEvent("NoticeResponse", { detail: notices }));
};

// ParameterStatus (B)
PGConn.prototype._B_S = function(reader) {
    var param = {
        name: reader.string(),
        value: reader.string()
    };

    this.dispatchEvent(new CustomEvent("ParameterStatus", { detail: param }));
}

// Parse (F)
PGConn.prototype.parse = function(name: string, sqlQuery: string, paramTypes: Array<number>) {
    if (!name) {
        name = "";
    }

    if (!paramTypes) {
        paramTypes = [];
    }

    var msg = new MsgWriter('P');
    msg.string(name);
    msg.string(sqlQuery);

    msg.int16(paramTypes.length);
    for (var i = 0; i < paramTypes.length; i++) {
        msg.int32(paramTypes[i]);
    }

    var packet = msg.finish();
    this.conn.send(packet);
};

// ParseComplete (B)
PGConn.prototype._B_1 = function(reader) {
    this.dispatchEvent(new CustomEvent("ParseComplete"));
}

// PasswordMessage (F)
PGConn.prototype.passwordMessage = function(user: string, salt: string, password: string) {
    var passHash = md5.hex(password + user);
    var hashRes = md5.create();

    hashRes.update(passHash);
    hashRes.update(salt);

    var hashHex = "md5" + hashRes.hex();
    var msg = new MsgWriter("p");
    msg.string(hashHex)

    var packet = msg.finish();
    this.conn.send(packet)
}

// PortalSuspended (B)
PGConn.prototype._B_s = function() {
    this.dispatchEvent(new CustomEvent("PortalSuspended"));
}

// Query (F)
PGConn.prototype.query = function(sqlString: string) {
    var msg = new MsgWriter("Q");
    msg.string(sqlString);

    var packet = msg.finish();
    this.conn.send(packet);
};

// ReadyForQuery (B)
PGConn.prototype._B_Z = function(reader) {
    var status = reader.char8();
    var event = new CustomEvent("ReadyForQuery", {
        detail: {
            status: status
        }
    });

    this.dispatchEvent(event);
};

// RowDescription (B)
PGConn.prototype._B_T = function(reader) {
    var fields = [];
    var nFields = reader.int16();

    for (var i = 0; i < nFields; i++) {
        var f = {};

        f['name'] = reader.string();
        f['tableOID'] = reader.int32();
        f['attrN'] = reader.int16();
        f['oid'] = reader.int32();
        f['size'] = reader.int16();
        f['modifier'] = reader.int32();

        if (reader.int16() == 1) {
            f['format'] = "binary";
        } else {
            // XXX - This is probably a bad assumption.
            f['format'] = "text";
        }

        fields.push(f);
    }

    var event = new CustomEvent("RowDescription", {
        detail: {
            fields: fields
        }
    });

    this.dispatchEvent(event);
};

// StartupMessage (F)
PGConn.prototype.startupMessage = function(params) {
    var msg = new MsgWriter();

    // Version
    msg.int32(196608);

    // Parameters
    for (var key in params) {
        msg.string(key);
        msg.string(params[key]);
    }
    msg.uint8(0);

    var packet = msg.finish();
    this.conn.send(packet);
};

// Sync (F)
PGConn.prototype.sync = function() {
    var msg = new MsgWriter("S");
    var packet = msg.finish();
    this.conn.send(packet);
}

// Terminate (F)
PGConn.prototype.terminate = function() {
    var msg = new MsgWriter("X");
    var packet = msg.finish();
    this.conn.send(packet);
}
