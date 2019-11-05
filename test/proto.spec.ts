import { strict as assert } from 'assert';
import { EventDispatcher } from "../src/proto";

describe('EventDispatcher', function() {
    describe('SimpleSingle', function() {
        const d = new EventDispatcher();
        const eventCount = {};

        let incEvent = function(e) {
            let count = eventCount[e.type] || 0;
            count += 1;
            eventCount[e.type] = count;
        };

        it('addListeners', function() {
            d.addEventListener("someEvent", incEvent);
            d.addEventListener("anotherEvent", incEvent);
        });

        it('dispatchCheck0', function() {
            d.dispatchEvent(new CustomEvent('someEvent'));
            assert.equal(eventCount['someEvent'], 1);
        });

        it('dispatchCheck1', function() {
            d.dispatchEvent(new CustomEvent('someEvent'));
            assert.equal(eventCount['someEvent'], 2);
        });

        it('removeListener0', function() {
            d.removeEventListener("someEvent", incEvent);
        });

        it('dispatchToNowhere0', function() {
            d.dispatchEvent(new CustomEvent('someEvent'));
            assert.equal(eventCount['someEvent'], 2);
        });

        it('checkOther0', function() {
            d.dispatchEvent(new CustomEvent('anotherEvent'));
            assert.equal(eventCount['anotherEvent'], 1);
        });
    });
});
