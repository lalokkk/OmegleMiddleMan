/*
    OmeTV Client Implementation
    Similar structure to Omegle for compatibility
*/

var EventEmitter = require('events').EventEmitter;
const { default: axios } = require('axios');
var https = require('https');
var qs = require('qs');
var util = require('util');

var settings = require('./settings.json');

// Server list
var serverList = [];
let accessServers = [];

// Callback(s) to run when we are ready
var onReadyCallbacks = [];

// Gets a time stamp
function getTimeStamp() {
    var date = new Date();

    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;

    var min = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;

    var sec = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;

    return hour + ":" + min + ":" + sec;
}

function OmeTV(args) {
    // Ensure we have an args object
    if (args == null) args = {};

    // Do we have a client id?
    if (args.client_id) {
        this.client_id = args.client_id;
    }

    // Store data
    this.userAgent = args.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    this.host = args.host || OmeTV.getSelectedServer();
    this.language = args.language || settings.defaultLanguage || 'en';
    this.mobile = args.mobile || false;

    // Generate a randomID
    this.randid = '';
    var randData = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (var i = 0; i < 8; i++) {
        this.randid += randData.charAt(Math.floor(Math.random() * randData.length));
    }

    // Reset our ID when the stranger disconnects
    this.on('strangerDisconnected', function () {
        this.client_id = null;
    });
}

// Add event emitter methods
util.inherits(OmeTV, EventEmitter);

// Selects a server for us
var serverNumber = 0;
OmeTV.getSelectedServer = function () {
    return serverList[serverNumber] || 'ometv.com';
}

// Function to allow callbacks for when the client is ready
OmeTV.onReady = function (callback) {
    if (serverList.length > 0) {
        callback(serverList);
    } else {
        onReadyCallbacks.push(callback);
    }
}

// Store error handler
OmeTV.prototype.errorHandler = function (callback) {
    this.errorCallback = callback;
};

OmeTV.prototype.requestGet = function (path, callback, proxyInfo) {
    this.requestFull('GET', path, false, true, callback, proxyInfo);
};

OmeTV.prototype.requestPost = function (path, data, callback, proxyInfo) {
    this.requestFull('POST', path, data, true, callback, proxyInfo);
};

OmeTV.prototype.requestFull = function (method, path, data, keepAlive, callback, proxyInfo) {
    var thisOmeTV = this;

    var formData;
    if (data) {
        formData = formFormat(data);
    }

    var options = {
        method: method,
        host: this.host,
        port: 443,
        path: path,
        headers: {
            'User-Agent': this.userAgent,
            host: this.host
        },
        agent: false
    };

    if (proxyInfo) {
        options.host = proxyInfo.ip;
        options.port = proxyInfo.port;
    }

    if (formData) {
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        options.headers['Content-Length'] = formData.length;
    }

    if (keepAlive) {
        options.headers['Connection'] = 'Keep-Alive';
    }

    if (settings.debug) {
        console.log('OmeTV Requesting: https://' + this.host + path);
        if (data) {
            console.log(JSON.stringify(data, null, 4));
        }
    }

    var req = https.request(options, callback);

    setTimeout(function () {
        req.socket.end();
    }, 65 * 1000);

    req.on('error', function (error) {
        var msg = 'OmeTV ERROR (' + getTimeStamp() + '): ' + error.message;

        thisOmeTV.nextServer();

        if (thisOmeTV.errorCallback) {
            thisOmeTV.errorCallback(msg);
        } else {
            console.log(msg);
        }

        setTimeout(function () {
            thisOmeTV.requestFull(method, path, data, keepAlive, callback);
        }, 1000);
    });

    if (formData) {
        req.write(formData);
    }

    return req.end();
};

// Attempsts to reconnect
OmeTV.prototype.reconnect = function (callback) {
    if (this.client_id == null) {
        callback('No client_id found.');
        return;
    }

    this.emit('newid', this.client_id);

    if (settings.debug) {
        this.emit('debugEvent', 'OmeTV reconnect()');
    }

    this.eventsLoop();
};

// Cycles to the next server
OmeTV.prototype.nextServer = function () {
    if (++serverNumber >= serverList.length) serverNumber = 0;
    this.host = OmeTV.getSelectedServer();
}

// Connects
OmeTV.prototype.start = function (callback, proxyInfo) {
    var _this = this;

    this.requestGet('/start?' + qs.stringify({
        rcs: 1,
        firstevents: 1,
        m: mobileValue(this.mobile),
        lang: this.language,
        randid: this.randid,
    }), function (res) {
        if (res.statusCode !== 200) {
            if (typeof callback === "function") {
                callback(res.statusCode);
                return;
            }
        }

        getAllData(res, function (data) {
            if (data != null) {
                try {
                    var info = JSON.parse(data);

                    if (info.clientID == null) {
                        _this.nextServer();
                        callback('Error: No clientID allocated.');
                        _this.start(callback, proxyInfo);
                        return;
                    }

                    _this.client_id = info.clientID;

                    if (typeof callback === "function") {
                        callback();
                    }

                    _this.emit('newid', _this.client_id);
                    _this.eventReceived(false, JSON.stringify(info.events || {}));
                } catch (e) {
                    callback('Failed to parse JSON: ' + e + '\n\n' + String(data));
                } finally {
                    if (settings.debug) {
                        _this.emit('debugEvent', 'OmeTV start() finally');
                    }
                    _this.eventsLoop();
                }
            } else {
                callback(-1);
            }
        });
    }, proxyInfo);
};

