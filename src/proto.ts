import log from "loglevel";
import { MsgReader, MsgWriter } from "./msg";

// XXX - FIXTHIS - This MD5 module is being barfed on by tsc, so just
// hide it as any behind a webpack require.
declare function require(module: string): any;
const md5 = require("./md5");
// XXX - FIXTHIS

export class EventDispatcher implements EventTarget {
    private _events: object

    constructor() {
        this._events = {};
    }

    addEventListener(eventType: string, f: EventListener) {
        eventType = eventType.toLowerCase();

        let events = this._events[eventType];

        if (!events) {
            events = [];
        }

        events.push(f);

        this._events[eventType] = events;
    }

    dispatchEvent(event: Event) {
        const eventType = event.type.toLowerCase();

        log.debug("event type is:", eventType, event);

        const handlers = this._events[eventType];

        if (!handlers) {
            return true;
        }

        // XXX - Handle canceling and whatnot here.
        for (let i = 0; i < handlers.length; i++) {
            handlers[i](event);
        }

        return true;
    }

    removeEventListener(eventType: string, listener: EventListener) {
        const handlers = this._events[eventType.toLowerCase()];

        if (!handlers) {
            return;
        }

        const newHandlers = [];

        let handler: EventListener;
        for (let i = 0; i < handlers.length; i++) {
            handler = handlers[i];

            if (handler != listener) {
                newHandlers.push(handler);
            }
        }

        this._events[eventType.toLowerCase()] = newHandlers;
    }
}

export class PGConn extends EventDispatcher {
    buf: ArrayBuffer
    conn: any

    constructor() {
        super()
        this.buf = new ArrayBuffer(0);
    }

    attachSocket(sock: any) {
        this.conn = sock;
    }

    socketClosed() {
        this.conn = undefined;
    }

    socketError() {
        this.conn = undefined;
    }

