import { strict as assert } from 'assert';
import { PGState } from "../src/main";
import { SocketMock } from "./util";

describe('PGState', function() {
    describe("stateSanityCheck", function() {
        let state = new PGState("someURL", "someDB", "someUser", "somePW");

        it('notConnected', function() {
            assert.equal(state.conn.conn, undefined);
        });

        it('connectedMock', function() {
            state.connect();
            assert.notEqual(state.conn.conn, undefined);
            assert(state.conn.conn instanceof SocketMock)
        });
    });
});
