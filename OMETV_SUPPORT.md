# OmegleMiddleMan - OmeTV Support Edition
===============

## New Features
- ✅ **OmeTV Support** - Now supports OmeTV chat service alongside Omegle
- ✅ **Unified Client System** - Single interface for managing both Omegle and OmeTV connections
- ✅ **Service Selection** - Easy switching between services via `service` parameter

## What's Changed

### New Files
- **ometv.js** - Complete OmeTV client implementation with the same API as Omegle

### Updated Files
- **app.js** - Enhanced to support both Omegle and OmeTV services
  - Separate client storage: `omegleClients` and `ometvClients`
  - Automatic service detection based on `args.service` parameter
  - All Omegle-specific features preserved
  
- **package.json** - Version bumped to 0.0.2

## Usage

### Connect to Omegle (default):
```javascript
socket.emit('newClient', {
    service: 'omegle',
    // ... other omegle options
});
```

### Connect to OmeTV:
```javascript
socket.emit('newClient', {
    service: 'ometv',
    // ... other ometv options
});
```

## Original Features
- Lets you connect to two or more clients, then middle man the conversation, allowing you to intercept, change and even add new messages.

## Requirements / Setup
- You need [Node.js](http://nodejs.org/)
- Open the `install.bat` file, this file will install the required files to run the server
- Run the `Run.bat` file, which will start the server
- By default, it listens on port 3000, you can access the client by going to `localhost:3000` in your webbrower

## Credits
- Original omegle client was taken from [here](https://github.com/CRogers/omegle)
- OmeTV implementation added for expanded service support
