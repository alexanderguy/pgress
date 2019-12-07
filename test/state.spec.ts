import { strict as assert } from 'assert';
import { PGConnIFace, EventDispatcher } from "../src/proto";
import { PGState } from "../src/main";
import { WebSocketMock } from "./util";
import * as sinon from "sinon";


class PGConnMock extends EventDispatcher implements PGConnIFace {
    conn: any
    attachSocket(conn: any) {
        this.conn = conn;
        setTimeout((e) => {
            this.conn.dispatchEvent(new CustomEvent("open"));
        }, 1);
    }

    socketClosed() {
    }

    socketError() {
    }

    recv(incoming: ArrayBuffer) {
    }

    bind(portalName: string, preparedName: string, paramFormats: Array<string>, params: Array<any>, resultFormats: Array<string>) {
        this.dispatchEvent(new CustomEvent("BindComplete"));
    }

    close(closeType: string, name: string) {
        this.dispatchEvent(new CustomEvent("CloseComplete"));
    }

    describe(descType: string, name: string) {
    }

    execute(portal: string, nRows: number) {
        let tag = "";
        this.dispatchEvent(new CustomEvent("CommandComplete", {
            detail: tag
        }));
    }

    flush() {
        this.dispatchEvent(new CustomEvent("ReadyForQuery"));
    }

    parse(name: string, sqlQuery: string, paramTypes: Array<number>) {
        this.dispatchEvent(new CustomEvent("ParseComplete"));
    }

    passwordMessage(user: string, salt: string, password: string) {
        this.dispatchEvent(new CustomEvent("ReadyForQuery"));
    }

    query(sqlString: string) {
        let fields = [];
        this.dispatchEvent(new CustomEvent("RowDescription", {
            detail: {
                fields: fields
            }
        }));

        let cols = [];
        this.dispatchEvent(new CustomEvent("DataRow", {
            detail: {
                detail: cols
            }
        }));

        let tag = "";
        this.dispatchEvent(new CustomEvent("CommandComplete", {
            detail: tag
        }));
    }

    startupMessage(params: { [key: string]: string; }) {
        this.dispatchEvent(new CustomEvent("AuthenticationMD5Password", {
            detail: {
                salt: "AB"
            }
        }));
    }

    sync() {
    }

    terminate() {
    }
}

describe('PGState', function() {
    it("stateSanityCheck", function() {
        let state = new PGState("someURL", "someDB", "someUser", "somePW");

        assert.equal(state.conn.conn, undefined);
        state.connect();
        assert(state.conn.conn instanceof WebSocketMock)
    });

    describe("basicPositive", function() {
        let state = new PGState("someURL", "someDB", "someUser", "somePW");

        state.conn = new PGConnMock();

        let sandbox = sinon.createSandbox();
        sandbox.spy(state.conn);

        it('connect', async function() {
            await state.connect();
            assert.notEqual(state.conn.conn, undefined);
        });

        it('authSequence', function() {
            assert(state.conn.passwordMessage.calledOnce);
        });

        it('startupMsg', function() {
            assert(state.conn.startupMessage.calledOnce);
        });

        it('simpleQuery', async function() {
            let res = await state.simpleQuery("select;");
        });

        it('extendedQuery', async function() {
            let res = await state.extendedQuery("select");
        });

        it('endItAll', function() {
            state.terminate()
            assert(state.conn.terminate.calledOnce);
        });

        sandbox.restore();
    });

});
