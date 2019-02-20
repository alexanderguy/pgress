var log = require("loglevel");
var md5 = require('./md5.js');

function MsgReader(view) {
    this.view = view;
    this.pos = 0;
}

MsgReader.prototype._consume = function (n) {
    this.pos += n;
};

MsgReader.prototype.left = function () {
    return this.view.byteLength - this.pos;
};

MsgReader.prototype.char8 = function () {
    var val = this.uint8();
    return String.fromCharCode(val);
}

MsgReader.prototype.uint8 = function () {
    var val = this.view.getUint8(this.pos);
    this._consume(1);

    return val;
}

MsgReader.prototype.uint8array = function (n) {
    var buf = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this._consume(n);
    return buf;
}

MsgReader.prototype.int32 = function () {
    var val = this.view.getInt32(this.pos);
    this._consume(4);

    return val;
}

MsgReader.prototype.int16 = function () {
    var val = this.view.getInt16(this.pos);
    this._consume(2);

    return val;
}

MsgReader.prototype.string = function () {
    var buf = new Uint8Array(this.view.buffer);
    // Offset from the view base, plus the current position.
    var bufOffset = this.view.byteOffset + this.pos;

    var stringEnd = buf.indexOf(0, bufOffset);

    if (stringEnd === -1) {
	throw "couldn't find zero termination!";
    }

    var t = buf.slice(bufOffset, stringEnd);
    var s = new TextDecoder('utf-8').decode(t);

    this._consume((stringEnd - bufOffset) + 1);

    return s;
}

function MsgWriter(id) {
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

    return this;
}

MsgWriter.prototype.int32 = function (v) {
    this.view.setInt32(this.pos, v);
    this.pos += 4;
};

MsgWriter.prototype.int16 = function (v) {
    this.view.setInt16(this.pos, v);
    this.pos += 2;
};

MsgWriter.prototype.uint8array = function (v) {
    // XXX - We could do this better.
    for (var i = 0; i < v.length; i++) {
	this.uint8(v[i]);
    }
};

MsgWriter.prototype.string = function (v) {
    var enc = new TextEncoder();
    var sBuf = enc.encode(v);
    this.uint8array(sBuf)
    this.uint8(0);
};

MsgWriter.prototype.uint8 = function (v) {
    this.view.setUint8(this.pos, v);
    this.pos += 1;
};

MsgWriter.prototype.char8 = function (v) {
    this.uint8(v.charCodeAt(0));
};

MsgWriter.prototype.finish = function () {
    var res = this.buf.slice(0, this.pos);
    var view = new DataView(res);

    if (this.id) {
	view.setInt32(1, this.pos - 1);
    } else {
	view.setInt32(0, this.pos);
    }

    return res;
};

export var PGConn = function () {
    this.buf = new ArrayBuffer();
    this._events = {};
    return this;
};

PGConn.prototype.addEventListener = function (eventType, f) {
    eventType = eventType.toLowerCase();

    var events = this._events[eventType];

    if (!events) {
	events = [];
    }

    events.push(f);

    this._events[eventType] = events;
};

