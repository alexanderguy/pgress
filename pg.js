(function () {
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
	    console.log("couldn't find zero termination!");
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
	    this.uint8(this.id.charCodeAt(0));
	}

	// Make space for the size.
	this.int32(0);

	return this;
    }

    MsgWriter.prototype.int32 = function (v) {
	this.view.setInt32(this.pos, v);
	this.pos += 4;
    };

    MsgWriter.prototype.string = function (v) {
	var enc = new TextEncoder();
	var sBuf = enc.encode(v);

	for (var i = 0; i < sBuf.length; i++) {
	    this.uint8(sBuf[i]);
	}

	this.uint8(0);
    };

    MsgWriter.prototype.uint8 = function (v) {
	this.view.setUint8(this.pos, v);
	this.pos += 1;
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

    var PGConn = function () {
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

	// console.log("event type is:", eventType, event);

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
		console.log("waiting for more data, we don't have enough to parse the message header.");
		done = true
		continue;
	    }

	    var view = new DataView(this.buf);
	    var byteLength = view.getInt32(1);
	    if (this.buf.byteLength < (byteLength + 1)) {
		console.log("we got length, but it's not enough", this.buf.byteLength, byteLength + 1);
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
	    console.log("got message:", new Uint8Array(buf));
	}

	var r = new MsgReader(view);
	var msgCode = r.char8();
	var handler = this["_B_" + msgCode];

	r.int32(); // Length

	if (handler) {
	    handler.call(this, r);
	} else {
	    console.log("unknown message code:", msgCode);
	    console.log(new Uint8Array(buf));
	}
    };

    // EmptyQueryResponse
    PGConn.prototype._B_I = function (r) {
	this.dispatchEvent(new CustomEvent("EmptyQueryResponse"));
    };

    // ErrorResponse
    PGConn.prototype._B_E = function (r) {
	var errors = [];

	while (r.view.getUint8(r.pos) != 0) {
	    errors.push({code: r.char8(), msg: r.string()});
	}

	this.dispatchEvent(new CustomEvent("ErrorResponse", { detail: errors }));
    }

    // Authentication Request
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
		    console.log("message size not what is expected.");
		    return;
		}

		var salt = r.uint8array(4);
		var detail = {
		    salt: salt
		};

		event = new CustomEvent("AuthenticationMD5Password", { detail: detail });
		break;
	    default:
		console.log("unknown authentication message for code:", authType);
		event = new ErrorEvent("error", { message: "unknown authentication message" });
		break;
	}

	this.dispatchEvent(event);
    }

    // NoticeResponse
    PGConn.prototype._B_N = function (reader) {
	var notices = [];

	while (r.view.getUint8(r.pos) != 0) {
	    notices.push({code: r.char8(), msg: r.string()});
	}

	this.dispatchEvent(new CustomEvent("NoticeResponse", { detail: notices }));
    };

    // ParameterStatus
    PGConn.prototype._B_S = function (reader) {
	var param = {
	    name: reader.string(),
	    value: reader.string()
	};

	this.dispatchEvent(new CustomEvent("ParameterStatus", {detail: param}));
    }

    // BackendKeyData
    PGConn.prototype._B_K = function (reader) {
	var keyData = {
	    processId: reader.int32(),
	    secretKey: reader.int32()
	};

	this.dispatchEvent(new CustomEvent("BackendKeyData", {detail: keyData}));
    }

    // PasswordMessage
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

    // ReadyForQuery
    PGConn.prototype._B_Z = function (reader) {
	var status = reader.char8();
	var event = new CustomEvent("ReadyForQuery", {
	    detail: {
		status: status
	    }
	});

	this.dispatchEvent(event);
    };

    // RowDescription
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

    // DataRow
    PGConn.prototype._B_D = function (reader) {
	var nCols = reader.int16();
	var cols = [];

	for (var i = 0; i < nCols; i++) {
	    var nBytes = reader.int32();
	    cols.push(reader.uint8array(nBytes));
	}

	var event = new CustomEvent("DataRow", {
	    detail: cols
	});
	this.dispatchEvent(event);
    }

    // CommandComplete
    PGConn.prototype._B_C = function (reader) {
	var tag = reader.string()
	var event = new CustomEvent("CommandComplete")
	this.dispatchEvent(event)
    };

    PGConn.prototype.query = function (sqlString) {
	var msg = new MsgWriter("Q");
	msg.string(sqlString);

	var packet = msg.finish();
	this.conn.send(packet);
    };

    // StartupMessage
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

    // State Handler For Postgres Connections
    var PGState = function (url, database, user, password) {
	this.url = url;
	this.database = database;
	this.user = user;
	this.password = password;
	this.state = "OFFLINE";
	this._curQuery = [];

	this.conn = new PGConn();

	var conn = this.conn;
	var that = this;

	var _getQuery = function () {
	    if (that._curQuery.length < 1) {
		console.log("got a command complete, but there's no running query to proxy to?");
		return undefined;
	    }

	    return that._curQuery[0];
	};

	conn.addEventListener("AuthenticationMD5Password", function (e) {
	    conn.passwordMessage(that.user, e.detail.salt, that.password);
	});

	conn.addEventListener("CommandComplete", function (e) {
	    var query = _getQuery();

	    if (!query) {
		return;
	    }

	    query.commandComplete(e);

	    that._curQuery.shift();
	});

	conn.addEventListener("RowDescription", function (e) {
	    var query = _getQuery();

	    if (!query) {
		return;
	    }

	    query.rowDescription(e);
	});

	conn.addEventListener("DataRow", function (e) {
	    var query = _getQuery();

	    if (!query) {
		return;
	    }

	    query.dataRow(e);
	});

	conn.addEventListener("NoticeResponse", function (e) {
	    var query = _getQuery();

	    if (!query) {
		return;
	    }

	    query.noticeResponse(e);
	});

	conn.addEventListener("ErrorResponse", function (e) {
	    var query = _getQuery();

	    if (!query) {
		return;
	    }

	    query.errorResponse(e);

	    that._curQuery.shift();
	});
    };


    PGState.prototype.connect = function () {
	var ws = new WebSocket(this.url, "binary");
	ws.binaryType = "arraybuffer";
	this.conn.attachSocket(ws);

	var that = this;
	ws.onopen = function (e) {
	    that.conn.startupMessage({user: that.user});
	};

	ws.onerror = function (e) {
	    console.log("error:", e);
	};

	ws.onclose = function (e) {
	    console.log("close:", e);
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

    PGState.prototype.simpleQuery = function (query) {
	var h = new PGQuery(query);

	this.conn.query(query);

	this._curQuery.push(h);

	return h.handleSimpleQuery();
    };

    var PGQuery = function (sqlString) {
	this.query = sqlString;
	this._rowDesc = undefined;
	this._dataRows = [];
	this.notice = undefined;
    };


    var _decodeRow = function (desc, data) {
	var res = [];
	var d = new TextDecoder("utf-8");

	for (var i = 0; i < data.length; i++) {
	    if (desc[i].format != "text") {
		// XXX - What do we do here?
		console.log("we have no idea how to decode this.");
		res.push(null);
	    } else {
		// Append to the array.
		var s = d.decode(data[i]);
		res.push(s);

		// Attach it by name
		var name = desc[i].name;

		if (name) {
		    res[name] = s;
		}
	    }
	};

	return res;
    };

    PGQuery.prototype.handleSimpleQuery = function () {
	var that = this;

	return new Promise((resolve, reject) => {
	    that._resolve = resolve;
	    that._reject = reject;
	});
    };

    PGQuery.prototype.commandComplete = function (e) {
	var rows = [];

	for (var i = 0; i < this._dataRows.length; i++) {
	    rows.push(_decodeRow(this._rowDesc, this._dataRows[i]));
	}

	this._resolve(rows);
    };

    PGQuery.prototype.rowDescription = function (e) {
	this._rowDesc = e.detail.fields;
    };

    PGQuery.prototype.dataRow = function (e) {
	this._dataRows.push(e.detail);
    };

    PGQuery.prototype.errorResponse = function (e) {
	this._reject(e.detail);
    };

    PGQuery.prototype.noticeResponse = function (e) {
	this.notice = e.detail;
    };

    window.PGConn = PGConn;
    window.PGState = PGState;
})();
