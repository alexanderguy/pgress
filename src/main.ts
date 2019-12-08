import log from "loglevel";
import { PGConn } from "./proto";

const _decodeRow = function(desc, data) {
    const res = [];
    const d = new TextDecoder("utf-8");

    // XXX - This should be generated automatically.
    const oidConversion = {
        20: (v) => parseInt(v),
        21: (v) => parseInt(v),
        22: (v) => parseInt(v),
        700: (v) => parseFloat(v),
        701: (v) => parseFloat(v),
        114: (v) => JSON.parse(v),
        3802: (v) => JSON.parse(v)
    };

    for (let i = 0; i < data.length; i++) {
        let s = data[i]

        // If there's data, let's process it.
        if (s != null) {
            let colInfo;

            if (i < desc.length) {
                colInfo = desc[i];
            } else {
                log.warn("no column information available, assuming text.");
                colInfo = {
                    format: "text"
                };
            }

            // We Have A Text Field
            if (colInfo.format === "text") {
                // Turn this into UTF-8
                s = d.decode(s);

                // Convert the data to something we like to use.
                if (colInfo.oid != undefined) {
                    const m = oidConversion[colInfo.oid];

                    if (m != undefined) {
                        s = m(s)
                    }
                }

                // Attach it by name
                if (colInfo.name) {
                    res[colInfo.name] = s;
                }
            } else {
                log.warn("null'ing collumn, because we don't know how to decode format: ", colInfo.format)
                s = null;
            }
        }

        res.push(s)
    };

    return res;
};

// State Handler For Postgres Connections
export class PGState {
    url: string
    database: string
    user: string
    password: string
    state: string
    _curQuery: Array<any>
    conn: any
    nameCount: number

    constructor(url: string, database: string, user: string, password: string) {
        this.url = url;
        this.database = database;
        this.user = user;
        this.password = password;
        this.state = "OFFLINE";
        this._curQuery = [];
        this.nameCount = 0;

        this.conn = new PGConn();
    }

    _checkName(nameType: string, name: string) {
        if (name || name === "") {
            return name;
        }

        name = nameType + "-" + this.nameCount;

        this.nameCount += 1;
        return name;
    }