PGConn.prototype.dispatchEvent = function (event) {
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

PGConn.prototype.removeEventListener = function (eventType, listener) {
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

PGConn.prototype.attachSocket = function (sock) {
    this.conn = sock;
};

PGConn.prototype.socketClosed = function () {
    this.conn = undefined;
};

PGConn.prototype.socketError = function () {
    this.conn = undefined;
};

PGConn.prototype.recv = function (incoming) {
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

PGConn.prototype._dispatchMsg = function (buf) {
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
PGConn.prototype._B_R = function (r) {
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
PGConn.prototype._B_K = function (reader) {
    var keyData = {
	processId: reader.int32(),
	secretKey: reader.int32()
    };

    this.dispatchEvent(new CustomEvent("BackendKeyData", {detail: keyData}));
}

// Bind (F)
PGConn.prototype.bind = function (portalName, preparedName, paramFormats, params, resultFormats) {
    var i;
    var msg = new MsgWriter('B');

    portalName = portalName || "";
    preparedName = preparedName || "";
    paramFormats = paramFormats || [];
    params = params || [];
    resultFormats = resultFormats || [];

    msg.string(portalName);
    msg.string(preparedName);

    var _encodeFormat = function (v) {
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
PGConn.prototype._B_2 = function (reader) {
    this.dispatchEvent(new CustomEvent("BindComplete"));
}

// Close (F)
PGConn.prototype.close = function (closeType, name) {
    var msg = new MsgWriter("C");
    msg.char8(closeType);
    msg.string(name);

    var packet = msg.finish();
    this.conn.send(packet);
};

// CloseComplete (B)
PGConn.prototype._B_3 = function (reader) {
    var event = new CustomEvent("CloseComplete")
    this.dispatchEvent(event)
};

// CommandComplete (B)
PGConn.prototype._B_C = function (reader) {
    var tag = reader.string()
    var event = new CustomEvent("CommandComplete")
    this.dispatchEvent(event)
};

// DataRow (B)
PGConn.prototype._B_D = function (reader) {
    var nCols = reader.int16();
    var cols = [];

    for (var i = 0; i < nCols; i++) {
	var nBytes = reader.int32();
	if (nBytes == -1 ) {
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
PGConn.prototype.describe = function (descType, name) {
    var msg = new MsgWriter("D");
    msg.char8(descType);
    msg.string(name);

    var packet = msg.finish();
    this.conn.send(packet);
};

// EmptyQueryResponse (B)
PGConn.prototype._B_I = function (r) {
    this.dispatchEvent(new CustomEvent("EmptyQueryResponse"));
};

// ErrorResponse (B)
PGConn.prototype._B_E = function (r) {
    var errors = [];

    while (r.view.getUint8(r.pos) != 0) {
	errors.push({code: r.char8(), msg: r.string()});
    }

    this.dispatchEvent(new CustomEvent("ErrorResponse", { detail: errors }));
}

// Execute (F)
PGConn.prototype.execute = function (portal, nRows) {
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
PGConn.prototype.flush = function () {
    var msg = new MsgWriter("H");
    var packet = msg.finish();
    this.conn.send(packet);
}

// NoticeResponse (B)
PGConn.prototype._B_N = function (reader) {
    var notices = [];

    while (r.view.getUint8(r.pos) != 0) {
	notices.push({code: r.char8(), msg: r.string()});
    }

    this.dispatchEvent(new CustomEvent("NoticeResponse", { detail: notices }));
};

// ParameterStatus (B)
PGConn.prototype._B_S = function (reader) {
    var param = {
	name: reader.string(),
	value: reader.string()
    };

    this.dispatchEvent(new CustomEvent("ParameterStatus", {detail: param}));
}

// Parse (F)
PGConn.prototype.parse = function (name, sqlQuery, paramTypes) {
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
PGConn.prototype._B_1 = function (reader) {
    this.dispatchEvent(new CustomEvent("ParseComplete"));
}

// PasswordMessage (F)
PGConn.prototype.passwordMessage = function (user, salt, password) {
    var passHash = md5.hex(password + user);
    var hashRes = md5.create();

    hashRes.update(passHash);
    hashRes.update(salt);

    var hashRes = "md5" + hashRes.hex();
    var msg = new MsgWriter("p");
    msg.string(hashRes)

    var packet = msg.finish();
    this.conn.send(packet)
}

// PortalSuspended (B)
PGConn.prototype._B_s = function () {
    this.dispatchEvent(new CustomEvent("PortalSuspended"));
}

// Query (F)
PGConn.prototype.query = function (sqlString) {
    var msg = new MsgWriter("Q");
    msg.string(sqlString);

    var packet = msg.finish();
    this.conn.send(packet);
};

// ReadyForQuery (B)
PGConn.prototype._B_Z = function (reader) {
    var status = reader.char8();
    var event = new CustomEvent("ReadyForQuery", {
	detail: {
	    status: status
	}
    });

    this.dispatchEvent(event);
};

// RowDescription (B)
PGConn.prototype._B_T = function (reader) {
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
PGConn.prototype.startupMessage = function (params) {
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
PGConn.prototype.sync = function () {
    var msg = new MsgWriter("S");
    var packet = msg.finish();
    this.conn.send(packet);
}

// Terminate (F)
PGConn.prototype.terminate = function () {
    var msg = new MsgWriter("X");
    var packet = msg.finish();
    this.conn.send(packet);
}

// State Handler For Postgres Connections
export var PGState = function (url, database, user, password) {
    this.url = url;
    this.database = database;
    this.user = user;
    this.password = password;
    this.state = "OFFLINE";
    this._curQuery = [];

    this.conn = new PGConn();

    var conn = this.conn;
    var that = this;

    var nameCount = 0;

    this._checkName = function (nameType, name) {
	if (name || name === "") {
	    return name;
	}

	name = nameType + "-" + nameCount;

	nameCount += 1;
	return name;
    };

    var _getQuery = function () {
	if (that._curQuery.length < 1) {
	    log.warn("got a command complete, but there's no running query to proxy to?");
	    return undefined;
	}

	return that._curQuery[0];
    };

    conn.addEventListener("AuthenticationMD5Password", function (e) {
	conn.passwordMessage(that.user, e.detail.salt, that.password);
    });

    var _proxyEvent = (eventName, methodName, final) => {
	conn.addEventListener(eventName, (e) => {
	    if (that._curQuery.length < 1) {
		log.error("no query to receive event: ", eventName);
	    }

	    var query = that._curQuery[0];
	    var m = query[methodName];

	    if (m) {
		m.call(query, e);
	    } else {
		log.warn("query object missing handle for event: ", eventName);
	    }

	    if (final) {
		that._curQuery.shift();
	    }
	});
    };

    // Events we pass through to the current running query.
    _proxyEvent("CloseComplete", "closeComplete", true);
    _proxyEvent("CommandComplete", "commandComplete", true);
    _proxyEvent("PortalSuspended", "portalSuspended", true);
    _proxyEvent("RowDescription", "rowDescription", false);
    _proxyEvent("DataRow", "dataRow", false);
    _proxyEvent("NoticeResponse", "noticeResponse", false);
    _proxyEvent("ErrorResponse", "errorResponse", true);
    _proxyEvent("ParseComplete", "parseComplete", true);
    _proxyEvent("BindComplete", "bindComplete", true);
};

PGState.prototype.connect = function () {
    var ws = new WebSocket(this.url, "binary");
    ws.binaryType = "arraybuffer";
    this.conn.attachSocket(ws);

    var that = this;

    var startupParams = {
	user: that.user
    };

    if (that.database) {
	startupParams.database = that.database;
    }

    ws.onopen = function (e) {
	that.conn.startupMessage(startupParams);
    };

    ws.onerror = function (e) {
	log.error("error:", e);
	that.conn.socketError();

	// Zap any open queries.
	for (var i = 0; i < that._curQuery; i++) {
	    that._curQuery[i].errorResponse();
	}

	that.curQuery = [];
    };

    ws.onclose = function (e) {
	log.error("close:", e);
	that.conn.socketClosed();
    };

    ws.onmessage = function (e) {
	that.conn.recv(e.data);
    };

    return new Promise((resolve, reject) => {
	that.conn.addEventListener("ReadyForQuery", (e) => {
	    that.state = "READY";
	    resolve();
	});
    });
};

PGState.prototype._newQuery = function (query) {
    this._curQuery.push(query);
};

PGState.prototype.simpleQuery = function (query) {
    var h = new _SimpleQuery(this);

    return h.query(query);
};

PGState.prototype.preparedStatement = function (name) {
    var h = new _PreparedStatement(this, name);
    return h;
};

PGState.prototype.extendedQuery = function () {
    var args = Array.prototype.slice.call(arguments);
    var query = args.shift();

    var s = this.preparedStatement();
    var p, results;

    return s.parse(query).then(() => {
	p = s.portal();
	p.bind([], args, []);
    }).then(() => {
	return p.execute()
    }).then((res) => {
	results = res;
	return p.close();
    }).then(() => {
	return s.close()
    }).then(() => {
	return results;
    });
};


PGState.prototype.terminate = function () {
    this.conn.terminate();
};

var _decodeRow = function (desc, data) {
    var res = [];
    var d = new TextDecoder("utf-8");

    for (var i = 0; i < data.length; i++) {
	var format, name;

	if (i < desc.length) {
	    format = desc[i].format;
	    name = desc[i].name;
	}

	if (!desc.format) {
	    format = "text";
	}

	if (format != "text") {
	    // XXX - What do we do here?
	    log.warn("we have no idea how to decode this.");
	    res.push(null);
	} else {
	    // Append to the array.
	    if (data[i] == null) {
		res.push(null);
	    } else {
		var s = d.decode(data[i]);
		res.push(s);
	    }

	    // Attach it by name
	    if (name) {
		res[name] = s;
	    }
	}
    };

    return res;
};

var _SimpleQuery = function (state) {
    this.state = state;

    this.promises = [];
    this._rowDesc = [];
    this._dataRows = [];
};

_SimpleQuery.prototype.query = function (queryString) {
    return new Promise((resolve, reject) => {
	this.state._newQuery(query);
	this.promises.push([resolve, reject]);
	this.state.conn.query(queryString);
	this.state.conn.flush();
    });
};

_SimpleQuery.prototype._relayRows = function() {
    var rows = [];

    for (var i = 0; i < this._dataRows.length; i++) {
	rows.push(_decodeRow(this._rowDesc, this._dataRows[i]));
    }
    // XXX - This only makes sense for a simple query.
    this.promises.shift()[0](rows);

    this._dataRows = [];
};

_SimpleQuery.prototype.commandComplete = function (e) {
    this._relayRows();
};

_SimpleQuery.prototype.rowDescription = function (e) {
    this._rowDesc = e.detail.fields;
};

_SimpleQuery.prototype.dataRow = function (e) {
    this._dataRows.push(e.detail);
};

_SimpleQuery.prototype.emptyQueryResponse = function (e) {
    this._relayRows();
};

_SimpleQuery.prototype.errorResponse = function (e) {
    this._dataRows = [];
    this.promises.shift()[1](e.detail);
};

_SimpleQuery.prototype.noticeResponse = function (e) {
    // What to do here?
};

var _Portal = function (state, portalName, statementName) {
    this.promises = [];

    this.state = state;
    this.portalName = state._checkName("portal", portalName);
    this.statementName = statementName;

    this._dataRows = [];
};

_Portal.prototype.bind = function (paramFormats, params, resultFormats) {
    this._rowDesc = [];

    return new Promise((resolve, reject) => {
	this.state._newQuery(this);
	this.promises.push([resolve, reject]);
	this.state.conn.bind(this.portalName, this.statementName, paramFormats, params, resultFormats);
	this.state.conn.flush();
    });
};

_Portal.prototype.bindComplete = function (e) {
    this.promises.shift()[0]();
}

_Portal.prototype.execute = function (nRows) {
    nRows = nRows || 0;

    return new Promise((resolve, reject) => {
	this.state._newQuery(this);
	this.promises.push([resolve, reject]);
	// XXX - This should happen once, right after the bind, not here.
	// I'm putting it here because of the way we're currently proxying
	// events.  It's not great, but it works.
	this.state.conn.describe("P", this.portalName);
	this.state.conn.execute(this.portalName, nRows);
	this.state.conn.flush();
    });
};

_Portal.prototype._relayRows = function() {
    var rows = [];

    for (var i = 0; i < this._dataRows.length; i++) {
	rows.push(_decodeRow(this._rowDesc, this._dataRows[i]));
    }
    // XXX - This only makes sense for a simple query.
    this.promises.shift()[0](rows);

    this._dataRows = [];
};

_Portal.prototype.commandComplete = function (e) {
    this._relayRows();
};

_Portal.prototype.portalSuspended = function (e) {
    this._relayRows();
};

_Portal.prototype.emptyQueryResponse = function (e) {
    this._relayRows();
};

_Portal.prototype.rowDescription = function (e) {
    this._rowDesc = e.detail.fields;
};

_Portal.prototype.dataRow = function (e) {
    this._dataRows.push(e.detail);
};

_Portal.prototype.errorResponse = function (e) {
    this._dataRows = [];
    this.promises.shift()[1](e.detail);
};

_Portal.prototype.noticeResponse = function (e) {
    // What to do here?
};

_Portal.prototype.close = function (closeType) {
    return new Promise((resolve, reject) => {
	this.state._newQuery(this);
	this.promises.push([resolve, reject]);
	this.state.conn.close("P", this.portalName);
	this.state.conn.flush();
    });
};

_Portal.prototype.closeComplete = function (e) {
    this.promises.shift()[0]();
};

var _PreparedStatement = function (state, name) {
    this.promises = [];

    this.state = state;
    this.name = state._checkName("statement", name);
};

_PreparedStatement.prototype.parse = function(sqlQuery, paramTypes) {
    return new Promise((resolve, reject) => {
	this.state._newQuery(this);
	this.promises.push([resolve, reject]);
	this.state.conn.parse(this.name, sqlQuery, paramTypes);
	this.state.conn.flush();
    });
};

_PreparedStatement.prototype.parseComplete = function (e) {
    this.promises.shift()[0]();
};

_PreparedStatement.prototype.portal = function(name) {
    var portal = new _Portal(this.state, name, this.name);
    return portal;
};

_PreparedStatement.prototype.close = function (closeType) {
    return new Promise((resolve, reject) => {
	this.state._newQuery(this);
	this.promises.push([resolve, reject]);
	this.state.conn.close("S", this.name);
	this.state.conn.flush();
    });
};

_PreparedStatement.prototype.closeComplete = function (e) {
    this.promises.shift()[0]();
};

_PreparedStatement.prototype.errorResponse = function (e) {
    this.promises.shift()[1](e.detail);
};