OmeTV.prototype.send = function (msg, callback) {
    this.requestPost('/send', {
        msg: msg,
        id: this.client_id
    }, function (res) {
        callbackErr(callback, res);
    });
};

OmeTV.prototype.postEvent = function (event, callback) {
    this.requestPost("/" + event, {
        id: this.client_id
    }, function (res) {
        callbackErr(callback, res);
    });
};

OmeTV.prototype.startTyping = function (callback) {
    this.postEvent('typing', callback);
};

OmeTV.prototype.stopTyping = function (callback) {
    this.postEvent('stoppedtyping', callback);
};

OmeTV.prototype.disconnect = function (callback) {
    this.postEvent('disconnect', callback);
    this.client_id = null;
};

OmeTV.prototype.eventsLoop = function () {
    var _this = this;

    if (settings.debug) {
        this.emit('debugEvent', 'OmeTV eventsLoop()');
    }

    this.requestPost('/events', {
        id: this.client_id
    }, function (res) {
        if (settings.debug) {
            _this.emit('debugEvent', 'OmeTV events status: ' + res.statusCode);
        }

        if (res.statusCode === 200) {
            getAllData(res, function (eventData) {
                _this.eventReceived(true, eventData);
            });
        } else {
            console.log('OmeTV: Got an unknown status code in events loop: ' + res.statusCode);

            if (settings.debug) {
                _this.emit('debugEvent', 'OmeTV eventsLoop() bad status code');
            }

            _this.eventsLoop();
        }
    });
};

OmeTV.prototype.eventReceived = function (shouldLoop, data) {
    if (settings.debug) {
        this.emit('debugEvent', 'OmeTV eventReceived()');
    }

    try {
        if (data != null) {
            var event, _i, _len;

            data = JSON.parse(data);
            if (data != null) {
                for (_i = 0, _len = data.length; _i < _len; _i++) {
                    event = data[_i];

                    if (settings.debug) {
                        this.emit('debugEvent', 'OmeTV event: ' + JSON.stringify(event));
                    }

                    this.emit.apply(this, event);
                }
            }
        }
    } catch (e) {
        console.log('OmeTV event apply error');
        console.log(e);
    }

    if (shouldLoop && this.client_id) {
        if (settings.debug) {
            this.emit('debugEvent', 'OmeTV eventsLoop() continuing');
        }

        this.eventsLoop();
    }
};

function getAllData(res, callback) {
    var buffer;
    var finished = false;

    buffer = [];
    res.on('data', function (chunk) {
        return buffer.push(chunk);
    });

    res.on('error', function () {
        if (finished) return;
        finished = true;
        callback(buffer.join(''));
    });

    res.on('end', function () {
        if (finished) return;
        finished = true;
        callback(buffer.join(''));
    });
};

OmeTV.prototype.getAllData = getAllData;

function callbackErr(callback, res) {
    return typeof callback === "function" ? callback((res.statusCode !== 200 ? res.statusCode : void 0)) : void 0;
};

function formFormat(data) {
    var k, v;

    return ((function () {
        var _results;

        _results = [];
        for (k in data) {
            v = data[k];
            _results.push("" + k + "=" + encodeURIComponent(v));
        }

        return _results;
    })()).join('&');
};

function mobileValue(mobileParam) {
    if (mobileParam == null) {
        mobileParam = this.mobile;
    }

    if (mobileParam === true || mobileParam === 1) {
        return 1;
    } else {
        return 0;
    }
};

// Update servers
(function () {
    var om = new OmeTV();

    om.requestGet('/status?nocache=' + Math.random(), function(res) {
        getAllData(res, function (data) {
            try {
                var status = JSON.parse(data);
                serverList = ['ometv.com'];

                if (status.servers && Array.isArray(status.servers)) {
                    for (var i = 0; i < status.servers.length; ++i) {
                        serverList.push(status.servers[i] + '.ometv.com');
                    }
                }

                if (serverList.length == 0) {
                    console.log('Warning: No OmeTV servers were found!');
                    serverList = ['ometv.com'];
                }

                for (var i = 0; i < onReadyCallbacks.length; ++i) {
                    onReadyCallbacks[i](serverList);
                }

                delete om;
            } catch(e) {
                console.log('Error parsing OmeTV servers:', e);
            }
        });
    });
})();

// Define exports
exports.OmeTV = OmeTV;