    _bindConnEvents(conn) {
        const that = this;

        conn.addEventListener("AuthenticationMD5Password", function(e: CustomEvent) {
            conn.passwordMessage(that.user, e.detail.salt, that.password);
        });

        const _proxyEvent = (eventName: string, methodName: string, final: boolean) => {
            conn.addEventListener(eventName, (e: CustomEvent) => {
                if (that._curQuery.length < 1) {
                    log.error("no query to receive event: ", eventName);
                }

                const query = that._curQuery[0];
                const m = query[methodName];

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

    connect() {
        const ws = new WebSocket(this.url, "binary");
        ws.binaryType = "arraybuffer";

        this._bindConnEvents(this.conn);
        this.conn.attachSocket(ws);

        const that = this;

        const startupParams = {
            user: that.user,
            database: ""
        };

        if (that.database) {
            startupParams.database = that.database;
        }

        ws.onopen = function(e) {
            that.conn.startupMessage(startupParams);
        };

        ws.onerror = function(e) {
            log.error("error:", e);
            that.conn.socketError();

            // Zap any open queries.
            for (let i = 0; i < that._curQuery[i]; i++) {
                that._curQuery[i].errorResponse();
            }

            that._curQuery = [];
        };

        ws.onclose = function(e) {
            log.error("close:", e);
            that.conn.socketClosed();
        };

        ws.onmessage = function(e) {
            that.conn.recv(e.data);
        };

        return new Promise((resolve, reject) => {
            that.conn.addEventListener("ReadyForQuery", (e: CustomEvent) => {
                that.state = "READY";
                resolve();
            });
        });
    };

    _newQuery(query: any) {
        this._curQuery.push(query);
    };

    simpleQuery(query: string) {
        const h = new _SimpleQuery(this);

        return h.query(query);
    };

    preparedStatement(name?: string) {
        const h = new _PreparedStatement(this, name);
        return h;
    };

    async extendedQuery(...args: any[]) {
        const query = args.shift();

        const s = this.preparedStatement();
        await s.parse(query);
        let p = s.portal();
        await p.bind([], args, []);

        const res = await p.execute();

        await p.close();
        await s.close();

        return res;
    }

    terminate() {
        this.conn.terminate();
    }
}


class _SimpleQuery {
    state: PGState
    promises: Array<any>
    _rowDesc: Array<any>
    _dataRows: Array<any>

    constructor(state) {
        this.state = state;

        this.promises = [];
        this._rowDesc = [];
        this._dataRows = [];
    }

    query(queryString: string) {
        return new Promise((resolve, reject) => {
            this.state._newQuery(this);
            this.promises.push([resolve, reject]);
            this.state.conn.query(queryString);
            this.state.conn.flush();
        });
    }

    _relayRows() {
        const rows = [];

        for (let i = 0; i < this._dataRows.length; i++) {
            rows.push(_decodeRow(this._rowDesc, this._dataRows[i]));
        }
        // XXX - This only makes sense for a simple query.
        this.promises.shift()[0](rows);

        this._dataRows = [];
    }

    commandComplete(e: CustomEvent) {
        this._relayRows();
    }

    rowDescription(e: CustomEvent) {
        this._rowDesc = e.detail.fields;
    }

    dataRow(e: CustomEvent) {
        this._dataRows.push(e.detail);
    }

    emptyQueryResponse(e: CustomEvent) {
        this._relayRows();
    }

    errorResponse(e: CustomEvent) {
        this._dataRows = [];
        this.promises.shift()[1](e.detail);
    }

    noticeResponse(e: CustomEvent) {
        // What to do here?
    }
}

class _Portal {
    promises: Array<any>
    state: PGState
    portalName: string
    statementName: string
    _dataRows: Array<any>
    _rowDesc: Array<any>

    constructor(state, portalName: string, statementName: string) {
        this.promises = [];
        this.state = state;
        this.portalName = state._checkName("portal", portalName);
        this.statementName = statementName;

        this._dataRows = [];
    }

    bind(paramFormats, params, resultFormats) {
        this._rowDesc = [];

        return new Promise((resolve, reject) => {
            this.state._newQuery(this);
            this.promises.push([resolve, reject]);
            this.state.conn.bind(this.portalName, this.statementName, paramFormats, params, resultFormats);
            this.state.conn.flush();
        });
    }

    bindComplete(e: CustomEvent) {
        this.promises.shift()[0]();
    }

    execute(nRows?: number) {
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
    }

    _relayRows() {
        const rows = [];

        for (let i = 0; i < this._dataRows.length; i++) {
            rows.push(_decodeRow(this._rowDesc, this._dataRows[i]));
        }
        // XXX - This only makes sense for a simple query.
        this.promises.shift()[0](rows);

        this._dataRows = [];
    }

    commandComplete(e: CustomEvent) {
        this._relayRows();
    }

    portalSuspended(e: CustomEvent) {
        this._relayRows();
    }

    emptyQueryResponse(e: CustomEvent) {
        this._relayRows();
    }

    rowDescription(e: CustomEvent) {
        this._rowDesc = e.detail.fields;
    }

    dataRow(e: CustomEvent) {
        this._dataRows.push(e.detail);
    }

    errorResponse(e: CustomEvent) {
        this._dataRows = [];
        this.promises.shift()[1](e.detail);
    }

    noticeResponse(e: CustomEvent) {
        // What to do here?
    }

    close() {
        return new Promise((resolve, reject) => {
            this.state._newQuery(this);
            this.promises.push([resolve, reject]);
            this.state.conn.close("P", this.portalName);
            this.state.conn.flush();
        });
    }

    closeComplete(e) {
        this.promises.shift()[0]();
    }
}

class _PreparedStatement {
    promises: Array<any>
    state: PGState
    name: string

    constructor(state, name) {
        this.promises = [];

        this.state = state;
        this.name = state._checkName("statement", name);
    };

    parse(sqlQuery, paramTypes?) {
        return new Promise((resolve, reject) => {
            this.state._newQuery(this);
            this.promises.push([resolve, reject]);
            this.state.conn.parse(this.name, sqlQuery, paramTypes);
            this.state.conn.flush();
        });
    };

    parseComplete(e) {
        this.promises.shift()[0]();
    };

    portal(name?) {
        const portal = new _Portal(this.state, name, this.name);
        return portal;
    };

    close() {
        return new Promise((resolve, reject) => {
            this.state._newQuery(this);
            this.promises.push([resolve, reject]);
            this.state.conn.close("S", this.name);
            this.state.conn.flush();
        });
    };

    closeComplete(e) {
        this.promises.shift()[0]();
    };

    errorResponse(e) {
        this.promises.shift()[1](e.detail);
    }
}
