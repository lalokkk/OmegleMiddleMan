var Omegle = require('./omegle.js').Omegle;
var OmeTV = require('./ometv.js').OmeTV;
var onOmegleReady = require('./omegle.js').onReady;
var onOmeTVReady = require('./ometv.js').OmeTV.onReady;
var express = require('express');
var app = express();

app.use(express.static(__dirname + '/static'));

var request = require('request');
var http = require('http');
var https = require('https');
var httpServer = http.Server(app);
var io = require('socket.io')(httpServer);

var settings = require('./settings.json');

//var Cleverbot = require('./cleverbot.js');
//var Sham = require('./shamchat.js').Sham;

app.get('/', function(req, res) {
    res.sendFile(__dirname+'/static/index.htm');
});

// Handle connections
io.on('connection', function(socket) {
    // List of omegle clients for this person
    var omegleClients = {};
    var ometvClients = {};

    // List of clever bot clients
    //var cleverClients = {};

    // Stores challenge omegle clients
    var challenges = {};

    // Stores proxy info
    var proxyInfo = null;
    var proxyEnabled = false;

    var requiredConnections = [];
    var buildingConnection = false;
    var currentPain = null;
    function buildConnections() {
        // Any connections required?
        if(!buildingConnection && requiredConnections.length > 0) {
            // Stop multiple from happening
            buildingConnection = true;
            var args = requiredConnections.shift();

            // Store the current pain
            currentPain = args.painID;

            // Make a connection
            makeConnection(args, false);
        }
    }

    // Makes the actual connection
    function makeConnection(args, reconnect) {
        // Determine which service to use
        var service = args.service || 'omegle'; // 'omegle' or 'ometv'
        
        // Create the new instance
        var client;
        if (service === 'ometv') {
            client = new OmeTV(args);
        } else {
            client = new Omegle(args);
        }

        // Store the args
        client.args = args;

        // A store for the clientID
        var realClientID;

        // Handle errors
        client.errorHandler(function(msg) {
            socket.emit('clientError', args, msg);
        });

        client.on('newid', function(client_id) {
            // Store the client
            if (service === 'ometv') {
                ometvClients[client_id] = client;
            } else {
                omegleClients[client_id] = client;
            }

            // Send this ID to the user
            socket.emit('newClient', client_id, args);

            // Store client ID
            realClientID = client_id;
        });

        // Omegle specific - Omegle has banned us
        if (service === 'omegle') {
            client.on('antinudeBanned', function() {
                if(!reconnect) {
                    buildingConnection = false;
                    buildConnections();
                }
                socket.emit('clientBanned', args);
            });
        }

        // Stranger has disconnected
        client.on('strangerDisconnected', function() {
            socket.emit('strangerDisconnected', realClientID);
        });

        // Stranger sent us a message
        client.on('gotMessage', function(msg) {
            socket.emit('gotMessage', realClientID, msg);
        });

        // We have disconnected
        client.on('disconnected', function() {
            socket.emit('disconnected', realClientID);
        });

        // Stranger started typing
        client.on('typing', function() {
            socket.emit('typing', realClientID);
        });

        // Stranger stopped typing
        client.on('stoppedTyping', function() {
            socket.emit('stoppedTyping', realClientID);
        });

        // Connection waiting
        client.on('waiting', function() {
            socket.emit('waiting', realClientID);
        });

        // Connected to stranger
        client.on('connected', function(peerID) {
            socket.emit('connected', realClientID, peerID);

            if(!reconnect) {
                setTimeout(function() {
                    currentPain = null;
                    buildingConnection = false;
                    buildConnections();
                }, 100);
            }
        });

        // Omegle specific events
        if (service === 'omegle') {
            client.on('commonLikes', function(commonLikes) {
                socket.emit('commonLikes', realClientID, commonLikes);
            });

            client.on('statusInfo', function(statusInfo) {
                socket.emit('statusInfo', statusInfo);
            });

            client.on('partnerCollege', function(college) {
                socket.emit('partnerCollege', realClientID, college);
            });

            client.on('question', function(question) {
                socket.emit('question', realClientID, question);
            });

            client.on('spyDisconnected', function(spy) {
                socket.emit('spyDisconnected', realClientID, spy);
            });

            client.on('spyMessage', function(spy, msg) {
                socket.emit('spyMessage', realClientID, spy, msg);
            });

            // Handle the captcha
            function handleCaptcha(code) {
                if(proxyEnabled && proxyInfo) {
                    socket.emit('proxyMessage', 'Server sent a captcha, searching for a new proxy...', args);
                    tryFindNewProxy(function() {
                        socket.emit('conFailedProxy', args);
                    });
                    return;
                }

                socket.emit('newChallenge', args, code);
                challenges[code] = client;
            }

            client.on('recaptchaRejected', handleCaptcha);
            client.on('recaptchaRequired', handleCaptcha);
        }

        // Debug events
        if(settings.debug) {
            client.on('debugEvent', function(reason) {
                socket.emit('debugEvent', realClientID, reason);
            });
        }

        // Are we doing a reconnect?
        if(reconnect) {
            client.reconnect(function(err) {
                if (err) {
                    socket.emit('clientError', args, 'Error reconnecting: ' + err);
                }
            });
        } else {
            client.start(function(err) {
                if (err) {
                    if(proxyEnabled && proxyInfo) {
                        socket.emit('proxyMessage', 'Broken proxy, searching for a new proxy...', args);
                        tryFindNewProxy(function() {
                            socket.emit('conFailedProxy', args);
                        });
                    } else {
                        socket.emit('clientError', args, 'Error starting: ' + err);
                    }
                }
            }, proxyEnabled && proxyInfo);
        }
    }

    // Creates a new connection
    function setupNewConnection(args) {
        if(args == null) args = {};
        requiredConnections.push(args);
        buildConnections();
    }

    // Client wants to fix broken search
    socket.on('unlock', function() {
        buildingConnection = false;
        buildConnections();
    });

    // Cleanup a client when they disconnect
    socket.on('disconnect', function(){
        for(var key in omegleClients) {
            delete omegleClients[key];
        }
        for(var key in ometvClients) {
            delete ometvClients[key];
        }
    });

    // Client wants us to disconnect a stranger
    socket.on('disconnectClient', function(client_id, painID) {
        var client = omegleClients[client_id] || ometvClients[client_id];
        
        if(client != null) {
            client.disconnect();
            delete omegleClients[client_id];
            delete ometvClients[client_id];
        }

        // Remove any queued requests for this painID
        for(var i=0;i<requiredConnections.length;i++) {
            if(requiredConnections[i].painID == painID) {
                requiredConnections.splice(i--, 1);
            }
        }

        if(currentPain == painID) {
            currentPain = null;
            buildingConnection = false;
            buildConnections();
        }
    });

    // Client wants to send a message to a stranger
    socket.on('send', function(client_id, msg, callbackNum) {
        var client = omegleClients[client_id] || ometvClients[client_id];

        if(client) {
            client.send(msg, function(err) {
                if (err) {
                    socket.emit('clientError', client.args, 'Error sending: ' + err);
                    if(callbackNum) {
                        socket.emit('callback', client_id, callbackNum, false);
                    }
                } else {
                    if(callbackNum) {
                        socket.emit('callback', client_id, callbackNum, true);
                    }
                }
            });
        }
    });

    // Omegle specific - Challenge
    socket.on('challengeAnswer', function(code, answer) {
        var client = challenges[code];
        if(client != null) {
            client.recaptcha(answer);
        }
    });

    // Client started typing
    socket.on('startTyping', function(client_id) {
        var client = omegleClients[client_id] || ometvClients[client_id];

        if(client) {
            client.startTyping(function(err) {
                if(err) {
                    socket.emit('clientError', client.args, 'Error typing: ' + err);
                }
            });
        }
    });

    // Client stopped typing
    socket.on('stopTyping', function(client_id) {
        var client = omegleClients[client_id] || ometvClients[client_id];

        if(client) {
            client.stopTyping(function(err) {
                if(err) {
                    socket.emit('clientError', client.args, 'Error stopping typing: ' + err);
                }
            });
        }
    });

    // Client is asking for a new client
    socket.on('newClient', function(args){
        if(args.forceSearch) {
            if(buildingConnection) {
                makeConnection(args, false);
            } else {
                setupNewConnection(args);
            }
        } else {
            setupNewConnection(args);
        }
    });

    // Omegle logging feature
    socket.on('omegleLog', function(cacheNumber, toCache) {
        var postData = 'log=' + toCache + '&host=1';

        if(settings.debug) {
            console.log('Requesting: http://logs.omegle.com/generate');
            console.log(postData);
        }

        var postOptions = {
            host: 'logs.omegle.com',
            port: '80',
            path: '/generate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length
            },
            agent:false
        };

        var allData = '';
        var postRequest = http.request(postOptions, function(res) {
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                allData += chunk;
            });
            res.on('end', function() {
                var leftIndexMarker = 'http://logs.Omegle.com/';
                var leftIndex = allData.indexOf(leftIndexMarker);
                var ret = '';
                if(leftIndex != -1) {
                    var rightIndex = allData.indexOf('"', leftIndex + leftIndexMarker.length);
                    if(rightIndex != -1) {
                        ret = allData.substring(leftIndex, rightIndex);
                    }
                }

                socket.emit('omegleLog', cacheNumber, ret);
            });
        });

        postRequest.write(postData);
        postRequest.end();
    });

    // Reconnects a client
    socket.on('reconnect', function(args) {
        makeConnection(args, true);
    });

    // Attempt to find a new proxy
    function tryFindNewProxy(callback) {
        if(!proxyEnabled) return;

        request('http://gimmeproxy.com/api/getProxy?get=true&protocol=http', function(err, res, body) {
            if(err) {
                tryFindNewProxy(callback);
                return;
            }

            try {
                var data = JSON.parse(body);
                var ip = data.ip;
                var port = data.port;

                if(ip && port) {
                    request('http://' + ip + ':' + port + '/', {timeout: 500}, function(err, res) {
                        if(err || res.statusCode >= 500) {
                            tryFindNewProxy(callback);
                        } else {
                            proxyInfo = {
                                ip: ip,
                                port: port
                            };

                            socket.emit('proxyMessage', 'Routing initial connection through ' + ip + ':' + port + ' to avoid captcha!');

                            if(callback) {
                                callback(ip, port);
                            }
                        }
                    });
                } else {
                    tryFindNewProxy(callback)
                }
            } catch(e) {
                tryFindNewProxy(callback)
            }
        });
    }

    // Find a new proxy
    socket.on('newProxy', function() {
        proxyEnabled = true;

        socket.emit('proxyMessage', 'Searching for a proxy to route initial connection through...');

        tryFindNewProxy();
    });

    // Disables proxy
    socket.on('disableProxy', function() {
        proxyEnabled = false;

        socket.emit('proxyMessage', 'Captcha bypass turned off. No proxy will be used.');
    })
});

var omeglePortNumber = 3000;
httpServer.listen(omeglePortNumber, function() {
    console.log('Listening on port ' + omeglePortNumber + ', searching for chat servers...');
});

// Run callback for when omegle is ready
Omegle.onReady(function(serverList) {
    console.log('Found the following Omegle servers: ' + serverList.join(', ') + '\n');
    console.log(Omegle.getSelectedServer() + ' was selected!\n');
    console.log('Visit 127.0.0.1:' + omeglePortNumber + ' in your web browser to view the GUI.');
});

// Run callback for when OmeTV is ready
OmeTV.onReady(function(serverList) {
    console.log('Found the following OmeTV servers: ' + serverList.join(', '));
    console.log(OmeTV.getSelectedServer() + ' was selected!');
});
