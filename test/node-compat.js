var util = require("util");
TextEncoder = util.TextEncoder;
TextDecoder = util.TextDecoder;

var testUtil = require("./util");
WebSocket = testUtil.WebSocketMock;

// XXX - Can this come from somewhere else?
CustomEvent = function (eventType, params) {
    params = params || {};

    this.type = eventType;
    this.detail = params.detail;
};

ErrorEvent = CustomEvent;