    recv(incoming: ArrayBuffer) {
        // Merge the incoming data into the existing buffer.
        const newBuf = new ArrayBuffer(this.buf.byteLength + incoming.byteLength);
        {
            const tmp = new Uint8Array(newBuf);
            tmp.set(new Uint8Array(this.buf));
            tmp.set(new Uint8Array(incoming), this.buf.byteLength);
        }

        this.buf = newBuf;

        let done = false;
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

            const view = new DataView(this.buf);
            const byteLength = view.getInt32(1);
            if (this.buf.byteLength < (byteLength + 1)) {
                log.debug("we got length, but it's not enough", this.buf.byteLength, byteLength + 1);
                done = true;
                continue
            }

            const msg = this.buf.slice(0, byteLength + 1);
            this.buf = this.buf.slice(byteLength + 1);

            this._dispatchMsg(msg);
        }
    }

    _dispatchMsg(buf: ArrayBuffer) {
        const view = new DataView(buf);

        if (0) {
            log.debug("got message:", new Uint8Array(buf));
        }

        const r = new MsgReader(view);
        const msgCode = r.char8();
        const handler = this["_backend_" + msgCode];

        r.int32(); // Length

        if (handler) {
            handler.call(this, r);
        } else {
            log.warn("unknown message code:", msgCode);
            log.warn(new Uint8Array(buf));
        }
    }

    // AuthenticationOk (B) / AuthenticationMD5Password (B)
    _backend_R(r: MsgReader) {
        const authType = r.int32();
        let event: Event;

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

                const salt = r.uint8array(4);
                const detail = {
                    salt: salt
                }

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
    _backend_K(reader: MsgReader) {
        const keyData = {
            processId: reader.int32(),
            secretKey: reader.int32()
        }

        this.dispatchEvent(new CustomEvent("BackendKeyData", { detail: keyData }));
    }

    // Bind (F)
    bind(portalName: string, preparedName: string, paramFormats: Array<string>, params: Array<any>, resultFormats: Array<string>) {
        const msg = new MsgWriter('B');

        portalName = portalName || "";
        preparedName = preparedName || "";
        paramFormats = paramFormats || [];
        params = params || [];
        resultFormats = resultFormats || [];

        msg.string(portalName);
        msg.string(preparedName);

        const _encodeFormat = function(v: string) {
            if (v === "binary") {
                return 1;
            }

            // Otherwise, we want text.
            return 0;
        }

        // Parameter Formats
        msg.int16(paramFormats.length);
        for (let i = 0; i < paramFormats.length; i++) {
            msg.int16(_encodeFormat(paramFormats[i]));
        }

        // Parameters
        const enc = new TextEncoder();
        msg.int16(params.length);
        for (let i = 0; i < params.length; i++) {
            const buf = enc.encode(params[i]);
            msg.int32(buf.length);
            msg.uint8array(buf);
        }

        // Result Formats
        msg.int16(resultFormats.length);
        for (let i = 0; i < resultFormats.length; i++) {
            msg.int16(_encodeFormat(resultFormats[i]));
        }

        const packet = msg.finish();
        this.conn.send(packet);
    }

    // BindComplete (B)
    _backend_2(_reader: MsgReader) {
        this.dispatchEvent(new CustomEvent("BindComplete"));
    }

    // Close (F)
    close(closeType: string, name: string) {
        const msg = new MsgWriter("C");
        msg.char8(closeType);
        msg.string(name);

        const packet = msg.finish();
        this.conn.send(packet);
    }

    // CloseComplete (B)
    _backend_3(_reader: MsgReader) {
        const event = new CustomEvent("CloseComplete")
        this.dispatchEvent(event)
    }

    // CommandComplete (B)
    _backend_C(reader: MsgReader) {
        const tag = reader.string()
        const event = new CustomEvent("CommandComplete", { detail: tag })
        this.dispatchEvent(event)
    }

    // DataRow (B)
    _backend_D(reader: MsgReader) {
        const nCols = reader.int16();
        const cols = [];

        for (let i = 0; i < nCols; i++) {
            const nBytes = reader.int32();
            if (nBytes === -1) {
                cols.push(null);
            } else {
                cols.push(reader.uint8array(nBytes));
            }
        }

        const event = new CustomEvent("DataRow", {
            detail: cols
        });
        this.dispatchEvent(event);
    }

    // Describe (F)
    describe(descType: string, name: string) {
        const msg = new MsgWriter("D");
        msg.char8(descType);
        msg.string(name);

        const packet = msg.finish();
        this.conn.send(packet);
    }

    // EmptyQueryResponse (B)
    _backend_I(_r: MsgReader) {
        this.dispatchEvent(new CustomEvent("EmptyQueryResponse"));
    }

    // ErrorResponse (B)
    _backend_E(r: MsgReader) {
        const errors = [];

        while (r.view.getUint8(r.pos) != 0) {
            errors.push({ code: r.char8(), msg: r.string() });
        }

        this.dispatchEvent(new CustomEvent("ErrorResponse", { detail: errors }));
    }

    // Execute (F)
    execute(portal: string, nRows: number) {
        if (!nRows) {
            nRows = 0;
        }

        const msg = new MsgWriter("E");
        msg.string(portal);
        msg.int32(nRows);

        const packet = msg.finish();
        this.conn.send(packet);
    }

    // Flush (F)
    flush() {
        const msg = new MsgWriter("H");
        const packet = msg.finish();
        this.conn.send(packet);
    }

    // NoticeResponse (B)
    _backend_N(reader: MsgReader) {
        const notices = [];

        while (reader.view.getUint8(reader.pos) != 0) {
            notices.push({ code: reader.char8(), msg: reader.string() });
        }

        this.dispatchEvent(new CustomEvent("NoticeResponse", { detail: notices }));
    }

    // ParameterStatus (B)
    _backend_S(reader: MsgReader) {
        const param = {
            name: reader.string(),
            value: reader.string()
        }

        this.dispatchEvent(new CustomEvent("ParameterStatus", { detail: param }));
    }

    // Parse (F)
    parse(name: string, sqlQuery: string, paramTypes: Array<number>) {
        if (!name) {
            name = "";
        }

        if (!paramTypes) {
            paramTypes = [];
        }

        const msg = new MsgWriter('P');
        msg.string(name);
        msg.string(sqlQuery);

        msg.int16(paramTypes.length);
        for (let i = 0; i < paramTypes.length; i++) {
            msg.int32(paramTypes[i]);
        }

        const packet = msg.finish();
        this.conn.send(packet);
    }

    // ParseComplete (B)
    _backend_1(_reader: MsgReader) {
        this.dispatchEvent(new CustomEvent("ParseComplete"));
    }

    // PasswordMessage (F)
    passwordMessage(user: string, salt: string, password: string) {
        const passHash = md5.hex(password + user);
        const hashRes = md5.create();

        hashRes.update(passHash);
        hashRes.update(salt);

        const hashHex = "md5" + hashRes.hex();
        const msg = new MsgWriter("p");
        msg.string(hashHex)

        const packet = msg.finish();
        this.conn.send(packet);
    }

    // PortalSuspended (B)
    _backend_s() {
        this.dispatchEvent(new CustomEvent("PortalSuspended"));
    }

    // Query (F)
    query(sqlString: string) {
        const msg = new MsgWriter("Q");
        msg.string(sqlString);

        const packet = msg.finish();
        this.conn.send(packet);
    }

    // ReadyForQuery (B)
    _backend_Z(reader: MsgReader) {
        const status = reader.char8();
        const event = new CustomEvent("ReadyForQuery", {
            detail: {
                status: status
            }
        });

        this.dispatchEvent(event);
    }

    // RowDescription (B)
    _backend_T(reader: MsgReader) {
        const fields = [];
        const nFields = reader.int16();

        for (let i = 0; i < nFields; i++) {
            const f = {}

            f['name'] = reader.string();
            f['tableOID'] = reader.int32();
            f['attrN'] = reader.int16();
            f['oid'] = reader.int32();
            f['size'] = reader.int16();
            f['modifier'] = reader.int32();

            if (reader.int16() === 1) {
                f['format'] = "binary";
            } else {
                // XXX - This is probably a bad assumption.
                f['format'] = "text";
            }

            fields.push(f);
        }

        const event = new CustomEvent("RowDescription", {
            detail: {
                fields: fields
            }
        });

        this.dispatchEvent(event);
    }

    // StartupMessage (F)
    startupMessage(params: { [key: string]: string; }) {
        const msg = new MsgWriter();

        // Version
        msg.int32(196608);

        // Parameters
        for (const key in params) {
            msg.string(key);
            msg.string(params[key]);
        }
        msg.uint8(0);

        const packet = msg.finish();
        this.conn.send(packet);
    }

    // Sync (F)
    sync() {
        const msg = new MsgWriter("S");
        const packet = msg.finish();
        this.conn.send(packet);
    }

    // Terminate (F)
    terminate() {
        const msg = new MsgWriter("X");
        const packet = msg.finish();
        this.conn.send(packet);
    }
}
